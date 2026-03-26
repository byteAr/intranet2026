import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { Email } from './entities/email.entity';
import { MailIngestService } from './mail-ingest.service';
import { SendEmailDto } from './dto/send-email.dto';

@Injectable()
export class SmtpSenderService implements OnModuleInit {
  private readonly logger = new Logger(SmtpSenderService.name);
  private transporter: Transporter;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailIngestService: MailIngestService,
  ) {}

  onModuleInit(): void {
    // Skip transporter setup when bridge handles SMTP
    if (this.configService.get<string>('MAIL_BRIDGE_URL')) return;

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('MAIL_SMTP_HOST'),
      port: this.configService.get<number>('MAIL_SMTP_PORT') ?? 587,
      secure: false,
      auth: {
        user: this.configService.get<string>('MAIL_SMTP_USER'),
        pass: this.configService.get<string>('MAIL_SMTP_PASSWORD'),
      },
    });
  }

  async send(dto: SendEmailDto, files: Express.Multer.File[] = []): Promise<Email> {
    const bridgeUrl = this.configService.get<string>('MAIL_BRIDGE_URL');
    if (bridgeUrl) {
      return this.sendViaBridge(bridgeUrl, dto, files);
    }
    return this.sendDirect(dto, files);
  }

  private async sendViaBridge(
    bridgeUrl: string,
    dto: SendEmailDto,
    files: Express.Multer.File[],
  ): Promise<Email> {
    const secret = this.configService.get<string>('MAIL_BRIDGE_SECRET') ?? '';
    const from = this.configService.get<string>('MAIL_SMTP_FROM')!;

    const attachments = files.map((f) => ({
      filename: f.originalname,
      contentType: f.mimetype,
      base64: f.buffer.toString('base64'),
    }));

    const res = await fetch(`${bridgeUrl}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        from,
        to: dto.to,
        cc: dto.cc ?? [],
        subject: dto.subject,
        text: dto.bodyText,
        html: dto.bodyHtml,
        attachments,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new InternalServerErrorException(`Bridge send error: ${body}`);
    }

    const { messageId } = (await res.json()) as { messageId: string };
    const internetMessageId = messageId ?? `sent-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const result = await this.mailIngestService.ingest({
      internetMessageId,
      subject: dto.subject,
      fromAddress: from,
      toAddresses: dto.to,
      ccAddresses: dto.cc ?? [],
      bodyText: dto.bodyText,
      bodyHtml: dto.bodyHtml,
      date: new Date(),
      isSentFolder: true,
      attachments: files.map((f) => ({
        filename: f.originalname,
        contentType: f.mimetype,
        data: f.buffer,
      })),
    });

    this.logger.log(`Sent via bridge "${dto.subject}" to ${dto.to.join(', ')}`);
    return result.saved!;
  }

  private async sendDirect(dto: SendEmailDto, files: Express.Multer.File[]): Promise<Email> {
    const from = this.configService.get<string>('MAIL_SMTP_FROM')!;

    await this.transporter.sendMail({
      from,
      to: dto.to.join(', '),
      cc: dto.cc?.join(', '),
      subject: dto.subject,
      text: dto.bodyText,
      html: dto.bodyHtml,
      attachments: files.map((f) => ({
        filename: f.originalname,
        content: f.buffer,
        contentType: f.mimetype,
      })),
    });

    const result = await this.mailIngestService.ingest({
      internetMessageId: `sent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      subject: dto.subject,
      fromAddress: from,
      toAddresses: dto.to,
      ccAddresses: dto.cc ?? [],
      bodyText: dto.bodyText,
      bodyHtml: dto.bodyHtml,
      date: new Date(),
      isSentFolder: true,
      attachments: files.map((f) => ({
        filename: f.originalname,
        contentType: f.mimetype,
        data: f.buffer,
      })),
    });

    this.logger.log(`Sent email "${dto.subject}" to ${dto.to.join(', ')}`);
    return result.saved!;
  }
}
