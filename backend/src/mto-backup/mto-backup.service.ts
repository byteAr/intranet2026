import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { existsSync, createReadStream } from 'fs';
import { Readable } from 'stream';
import { GoogleDriveService } from '../shared-folders/google-drive.service';
import { MailService } from '../mail/mail.service';
import { SienaFileService } from '../mail/siena-file.service';
import { isEncrypted } from '../mail/encrypted-attachment.util';
import { isEncryptedByLink } from '../mail/encrypted-link.util';
import { decryptedDisplayName } from '../mail/decrypted-name.util';
import { argentinaParts, ZONA_ARGENTINA } from '../common/argentina-time';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_NAME = 'Respaldo MTO';
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CATEGORY: Record<string, string[]> = {
  ejecutivos: ['Ejecutivos'],
  informativos: ['Informativos'],
  redgen: ['Redgen'],
  tx: ['Enviados'],
};
/** Pausa entre escrituras en Drive: ~3 por segundo, debajo del límite por usuario. */
const WRITE_PAUSE_MS = 350;
/** Cuánto trabaja cada madrugada: de 1:00 a 6:30 (hora de Argentina). */
const NIGHT_WINDOW_MS = 5.5 * 3600_000;
const BATCH = 100;
const LOCK_ID = 720261027;

export interface BackupStatus {
  enabled: boolean;
  account: string;
  total: number;
  backedUp: number;
  pendingFiles: number;
  running: boolean;
  lastRun: { startedAt: string; finishedAt: string | null; mto: number; files: number; errors: number; stoppedBy: string } | null;
  rootUrl: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Respaldo de los MTO en Google Drive (27/10/2026), en la cuenta
 * MTO_BACKUP_ACCOUNT (telematicodiredtos@iugna.edu.ar), carpeta "Respaldo MTO":
 *
 *   Respaldo MTO / AAAA / MM - Mes / DD / Ejecutivos | Informativos | Redgen | Enviados
 *                                       | Encriptados / PON | SIENA
 *                / … / <código del MTO> / <código>.msg + desencriptados (y SIENA)
 *
 * Cada madrugada de 1:00 a 6:30 sube los MTO que faltan, de los más nuevos a los
 * más viejos (los del día siempre entran primero y el resto se completa de a
 * poco), y agrega a su carpeta los desencriptados que TICOM haya subido después.
 * Qué está respaldado queda en mto_backups / mto_backup_files / mto_backup_folders:
 * nunca se duplica y, si una noche se corta, la siguiente sigue donde quedó.
 *
 * Solo corre donde MTO_BACKUP_ENABLED=true (producción): staging comparte la base
 * pero no tiene los desencriptados en su disco.
 */
@Injectable()
export class MtoBackupService implements OnModuleInit {
  private readonly logger = new Logger('RespaldoMTO');
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly gdrive: GoogleDriveService,
    private readonly mail: MailService,
  ) {}

  get enabled(): boolean {
    return this.config.get<string>('MTO_BACKUP_ENABLED') === 'true' && this.gdrive.isConfigured;
  }

