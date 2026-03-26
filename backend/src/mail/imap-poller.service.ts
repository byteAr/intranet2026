import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, AddressObject } from 'mailparser';

import { Email } from './entities/email.entity';
import { MailIngestService } from './mail-ingest.service';

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
    private readonly mailIngestService: MailIngestService,
  ) {}

  /** Called by MailGateway to register itself for WS emission. Delegates to MailIngestService. */
  setGateway(gateway: IMailGateway): void {
    this.mailGateway = gateway;
    this.mailIngestService.setGateway(gateway);
  }

  async onModuleInit(): Promise<void> {
    // Skip IMAP polling when bridge mode is active — the bridge handles ingestion
    if (this.configService.get<string>('MAIL_BRIDGE_URL')) {
      this.logger.log('Bridge mode active — IMAP poller disabled');
      return;
    }
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
      this.logger.warn(`IMAP error: ${String(err)} — falling back to polling`);
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

      const attachments = (parsed.attachments ?? []).map((att) => ({
        filename: att.filename ?? 'attachment',
        contentType: att.contentType ?? 'application/octet-stream',
        data: att.content,
      }));

      await this.mailIngestService.ingest({
        internetMessageId,
        subject: parsed.subject ?? '(sin asunto)',
        fromAddress: this.extractAddress(parsed.from),
        toAddresses: this.extractAddressList(parsed.to),
        ccAddresses: this.extractAddressList(parsed.cc),
        bodyText: parsed.text ?? '',
        bodyHtml: parsed.html || undefined,
        date: parsed.date ?? new Date(),
        isSentFolder: forceTx,
        attachments,
      });
    } catch (err) {
      this.logger.error(`processMessage uid=${uid} error: ${(err as Error).message}`);
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
