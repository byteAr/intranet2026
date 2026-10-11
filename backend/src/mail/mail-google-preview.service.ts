import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import { extname } from 'path';
import { GoogleDriveService } from '../shared-folders/google-drive.service';
import { User } from '../users/entities/user.entity';
import { Attachment } from './entities/attachment.entity';

/** Tipos que se muestran con el visor de Google (Word, Excel, PowerPoint). */
const OFFICE_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods']);
/** Carpeta del "Mi unidad" de cada usuario donde quedan las copias para ver. */
const FOLDER_NAME = 'Intranet - Vista previa de MTO (se borra sola)';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Las copias se borran del Drive del usuario pasados estos días. */
const KEEP_DAYS = 7;

export interface GooglePreview {
  available: boolean;
  url?: string;
  /** Por qué no (para el log del navegador; la ventana usa el visor propio). */
  reason?: string;
}

/**
 * Vista previa de Word/Excel de los MTO con el visor de Google (11/10/2026),
 * solo lectura, para quien tiene cuenta @iugna.edu.ar: se copia el adjunto a
 * una carpeta del Drive del usuario (en su nombre, delegación de dominio) y se
 * muestra drive.google.com/file/d/<id>/preview dentro de la ventana. La copia
 * se reutiliza (tabla mail_google_previews) y se borra a los KEEP_DAYS días.
 * Nunca para los desencriptados ni los de SIENA (no pasan por acá) ni los
 * originales cifrados (.~NN). Sin cuenta, o si falla, la ventana usa el visor propio.
 */
@Injectable()
export class MailGooglePreviewService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailGooglePreviewService.name);
  /** Carpeta de cada cuenta (para no buscarla cada vez). */
  private readonly folders = new Map<string, string>();

  constructor(
    private readonly gdrive: GoogleDriveService,
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "mail_google_previews" (
          "googleEmail" character varying NOT NULL,
          "attachmentId" uuid NOT NULL,
          "fileId" character varying NOT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          PRIMARY KEY ("googleEmail", "attachmentId")
        )`);
    } catch (err) {
      this.logger.error(`No se pudo crear mail_google_previews: ${(err as Error).message}`);
    }
  }

  /** Si el adjunto es de Office (y no un cifrado .~NN). */
  static isOffice(filename: string): boolean {
    return OFFICE_EXT.has(extname(filename ?? '').toLowerCase());
  }

  async previewFor(userId: string, username: string, att: Attachment): Promise<GooglePreview> {
    if (!this.gdrive.isConfigured) return { available: false, reason: 'Google no está configurado' };
    if (!MailGooglePreviewService.isOffice(att.filename)) return { available: false, reason: 'no es Word ni Excel' };
    if (!fs.existsSync(att.storagePath)) return { available: false, reason: 'el archivo no está en el servidor' };

    const user = await this.users.findOne({ where: { id: userId }, select: ['id', 'email'] });
    const email = this.gdrive.emailFor(username, user?.email);
    try {
      if (!(await this.gdrive.domainAccounts()).has(email)) return { available: false, reason: 'sin cuenta @iugna.edu.ar' };

      const drive = this.gdrive.drive(email);
      const [cached] = await this.dataSource.query(
        `SELECT "fileId" FROM "mail_google_previews" WHERE "googleEmail" = $1 AND "attachmentId" = $2`,
        [email, att.id],
      );
      if (cached) {
        try {
          const f = await drive.files.get({ fileId: cached.fileId, fields: 'id,trashed' });
          if (f.data.id && !f.data.trashed) return { available: true, url: this.viewerUrl(cached.fileId, email) };
        } catch {
          /* la borró: se vuelve a subir */
        }
      }

      const folderId = await this.folderOf(email);
      const created = await drive.files.create({
        requestBody: { name: att.filename, parents: [folderId] },
        media: { mimeType: att.contentType || 'application/octet-stream', body: fs.createReadStream(att.storagePath) },
        fields: 'id',
      });
      const fileId = created.data.id!;
      await this.dataSource.query(
        `INSERT INTO "mail_google_previews" ("googleEmail", "attachmentId", "fileId") VALUES ($1, $2, $3)
         ON CONFLICT ("googleEmail", "attachmentId") DO UPDATE SET "fileId" = EXCLUDED."fileId", "createdAt" = now()`,
        [email, att.id, fileId],
      );
      return { available: true, url: this.viewerUrl(fileId, email) };
    } catch (err) {
      this.logger.warn(`Vista previa en Google de ${att.filename} para ${email}: ${(err as Error).message}`);
      return { available: false, reason: 'Google no respondió' };
    }
  }

  /** Visor de Drive (solo lectura), con la cuenta @iugna elegida si el navegador tiene varias. */
  private viewerUrl(fileId: string, email: string): string {
    return `https://drive.google.com/file/d/${fileId}/preview?authuser=${encodeURIComponent(email)}`;
  }

  private async folderOf(email: string): Promise<string> {
    const known = this.folders.get(email);
    if (known) return known;
    const drive = this.gdrive.drive(email);
    const found = await drive.files.list({
      q: `name = '${FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
    });
    let id = found.data.files?.[0]?.id;
    if (!id) {
      const created = await drive.files.create({
        requestBody: { name: FOLDER_NAME, mimeType: FOLDER_MIME, parents: ['root'] },
        fields: 'id',
      });
      id = created.data.id!;
    }
    this.folders.set(email, id);
    return id;
  }

  /** Todas las noches: borra del Drive de cada usuario las copias de más de KEEP_DAYS días. */
  @Cron('15 4 * * *')
  async purgeOld(): Promise<void> {
    if (!this.gdrive.isConfigured) return;
    let rows: { googleEmail: string; attachmentId: string; fileId: string }[] = [];
    try {
      rows = await this.dataSource.query(
        `SELECT "googleEmail", "attachmentId", "fileId" FROM "mail_google_previews"
          WHERE "createdAt" < now() - make_interval(days => $1)`,
        [KEEP_DAYS],
      );
    } catch {
      return;
    }
    for (const r of rows) {
      try {
        await this.gdrive.drive(r.googleEmail).files.delete({ fileId: r.fileId });
      } catch {
        /* ya no estaba: igual se saca de la tabla */
      }
      await this.dataSource.query(
        `DELETE FROM "mail_google_previews" WHERE "googleEmail" = $1 AND "attachmentId" = $2`,
        [r.googleEmail, r.attachmentId],
      );
    }
    if (rows.length) this.logger.log(`Vista previa en Google: ${rows.length} copias viejas borradas`);
  }
}