  get account(): string {
    return (this.config.get<string>('MTO_BACKUP_ACCOUNT') || 'telematicodiredtos@iugna.edu.ar').toLowerCase();
  }

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "mto_backups" (
        "emailId" character varying PRIMARY KEY,
        "folderId" character varying NOT NULL,
        "parentId" character varying NOT NULL,
        "baseName" character varying NOT NULL,
        "folderName" character varying NOT NULL,
        "msgFileId" character varying,
        "backedUpAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )`);
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS "idx_mto_backups_parent_name" ON "mto_backups" ("parentId", "baseName")`,
    );
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "mto_backup_files" (
        "sourceId" character varying PRIMARY KEY,
        "kind" character varying NOT NULL,
        "emailId" character varying NOT NULL,
        "fileId" character varying NOT NULL,
        "backedUpAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )`);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "mto_backup_folders" (
        "path" character varying PRIMARY KEY,
        "folderId" character varying NOT NULL
      )`);
  }

  // ── Cuándo corre ──────────────────────────────────────────────────────────

  @Cron('0 1 * * *', { timeZone: ZONA_ARGENTINA })
  async nightly(): Promise<void> {
    if (!this.enabled) return;
    await this.run({ until: Date.now() + NIGHT_WINDOW_MS, reason: 'madrugada' });
  }

  // ── Estado (Administración → Respaldo MTO) ────────────────────────────────

  async status(): Promise<BackupStatus> {
    const [[{ total }], [{ done }], [{ pending }], [last], [root]] = await Promise.all([
      this.dataSource.query(`SELECT count(*)::int AS total FROM emails`),
      this.dataSource.query(`SELECT count(*)::int AS done FROM mto_backups WHERE "msgFileId" IS NOT NULL`),
      this.dataSource.query(`SELECT count(*)::int AS pending FROM (${this.pendingFilesSql()}) p`),
      this.dataSource.query(`SELECT "value" FROM app_markers WHERE "key" = 'mtoBackup.lastRun'`),
      this.dataSource.query(`SELECT "folderId" FROM mto_backup_folders WHERE "path" = ''`),
    ]);
    let lastRun: BackupStatus['lastRun'] = null;
    try {
      lastRun = last?.value ? JSON.parse(last.value) : null;
    } catch {
      /* marca rota: se ignora */
    }
    return {
      enabled: this.enabled,
      account: this.account,
      total,
      backedUp: done,
      pendingFiles: pending,
      running: this.running,
      lastRun,
      rootUrl: root?.folderId ? `https://drive.google.com/drive/folders/${root.folderId}` : null,
    };
  }

  // ── El trabajo ────────────────────────────────────────────────────────────

  private async run(opts: { until: number; limit?: number; reason: string }): Promise<void> {
    if (this.running) return;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let locked = false;
    const stats = { startedAt: new Date().toISOString(), finishedAt: null as string | null, mto: 0, files: 0, errors: 0, stoppedBy: 'terminó' };
    try {
      // Durante un pase sin corte conviven dos backends: que lo haga uno solo.
      const [{ ok }] = await runner.query(`SELECT pg_try_advisory_lock(${LOCK_ID}) AS ok`);
      if (!ok) return;
      locked = true;
      this.running = true;
      this.logger.log(`Respaldo de MTO (${opts.reason}) en ${this.account}: empieza`);

      const limit = opts.limit ?? Number.MAX_SAFE_INTEGER;
      let consecutiveErrors = 0;
      while (stats.mto < limit) {
        if (Date.now() > opts.until) { stats.stoppedBy = 'fin del horario'; break; }
        const ids: { id: string }[] = await this.dataSource.query(
          `SELECT e.id FROM emails e
            WHERE NOT EXISTS (SELECT 1 FROM mto_backups b WHERE b."emailId" = e.id::text AND b."msgFileId" IS NOT NULL)
            ORDER BY e.date DESC NULLS LAST LIMIT $1`,
          [Math.min(BATCH, limit - stats.mto)],
        );
        if (!ids.length) break;
        for (const { id } of ids) {
          if (Date.now() > opts.until || stats.mto >= limit) break;
          try {
            stats.files += await this.backupEmail(id);
            stats.mto++;
            consecutiveErrors = 0;
          } catch (err) {
            stats.errors++;
            consecutiveErrors++;
            this.logger.warn(`MTO ${id}: no se pudo respaldar: ${(err as Error).message}`);
            // Muchos errores seguidos = algo general (cuota, permisos, red): se para hasta mañana.
            if (consecutiveErrors >= 20) { stats.stoppedBy = 'demasiados errores seguidos'; break; }
          }
        }
        if (stats.stoppedBy !== 'terminó') break;
      }

      // Desencriptados y SIENA subidos después de respaldar su MTO.
      if (stats.stoppedBy === 'terminó' || stats.stoppedBy === 'fin del horario') {
        stats.files += await this.backupPendingFiles(opts.until, stats);
      }
      this.logger.log(
        `Respaldo de MTO (${opts.reason}): ${stats.mto} MTO y ${stats.files} archivos subidos, ${stats.errors} errores (${stats.stoppedBy})`,
      );
    } catch (err) {
      stats.stoppedBy = `error: ${(err as Error).message}`;
      this.logger.error(`Respaldo de MTO: se cortó: ${(err as Error).message}`);
    } finally {
      this.running = false;
      if (locked) {
        stats.finishedAt = new Date().toISOString();
        await this.dataSource
          .query(
            `INSERT INTO app_markers ("key", "value") VALUES ('mtoBackup.lastRun', $1)
             ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`,
            [JSON.stringify(stats)],
          )
          .catch(() => undefined);
        await runner.query(`SELECT pg_advisory_unlock(${LOCK_ID})`).catch(() => undefined);
      }
      await runner.release().catch(() => undefined);
    }
  }

  /** Un MTO: su carpeta, el .msg y sus desencriptados. Devuelve cuántos archivos extra subió. */
  private async backupEmail(emailId: string): Promise<number> {
    const [email] = await this.dataSource.query(
      `SELECT id, "mailCode", subject, "bodyText", folder, date FROM emails WHERE id = $1`,
      [emailId],
    );
    if (!email) return 0;
    const attachments: { filename: string; encryptedInside: boolean }[] = await this.dataSource.query(
      `SELECT filename, "encryptedInside" FROM attachments WHERE "emailId" = $1`,
      [emailId],
    );

    const parentId = await this.ensurePath(this.pathFor(email, attachments));
    const baseName = this.nameFor(email);

    // La carpeta del MTO: si quedó creada en una noche que se cortó, se reutiliza.
    const [row] = await this.dataSource.query(
      `SELECT "folderId", "folderName" FROM mto_backups WHERE "emailId" = $1`,
      [emailId],
    );
    let folderId: string = row?.folderId;
    let name: string = row?.folderName;
    if (!folderId) {
      // Mismo código el mismo día en la misma carpeta (una SVC, un reenvío): "DBE 123/26 (2)".
      const [{ n }] = await this.dataSource.query(
        `SELECT count(*)::int AS n FROM mto_backups WHERE "parentId" = $1 AND "baseName" = $2`,
        [parentId, baseName],
      );
      name = n ? `${baseName} (${n + 1})` : baseName;
      folderId = (await this.createFolder(parentId, name)).id!;
      await this.dataSource.query(
        `INSERT INTO mto_backups ("emailId", "folderId", "parentId", "baseName", "folderName") VALUES ($1, $2, $3, $4, $5)`,
        [emailId, folderId, parentId, baseName, name],
      );
    }

    const msg = await this.mail.exportMsg(emailId);
    const msgFile = await this.uploadBuffer(folderId, `${name}.msg`, 'application/vnd.ms-outlook', msg.data);
    await this.dataSource.query(`UPDATE mto_backups SET "msgFileId" = $2, "backedUpAt" = now() WHERE "emailId" = $1`, [emailId, msgFile.id]);

    let files = 0;
    for (const f of await this.extraFilesOf(emailId)) {
      if (await this.backupExtraFile(f, folderId, email.bodyText)) files++;
    }
    return files;
  }

  /** Año / mes / día (hora de Argentina) / carpeta del MTO; los encriptados aparte. */
  private pathFor(email: { subject: string; bodyText: string; folder: string; date: Date }, attachments: { filename: string; encryptedInside?: boolean }[]): string[] {
    const { year, month, day } = argentinaParts(new Date(email.date ?? Date.now()));
    const hasEncrypted = attachments.some((a) => isEncrypted(a));
    let category: string[];
    if (SienaFileService.isSiena(email.subject, email.bodyText)) category = ['Encriptados', 'SIENA'];
    else if (hasEncrypted || isEncryptedByLink(email.bodyText, hasEncrypted)) category = ['Encriptados', 'PON'];
    else category = CATEGORY[email.folder] ?? ['Informativos'];
    return [String(year), `${String(month).padStart(2, '0')} - ${MONTHS[month - 1]}`, String(day).padStart(2, '0'), ...category];
  }

  /** "DBE 123/26" (Drive acepta la barra); sin código, el asunto. */
  private nameFor(email: { mailCode: string | null; subject: string | null }): string {
    const raw = (email.mailCode || email.subject || 'MTO sin asunto').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return raw.slice(0, 150) || 'MTO sin asunto';
  }

  // ── Desencriptados y SIENA ────────────────────────────────────────────────

  private pendingFilesSql(): string {
    return `
      SELECT d.id::text AS "sourceId", 'decrypted' AS kind, d."emailId"::text AS "emailId", d.filename, d."storagePath"
        FROM decrypted_attachments d
        JOIN mto_backups b ON b."emailId" = d."emailId"::text AND b."msgFileId" IS NOT NULL
       WHERE NOT EXISTS (SELECT 1 FROM mto_backup_files f WHERE f."sourceId" = d.id::text)
      UNION ALL
      SELECT s.id::text, 'siena', s."emailId"::text, s.filename, s."storagePath"
        FROM siena_files s
        JOIN mto_backups b ON b."emailId" = s."emailId"::text AND b."msgFileId" IS NOT NULL
       WHERE NOT EXISTS (SELECT 1 FROM mto_backup_files f WHERE f."sourceId" = s.id::text)`;
  }

  private extraFilesOf(emailId: string): Promise<{ sourceId: string; kind: string; emailId: string; filename: string; storagePath: string }[]> {
    return this.dataSource.query(
      `SELECT d.id::text AS "sourceId", 'decrypted' AS kind, d."emailId"::text AS "emailId", d.filename, d."storagePath"
         FROM decrypted_attachments d WHERE d."emailId"::text = $1
           AND NOT EXISTS (SELECT 1 FROM mto_backup_files f WHERE f."sourceId" = d.id::text)
       UNION ALL
       SELECT s.id::text, 'siena', s."emailId"::text, s.filename, s."storagePath"
         FROM siena_files s WHERE s."emailId"::text = $1
           AND NOT EXISTS (SELECT 1 FROM mto_backup_files f WHERE f."sourceId" = s.id::text)`,
      [emailId],
    );
  }

  private async backupPendingFiles(until: number, stats: { errors: number }): Promise<number> {
    const pending: { sourceId: string; kind: string; emailId: string; filename: string; storagePath: string }[] =
      await this.dataSource.query(`${this.pendingFilesSql()} LIMIT 2000`);
    let n = 0;
    for (const f of pending) {
      if (Date.now() > until) break;
      try {
        const [b] = await this.dataSource.query(`SELECT "folderId" FROM mto_backups WHERE "emailId" = $1`, [f.emailId]);
        const [e] = await this.dataSource.query(`SELECT "bodyText" FROM emails WHERE id::text = $1`, [f.emailId]);
        if (b && (await this.backupExtraFile(f, b.folderId, e?.bodyText))) n++;
      } catch (err) {
        stats.errors++;
        this.logger.warn(`Desencriptado ${f.sourceId}: no se pudo respaldar: ${(err as Error).message}`);
      }
    }
    return n;
  }

  private async backupExtraFile(
    f: { sourceId: string; kind: string; emailId: string; filename: string; storagePath: string },
    folderId: string,
    bodyText: string | null,
  ): Promise<boolean> {
    if (!existsSync(f.storagePath)) return false; // en otro servidor (staging) o perdido
    const name = f.kind === 'decrypted' ? decryptedDisplayName(f.filename, f.storagePath, bodyText) : f.filename;
    const file = await this.withRetry(() =>
      this.gdrive.drive(this.account).files.create({
        requestBody: { name, parents: [folderId] },
        media: { mimeType: 'application/octet-stream', body: createReadStream(f.storagePath) },
        fields: 'id',
      }),
    );
    await this.dataSource.query(
      `INSERT INTO mto_backup_files ("sourceId", "kind", "emailId", "fileId") VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [f.sourceId, f.kind, f.emailId, file.data.id],
    );
    return true;
  }

  // ── Drive ─────────────────────────────────────────────────────────────────

  /** Crea (o encuentra) la cadena de carpetas y devuelve el id de la última. */
  private async ensurePath(segments: string[]): Promise<string> {
    let parent = await this.rootFolder();
    let path = '';
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg;
      const [cached] = await this.dataSource.query(`SELECT "folderId" FROM mto_backup_folders WHERE "path" = $1`, [path]);
      if (cached) { parent = cached.folderId; continue; }
      const id = (await this.findFolder(parent, seg)) ?? (await this.createFolder(parent, seg)).id!;
      await this.dataSource.query(
        `INSERT INTO mto_backup_folders ("path", "folderId") VALUES ($1, $2) ON CONFLICT ("path") DO NOTHING`,
        [path, id],
      );
      parent = id;
    }
    return parent;
  }

  private async rootFolder(): Promise<string> {
    const [cached] = await this.dataSource.query(`SELECT "folderId" FROM mto_backup_folders WHERE "path" = ''`);
    if (cached) return cached.folderId;
    const id = (await this.findFolder('root', ROOT_NAME)) ?? (await this.createFolder('root', ROOT_NAME)).id!;
    await this.dataSource.query(`INSERT INTO mto_backup_folders ("path", "folderId") VALUES ('', $1) ON CONFLICT ("path") DO NOTHING`, [id]);
    return id;
  }

  private async findFolder(parentId: string, name: string): Promise<string | null> {
    const q = `'${parentId}' in parents and name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const res = await this.withRetry(() => this.gdrive.drive(this.account).files.list({ q, fields: 'files(id)', pageSize: 1 }), false);
    return res.data.files?.[0]?.id ?? null;
  }

  private async createFolder(parentId: string, name: string) {
    const res = await this.withRetry(() =>
      this.gdrive.drive(this.account).files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        fields: 'id',
      }),
    );
    return res.data;
  }

  private async uploadBuffer(parentId: string, name: string, mimeType: string, data: Buffer) {
    const res = await this.withRetry(() =>
      this.gdrive.drive(this.account).files.create({
        requestBody: { name, parents: [parentId] },
        media: { mimeType, body: Readable.from(data) },
        fields: 'id',
      }),
    );
    return res.data;
  }

  /**
   * Reintenta lo que Drive rechaza por exceso de pedidos (403 rateLimit, 429) o
   * fallas suyas (5xx), esperando cada vez más. Después de cada escritura, una
   * pausa corta para no pasar el límite por usuario.
   */
  private async withRetry<T>(fn: () => Promise<T>, isWrite = true): Promise<T> {
    let wait = 2000;
    for (let attempt = 1; ; attempt++) {
      try {
        const out = await fn();
        if (isWrite) await sleep(WRITE_PAUSE_MS);
        return out;
      } catch (err) {
        const e = err as { code?: number; response?: { status?: number }; errors?: { reason?: string }[] };
        const status = Number(e.code ?? e.response?.status ?? 0);
        const reason = e.errors?.[0]?.reason ?? '';
        const retryable = status === 429 || status >= 500 || (status === 403 && /rateLimit|userRateLimit|backendError/i.test(reason));
        if (!retryable || attempt >= 6) throw err;
        await sleep(wait);
        wait = Math.min(wait * 2, 64_000);
      }
    }
  }
}
