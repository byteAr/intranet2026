import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';
import { Worker } from 'worker_threads';
import { Email, MailFolder } from '../entities/email.entity';
import { Attachment } from '../entities/attachment.entity';
import { EmailReference } from '../entities/email-reference.entity';
import { PstImportLog, PstImportStatus } from '../entities/pst-import-log.entity';
import { MailParserService } from '../mail-parser.service';
import { MailGateway } from '../mail.gateway';

/** Data shape sent from the worker thread for each PST message */
interface WorkerMessageData {
  internetMessageId: string | null;
  descriptorNodeId: number;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  date: Date;
  isSentFolder: boolean;
  attachments: Array<{ filename: string; mimeTag: string; data: Buffer }>;
}

/**
 * Inline worker script — runs in a separate V8 thread so PST I/O never
 * blocks the main event loop (HTTP server stays responsive).
 */
const WORKER_SCRIPT = `
const { workerData, parentPort } = require('worker_threads');
const { PSTFile, PSTMessage } = require('pst-extractor');

let nextResolve = null;
parentPort.on('message', function(msg) {
  if (msg === 'next' && nextResolve) {
    var r = nextResolve; nextResolve = null; r();
  }
});

function waitNext() {
  return new Promise(function(resolve) { nextResolve = resolve; });
}

async function send(data) {
  parentPort.postMessage({ type: 'message', data: data });
  await waitNext();
}

function splitAddr(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.split(/[;,]/).map(function(s) { return s.trim(); }).filter(Boolean);
}

async function processFolder(folder, isSentParent) {
  var name = (folder.displayName || '').toLowerCase();
  var isSent = isSentParent ||
    name.indexOf('sent') !== -1 ||
    name.indexOf('enviado') !== -1 ||
    name.indexOf('elementos enviados') !== -1;

  if (folder.contentCount > 0) {
    var msg = folder.getNextChild();
    while (msg !== null) {
      if (msg instanceof PSTMessage) {
        var to = [], cc = [];
        for (var i = 0; i < msg.numberOfRecipients; i++) {
          var r = msg.getRecipient(i);
          if (!r) continue;
          var addr = (r.smtpAddress || r.emailAddress || '').trim();
          if (!addr) continue;
          if (r.recipientType === 1) to.push(addr);
          else if (r.recipientType === 2) cc.push(addr);
        }
        if (to.length === 0) to = splitAddr(msg.displayTo);
        if (cc.length === 0) cc = splitAddr(msg.displayCC);

        var atts = [];
        for (var j = 0; j < msg.numberOfAttachments; j++) {
          try {
            var att = msg.getAttachment(j);
            if (!att || !att.filename) continue;
            var stream = att.fileInputStream;
            if (!stream) continue;
            var chunks = [], tmp = Buffer.alloc(8192), n = stream.read(tmp);
            while (n > 0) { chunks.push(Buffer.from(tmp.subarray(0, n))); n = stream.read(tmp); }
            atts.push({ filename: att.filename, mimeTag: att.mimeTag || 'application/octet-stream', data: Buffer.concat(chunks) });
          } catch(e) {}
        }

        await send({
          internetMessageId: (msg.internetMessageId || '').trim() || null,
          descriptorNodeId: msg.descriptorNodeId,
          subject: (msg.subject || '').trim() || '(sin asunto)',
          bodyText: (msg.body || '').trim(),
          bodyHtml: (msg.bodyHTML || '').trim() || null,
          fromAddress: (msg.senderEmailAddress || msg.senderName || '').trim(),
          toAddresses: to, ccAddresses: cc,
          date: msg.messageDeliveryTime || new Date(),
          isSentFolder: isSent,
          attachments: atts,
        });
      }
      msg = folder.getNextChild();
    }
  }

  if (folder.hasSubfolders) {
    for (var child of folder.getSubFolders()) {
      await processFolder(child, isSent);
    }
  }
}

var pstFile = new PSTFile(workerData.filePath);
processFolder(pstFile.getRootFolder(), false)
  .then(function() { parentPort.postMessage({ type: 'done' }); })
  .catch(function(err) { parentPort.postMessage({ type: 'error', message: err.message }); });
`;

@Injectable()
export class PstImportService {
  private readonly logger = new Logger(PstImportService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly mailParserService: MailParserService,
    @InjectRepository(Email)
    private readonly emailRepo: Repository<Email>,
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(EmailReference)
    private readonly referenceRepo: Repository<EmailReference>,
    @InjectRepository(PstImportLog)
    private readonly logRepo: Repository<PstImportLog>,
    private readonly mailGateway: MailGateway,
  ) {}

  get uploadPath(): string {
    return this.configService.get<string>('MAIL_PST_UPLOAD_PATH') ?? '/app/storage/pst';
  }

  get attachmentsPath(): string {
    return this.configService.get<string>('MAIL_ATTACHMENTS_PATH') ?? '/app/storage/attachments';
  }

  async getHistory(): Promise<PstImportLog[]> {
    return this.logRepo.find({ order: { startedAt: 'DESC' } });
  }

