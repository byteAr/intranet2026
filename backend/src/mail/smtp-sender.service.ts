import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { randomUUID } from 'crypto';
import { Email } from './entities/email.entity';
import { MailPendingSend } from './entities/mail-pending-send.entity';
import { MailIngestService } from './mail-ingest.service';
import { SendEmailDto } from './dto/send-email.dto';

@Injectable()
export class SmtpSenderService implements OnModuleInit {
  private readonly logger = new Logger(SmtpSenderService.name);
  private transporter: Transporter;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailIngestService: MailIngestService,
    @InjectRepository(MailPendingSend)
    private readonly pendingSendRepo: Repository<MailPendingSend>,
    @InjectRepository(Email)
    private readonly emailRepo: Repository<Email>,
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

  /**
   * En modo bridge el envío es asíncrono: guarda el email en DB (aparece
   * en Enviados de inmediato) y encola la entrega SMTP para que el bridge
   * lo recoja en el próximo ciclo de polling.
   */
  private async sendViaBridge(
    _bridgeUrl: string,
    dto: SendEmailDto,
    files: Express.Multer.File[],
  ): Promise<Email> {
    const from = this.configService.get<string>('MAIL_SMTP_FROM')!;
    const tempId = `bridge-queued-${randomUUID()}`;

    // Ingestar inmediatamente con ID temporal → aparece en Enviados al instante
    const result = await this.mailIngestService.ingest({
      internetMessageId: tempId,
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

    // Encolar entrega SMTP para el bridge
    await this.pendingSendRepo.save(
      this.pendingSendRepo.create({
        emailId: result.saved!.id,
        fromAddr: from,
        to: dto.to,
        cc: dto.cc ?? null,
        bcc: dto.bcc ?? null,
        subject: dto.subject,
        bodyText: dto.bodyText,
        bodyHtml: dto.bodyHtml ?? null,
        attachments: files.length
          ? files.map((f) => ({
              filename: f.originalname,
              contentType: f.mimetype,
              base64: f.buffer.toString('base64'),
            }))
          : null,
      }),
    );

    this.logger.log(`Queued "${dto.subject}" for bridge SMTP delivery to ${dto.to.join(', ')}`);
    return result.saved!;
  }

  /** El bridge llama a GET /bridge/next-send para obtener el próximo envío pendiente */
  async getNextPendingSend(): Promise<MailPendingSend | null> {
    return this.pendingSendRepo.findOne({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
    });
  }

  /** El bridge llama a POST /bridge/send-done para reportar el resultado */
  async processSendResult(id: string, messageId?: string, error?: string): Promise<void> {
    const pending = await this.pendingSendRepo.findOne({ where: { id } });
    if (!pending) return;

    if (messageId && pending.emailId) {
      // Verificar si el IMAP poller ya ingresó este email antes de que llegara send-done
      // (condición de carrera: bridge pollеó Enviados antes de que se actualizara el tempId)
      const imapDuplicate = await this.emailRepo.findOne({
        where: { internetMessageId: messageId },
      });

      if (imapDuplicate && imapDuplicate.id !== pending.emailId) {
        // El IMAP ya lo guardó con el messageId real → eliminar el duplicado IMAP
        // y actualizar el original (que tiene adjuntos correctos) con el messageId real
        await this.emailRepo.delete(imapDuplicate.id);
        await this.emailRepo.update(pending.emailId, { internetMessageId: messageId });
        this.logger.warn(
          `Race condition resuelta: eliminado duplicado IMAP ${imapDuplicate.id} para "${pending.subject}"`,
        );
      } else if (!imapDuplicate) {
        // Caso normal: actualizar el tempId al messageId real
        await this.emailRepo.update(pending.emailId, { internetMessageId: messageId });
      }
      // Si imapDuplicate.id === pending.emailId: ya fue actualizado, nada que hacer
    }

    await this.pendingSendRepo.update(id, {
      status: error ? 'failed' : 'sent',
      processedAt: new Date(),
      messageId: messageId ?? null,
      errorMessage: error ?? null,
    });

    if (error) {
      this.logger.error(`Bridge SMTP delivery failed for "${pending.subject}": ${error}`);
    } else {
      this.logger.log(`Bridge SMTP delivered "${pending.subject}" → ${messageId}`);
    }
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
