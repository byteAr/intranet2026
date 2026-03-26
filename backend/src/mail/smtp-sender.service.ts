import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Email, MailFolder } from './entities/email.entity';
import { Attachment } from './entities/attachment.entity';
import { MailParserService } from './mail-parser.service';
import { SendEmailDto } from './dto/send-email.dto';

@Injectable()
export class SmtpSenderService implements OnModuleInit {
  private readonly logger = new Logger(SmtpSenderService.name);
  private transporter: Transporter;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailParserService: MailParserService,
    @InjectRepository(Email)
    private readonly emailRepo: Repository<Email>,
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
  ) {}

  onModuleInit(): void {
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

    const { mailCode, references } = this.mailParserService.extractCodes(dto.bodyText);

    const email = this.emailRepo.create({
      internetMessageId: `sent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      mailCode: mailCode ?? undefined,
      subject: dto.subject,
      bodyText: dto.bodyText,
      bodyHtml: dto.bodyHtml,
      fromAddress: from,
      toAddresses: dto.to,
      ccAddresses: dto.cc ?? [],
      date: new Date(),
      folder: MailFolder.TX,
      isFromPstImport: false,
    });

    const saved = await this.emailRepo.save(email);

    await this.mailParserService.saveReferences(
      saved.id,
      references,
      async (code) => {
        const ref = await this.emailRepo.findOne({ where: { mailCode: code } });
        return ref?.id ?? null;
      },
    );

    if (mailCode) {
      await this.mailParserService.resolvePendingReferences(saved.id, mailCode);
    }

    if (files.length) {
      const attachmentsPath =
        this.configService.get<string>('MAIL_ATTACHMENTS_PATH') ?? '/app/storage/attachments';
      await fs.promises.mkdir(attachmentsPath, { recursive: true });

      for (const file of files) {
        try {
          const safeFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
          const storagePath = path.join(attachmentsPath, `${saved.id}_${safeFilename}`);
          await fs.promises.writeFile(storagePath, file.buffer);
          await this.attachmentRepo.save(
            this.attachmentRepo.create({
              emailId: saved.id,
              filename: file.originalname,
              contentType: file.mimetype,
              size: file.size,
              storagePath,
            }),
          );
        } catch (err) {
          this.logger.error(`Failed to save attachment "${file.originalname}": ${(err as Error).message}`);
        }
      }
    }

    this.logger.log(`Sent email "${saved.subject}" to ${dto.to.join(', ')}`);
    return saved;
  }
}
