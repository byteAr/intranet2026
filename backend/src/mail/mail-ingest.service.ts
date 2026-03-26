import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

import { MailParserService } from './mail-parser.service';
import { Email, MailFolder } from './entities/email.entity';
import { Attachment } from './entities/attachment.entity';
import { EmailReference } from './entities/email-reference.entity';
import { IMailGateway } from './imap-poller.service';

export interface IngestData {
  internetMessageId: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  bodyText: string;
  bodyHtml?: string | null;
  date: Date;
  isSentFolder: boolean;
  attachments: Array<{ filename: string; contentType: string; data: Buffer }>;
}

export interface IngestResult {
  saved: Email | null;
  skipped: boolean;
}

@Injectable()
export class MailIngestService {
  private readonly logger = new Logger(MailIngestService.name);
  private mailGateway: IMailGateway | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailParserService: MailParserService,
    @InjectRepository(Email)
    private readonly emailRepo: Repository<Email>,
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(EmailReference)
    private readonly referenceRepo: Repository<EmailReference>,
  ) {}

  setGateway(gateway: IMailGateway): void {
    this.mailGateway = gateway;
  }

  async ingest(data: IngestData): Promise<IngestResult> {
    // Idempotency check
    const existing = await this.emailRepo.findOne({
      where: { internetMessageId: data.internetMessageId },
    });
    if (existing) return { saved: null, skipped: true };

    const { mailCode, folder: detectedFolder, references } = this.mailParserService.parse(
      data.fromAddress,
      data.toAddresses,
      data.ccAddresses,
      data.bodyText,
    );
    const folder = data.isSentFolder ? MailFolder.TX : detectedFolder;

    const email = this.emailRepo.create({
      internetMessageId: data.internetMessageId,
      mailCode: mailCode ?? undefined,
      subject: data.subject,
      bodyText: data.bodyText,
      bodyHtml: data.bodyHtml ?? undefined,
      fromAddress: data.fromAddress,
      toAddresses: data.toAddresses,
      ccAddresses: data.ccAddresses,
      date: data.date,
      folder,
      isFromPstImport: false,
    });

    const saved = await this.emailRepo.save(email);

    await this.saveAttachments(saved, data.attachments);

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

    this.logger.log(`Ingested email [${folder}] "${saved.subject}" <${data.internetMessageId}>`);
    this.mailGateway?.notifyNewEmail(saved);

    return { saved, skipped: false };
  }

  private async saveAttachments(
    email: Email,
    attachments: Array<{ filename: string; contentType: string; data: Buffer }>,
  ): Promise<void> {
    if (!attachments.length) return;

    const basePath =
      this.configService.get<string>('MAIL_ATTACHMENTS_PATH') ?? '/app/storage/attachments';
    await fs.promises.mkdir(basePath, { recursive: true });

    for (const att of attachments) {
      try {
        const safeFilename = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
        const storagePath = path.join(basePath, `${email.id}_${safeFilename}`);

        await fs.promises.writeFile(storagePath, att.data);

        await this.attachmentRepo.save(
          this.attachmentRepo.create({
            emailId: email.id,
            filename: att.filename,
            contentType: att.contentType,
            size: att.data.length,
            storagePath,
          }),
        );
      } catch (err) {
        this.logger.error(
          `Failed to save attachment "${att.filename}": ${(err as Error).message}`,
        );
      }
    }
  }
}
