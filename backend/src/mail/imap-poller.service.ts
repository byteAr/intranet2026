import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, AddressObject } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';

import { MailParserService } from './mail-parser.service';
import { Email, MailFolder } from './entities/email.entity';
import { Attachment } from './entities/attachment.entity';
import { EmailReference } from './entities/email-reference.entity';

export interface IMailGateway {
  notifyNewEmail(email: Email): void;
}

@Injectable()
export class ImapPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImapPollerService.name);
  private client: ImapFlow | null = null;
  private isRunning = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
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

  /** Called by MailGateway (Phase 5) to register itself for WS emission. */
  setGateway(gateway: IMailGateway): void {
    this.mailGateway = gateway;
  }

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  private buildClient(): ImapFlow {
    return new ImapFlow({
      host: this.configService.get<string>('IMAP_HOST')!,
      port: this.configService.get<number>('IMAP_PORT') ?? 993,
      secure: this.configService.get<string>('IMAP_TLS') !== 'false',
      auth: {
        user: this.configService.get<string>('IMAP_USER')!,
        pass: this.configService.get<string>('IMAP_PASSWORD')!,
      },
      logger: false,
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.log('IMAP poller starting…');
    await this.connectAndListen();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // ignore errors on shutdown
      }
      this.client = null;
    }
  }

  private async connectAndListen(): Promise<void> {
    if (!this.isRunning) return;

    try {
      this.client = this.buildClient();
      await this.client.connect();
      this.logger.log('IMAP connected');

      // Process any unseen messages accumulated while offline
      await this.fetchUnseenMessages();

      // Try IDLE for real-time notifications
      const lock = await this.client.getMailboxLock('INBOX');
      try {
        this.client.on('exists', async () => {
          await this.fetchUnseenMessages();
        });

        await this.client.idle();
        // idle() resolves when the server ends the IDLE session; reconnect
      } finally {
        lock.release();
      }
    } catch (err) {
      this.logger.warn(`IMAP error: ${(err as Error).message} — falling back to polling`);
      this.client = null;
    }

    // Either IDLE ended or connection failed — schedule next poll
    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (!this.isRunning) return;
    const intervalMs = this.configService.get<number>('MAIL_POLL_INTERVAL_MS') ?? 30000;
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      await this.connectAndListen();
    }, intervalMs);
  }

  /** Candidate mailbox names for the Sent folder (case-insensitive match). */
  private readonly SENT_FOLDER_NAMES = [
    'sent', 'sent items', 'sent messages',
    'enviados', 'elementos enviados',
    '[gmail]/sent mail',
  ];

  private async fetchUnseenMessages(): Promise<void> {
    if (!this.client) return;
    await this.fetchFromMailbox('INBOX', false);
    await this.fetchFromSentFolder();
  }

  private async fetchFromMailbox(mailbox: string, forceTx: boolean): Promise<void> {
    if (!this.client) return;
    try {
      const lock = await this.client.getMailboxLock(mailbox);
      try {
        const uids: number[] = [];
        for await (const msg of this.client.fetch('1:*', { flags: true, envelope: true })) {
          if (msg.flags && !msg.flags.has('\\Seen')) {
            uids.push(msg.uid);
          }
        }
        for (const uid of uids) {
          await this.processMessage(uid, forceTx);
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      this.logger.error(`fetchFromMailbox(${mailbox}) error: ${(err as Error).message}`);
    }
  }

  private async fetchFromSentFolder(): Promise<void> {
    if (!this.client) return;
    try {
      const sentBox = await this.findSentMailbox();
      if (!sentBox) return;
      this.logger.log(`Monitoring Sent folder: ${sentBox}`);
      await this.fetchFromMailbox(sentBox, true);
    } catch (err) {
      this.logger.warn(`fetchFromSentFolder error: ${(err as Error).message}`);
    }
  }

  private async findSentMailbox(): Promise<string | null> {
    if (!this.client) return null;
    const list = await this.client.list();
    for (const mailbox of list) {
      const name = (mailbox.path ?? mailbox.name ?? '').toLowerCase();
      if (this.SENT_FOLDER_NAMES.some((s) => name.includes(s))) {
        return mailbox.path ?? mailbox.name ?? null;
      }
    }
    return null;
  }

  private async processMessage(uid: number, forceTx = false): Promise<void> {
    if (!this.client) return;

    try {
      const rawResult = await this.client.fetchOne(String(uid), { source: true });
      if (!rawResult) return;
      const raw = rawResult as { source?: Buffer };

      if (!raw.source) return;
      const parsed: ParsedMail = await simpleParser(raw.source);
      const internetMessageId = parsed.messageId ?? `uid-${uid}-${Date.now()}`;

      // Idempotency check
      const existing = await this.emailRepo.findOne({ where: { internetMessageId } });
      if (existing) return;

      const fromAddress = this.extractAddress(parsed.from);
      const toAddresses = this.extractAddressList(parsed.to);
      const ccAddresses = this.extractAddressList(parsed.cc);
      const bodyText = parsed.text ?? '';

      const { mailCode, folder: detectedFolder, references } = this.mailParserService.parse(
        fromAddress,
        toAddresses,
        ccAddresses,
        bodyText,
      );
      const folder = forceTx ? MailFolder.TX : detectedFolder;

      const email = this.emailRepo.create({
        internetMessageId,
        mailCode: mailCode ?? undefined,
        subject: parsed.subject ?? '(sin asunto)',
        bodyText,
        bodyHtml: parsed.html || undefined,
        fromAddress,
        toAddresses,
        ccAddresses,
        date: parsed.date ?? new Date(),
        folder,
        isFromPstImport: false,
      });

      const saved = await this.emailRepo.save(email);

      // Save attachments
      await this.saveAttachments(saved, parsed);

      // Save references for codes mentioned in the body
      await this.mailParserService.saveReferences(
        saved.id,
        references,
        async (code) => {
          const ref = await this.emailRepo.findOne({ where: { mailCode: code } });
          return ref?.id ?? null;
        },
      );

      // Resolve any existing pending references that pointed to this mail's code
      if (mailCode) {
        await this.mailParserService.resolvePendingReferences(saved.id, mailCode);
      }

      this.logger.log(`Saved email [${folder}] "${saved.subject}" <${internetMessageId}>`);

      // Phase 5: notify via WebSocket
      this.mailGateway?.notifyNewEmail(saved);
    } catch (err) {
      this.logger.error(`processMessage uid=${uid} error: ${(err as Error).message}`);
    }
  }

  private async saveAttachments(email: Email, parsed: ParsedMail): Promise<void> {
    if (!parsed.attachments?.length) return;

    const basePath = this.configService.get<string>('MAIL_ATTACHMENTS_PATH') ?? '/app/storage/attachments';
    await fs.promises.mkdir(basePath, { recursive: true });

    for (const att of parsed.attachments) {
      try {
        const safeFilename = att.filename?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? 'attachment';
        const storagePath = path.join(basePath, `${email.id}_${safeFilename}`);

        await fs.promises.writeFile(storagePath, att.content);

        await this.attachmentRepo.save(
          this.attachmentRepo.create({
            emailId: email.id,
            filename: att.filename ?? safeFilename,
            contentType: att.contentType ?? 'application/octet-stream',
            size: att.size ?? att.content.length,
            storagePath,
          }),
        );
      } catch (err) {
        this.logger.error(`Failed to save attachment "${att.filename}": ${(err as Error).message}`);
      }
    }
  }

  private extractAddress(from: ParsedMail['from']): string {
    if (!from) return '';
    const addr = Array.isArray(from) ? from[0] : from;
    if (!addr) return '';
    const first = (addr as AddressObject).value?.[0];
    return first?.address ?? first?.name ?? '';
  }

  private extractAddressList(field: ParsedMail['to'] | ParsedMail['cc']): string[] {
    if (!field) return [];
    const list = Array.isArray(field) ? field : [field];
    return list.flatMap((group) =>
      (group as AddressObject).value?.map((a) => a.address ?? a.name ?? '').filter(Boolean) ?? [],
    );
  }
}