  /** Start import in background — returns immediately. */
  async startImport(filename: string): Promise<void> {
    const filePath = path.join(this.uploadPath, filename);
    if (!fs.existsSync(filePath)) throw new Error(`Archivo no encontrado: ${filename}`);

    // Idempotency: skip if already completed
    const existing = await this.logRepo.findOne({
      where: { filename, status: PstImportStatus.COMPLETED },
    });
    if (existing) {
      this.logger.log(`PST ${filename} ya fue importado (completed), salteando.`);
      return;
    }

    // Create or reset log entry
    let log = await this.logRepo.findOne({ where: { filename } });
    if (log) {
      await this.logRepo.delete(log.id);
    }
    log = await this.logRepo.save(this.logRepo.create({ filename }));

    // Run in background — worker thread handles all PST I/O
    this.runImport(filePath, filename, log.id).catch((err) => {
      this.logger.error(`PST import background error: ${(err as Error).message}`);
    });
  }

  private async runImport(filePath: string, filename: string, logId: string): Promise<void> {
    const startedAt = Date.now();
    const stats = {
      totalProcessed: 0,
      inserted: 0,
      skippedDuplicates: 0,
      referencesResolved: 0,
      attachmentsSaved: 0,
    };

    try {
      await this.processWithWorker(filePath, filename, logId, stats, startedAt);

      await this.logRepo.update(logId, {
        status: PstImportStatus.COMPLETED,
        finishedAt: new Date(),
        ...stats,
      });

      this.mailGateway.server.emit('pst_complete', {
        filename,
        totalInserted: stats.inserted,
        totalSkipped: stats.skippedDuplicates,
        referencesResolved: stats.referencesResolved,
        attachmentsSaved: stats.attachmentsSaved,
        elapsedMs: Date.now() - startedAt,
      });

      this.logger.log(
        `PST import completed: ${filename} — inserted=${stats.inserted} skipped=${stats.skippedDuplicates}`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      await this.logRepo.update(logId, {
        status: PstImportStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: msg,
        ...stats,
      });
      this.mailGateway.server.emit('pst_error', { filename, errorMessage: msg });
      this.logger.error(`PST import failed: ${filename} — ${msg}`);
    }
  }

  /**
   * Spawns a Worker thread that reads the PST file (all sync I/O stays off the
   * main thread). The worker sends one message at a time and waits for 'next'
   * before sending the next one (backpressure).
   */
  private processWithWorker(
    filePath: string,
    filename: string,
    logId: string,
    stats: Record<string, number>,
    startedAt: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(WORKER_SCRIPT, {
        eval: true,
        workerData: { filePath },
      });

      worker.on('message', (msg: { type: string; data?: WorkerMessageData; message?: string }) => {
        if (msg.type === 'message' && msg.data) {
          this.processMessageFromWorker(msg.data, stats)
            .then(async () => {
              stats.totalProcessed++;
              if (stats.totalProcessed % 50 === 0) {
                await this.logRepo.update(logId, { ...stats });
                this.mailGateway.server.emit('pst_progress', {
                  filename,
                  current: stats.totalProcessed,
                  inserted: stats.inserted,
                  skipped: stats.skippedDuplicates,
                  elapsedMs: Date.now() - startedAt,
                });
              }
              worker.postMessage('next');
            })
            .catch(reject);
        } else if (msg.type === 'done') {
          resolve();
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
      });

      worker.on('error', reject);
    });
  }

  private async processMessageFromWorker(
    data: WorkerMessageData,
    stats: Record<string, number>,
  ): Promise<void> {
    const internetMessageId =
      data.internetMessageId || `pst-${data.descriptorNodeId}-${Date.now()}`;

    // Idempotency
    const exists = await this.emailRepo.findOne({ where: { internetMessageId } });
    if (exists) {
      stats.skippedDuplicates++;
      return;
    }

    const { mailCode, folder: detectedFolder, references } = this.mailParserService.parse(
      data.fromAddress,
      data.toAddresses,
      data.ccAddresses,
      data.bodyText,
    );
    const folder = data.isSentFolder ? MailFolder.TX : detectedFolder;

    const email = this.emailRepo.create({
      internetMessageId,
      mailCode: mailCode ?? undefined,
      subject: data.subject,
      bodyText: data.bodyText,
      bodyHtml: data.bodyHtml ?? undefined,
      fromAddress: data.fromAddress,
      toAddresses: data.toAddresses,
      ccAddresses: data.ccAddresses,
      date: data.date,
      folder,
      isFromPstImport: true,
    });

    const saved = await this.emailRepo.save(email);

    // Save attachments
    if (!fs.existsSync(this.attachmentsPath)) {
      fs.mkdirSync(this.attachmentsPath, { recursive: true });
    }
    for (const att of data.attachments) {
      try {
        const safeFilename = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = path.join(this.attachmentsPath, `${saved.id}_${safeFilename}`);
        await fs.promises.writeFile(storagePath, att.data);
        await this.attachmentRepo.save(
          this.attachmentRepo.create({
            emailId: saved.id,
            filename: att.filename,
            contentType: att.mimeTag,
            size: att.data.length,
            storagePath,
          }),
        );
        stats.attachmentsSaved++;
      } catch {
        // Skip attachment errors silently
      }
    }

    // References
    await this.mailParserService.saveReferences(
      saved.id,
      references,
      async (code) => {
        const ref = await this.emailRepo.findOne({ where: { mailCode: code } });
        return ref?.id ?? null;
      },
    );

    if (mailCode) {
      const resolved = await this.mailParserService.resolvePendingReferences(saved.id, mailCode);
      stats.referencesResolved += resolved;
    }

    stats.inserted++;
  }
}
