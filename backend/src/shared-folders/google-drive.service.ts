import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, drive_v3 } from 'googleapis';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { Readable } from 'stream';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/admin.directory.user';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Cuántos minutos se reutiliza la lista de cuentas del dominio. */
const ACCOUNTS_TTL_MS = 10 * 60_000;

export const FILE_FIELDS =
  'id,name,mimeType,size,modifiedTime,driveId,parents,trashed,webViewLink,lastModifyingUser(displayName,emailAddress)';

export interface DriveMember {
  permissionId: string;
  email: string;
  role: string;
}

/** Los IDs de Drive son alfanuméricos con - y _: se valida antes de usarlos en consultas. */
export function isDriveId(id: string): boolean {
  return /^[A-Za-z0-9_-]{10,100}$/.test(id);
}

/**
 * Acceso a Google Drive con la cuenta de servicio y delegación de dominio.
 *
 * Las unidades compartidas las crea y administra la cuenta "dueña"
 * (GOOGLE_DRIVE_OWNER_EMAIL, o la de administración si no se define). Las
 * operaciones de los usuarios se hacen en nombre de cada uno (`actAs`), así
 * Drive registra el autor real de cada archivo.
 */
@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);
  private readonly clients = new Map<string, drive_v3.Drive>();
  private accounts: { emails: Set<string>; at: number } | null = null;

  constructor(private readonly configService: ConfigService) {}

  get isConfigured(): boolean {
    return !!(this.configService.get('GOOGLE_SERVICE_ACCOUNT_PATH') && this.ownerEmail);
  }

  get ownerEmail(): string {
    return (
      this.configService.get<string>('GOOGLE_DRIVE_OWNER_EMAIL') ||
      this.configService.get<string>('GOOGLE_WORKSPACE_ADMIN_EMAIL') ||
      ''
    ).toLowerCase();
  }

  get domain(): string {
    return (this.configService.get<string>('GOOGLE_WORKSPACE_DOMAIN') ?? 'iugna.edu.ar').toLowerCase();
  }

  /** Cuenta de Google de un usuario: su mail del AD si es del dominio, si no usuario@dominio. */
  emailFor(username: string, mail?: string | null): string {
    const m = mail?.trim().toLowerCase();
    return m?.endsWith(`@${this.domain}`) ? m : `${username}@${this.domain}`.toLowerCase();
  }

  private credentials(scopes: string[], subject: string) {
    const keyPath = this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_PATH')!;
    const key = JSON.parse(fs.readFileSync(keyPath, 'utf-8')) as { client_email: string; private_key: string };
    return new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes, subject });
  }

  /** Cliente de Drive en nombre de `email` (por defecto, la cuenta dueña). */
  drive(email: string = this.ownerEmail): drive_v3.Drive {
    let client = this.clients.get(email);
    if (!client) {
      client = google.drive({ version: 'v3', auth: this.credentials([DRIVE_SCOPE], email) });
      this.clients.set(email, client);
    }
    return client;
  }

  /** Cuentas activas del dominio (en minúsculas), cacheadas unos minutos. */
  async domainAccounts(force = false): Promise<Set<string>> {
    if (!force && this.accounts && Date.now() - this.accounts.at < ACCOUNTS_TTL_MS) {
      return this.accounts.emails;
    }
    const directory = google.admin({
      version: 'directory_v1',
      auth: this.credentials([DIRECTORY_SCOPE], this.configService.get<string>('GOOGLE_WORKSPACE_ADMIN_EMAIL')!),
    });
    const emails = new Set<string>();
    let pageToken: string | undefined;
    do {
      const res = await directory.users.list({
        domain: this.domain,
        maxResults: 500,
        pageToken,
        fields: 'nextPageToken,users(primaryEmail,suspended)',
      });
      for (const u of res.data.users ?? []) {
        if (u.primaryEmail && !u.suspended) emails.add(u.primaryEmail.toLowerCase());
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    this.accounts = { emails, at: Date.now() };
    return emails;
  }

  // ─── Unidades compartidas y miembros (siempre como la cuenta dueña) ─────────

  async createSharedDrive(name: string): Promise<string> {
    const d = this.drive();
    const res = await d.drives.create({ requestId: randomUUID(), requestBody: { name }, fields: 'id' });
    const driveId = res.data.id!;
    try {
      // Nadie de afuera del dominio puede recibir archivos de la unidad.
      await d.drives.update({ driveId, requestBody: { restrictions: { domainUsersOnly: true } } });
    } catch (err) {
      this.logger.warn(`No se pudo restringir la unidad ${name} al dominio: ${(err as Error).message}`);
    }
    this.logger.log(`Unidad compartida creada: ${name} (${driveId})`);
    return driveId;
  }

  async listMembers(driveId: string): Promise<DriveMember[]> {
    const members: DriveMember[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.drive().permissions.list({
        fileId: driveId,
        supportsAllDrives: true,
        pageSize: 100,
        pageToken,
        fields: 'nextPageToken,permissions(id,emailAddress,role,type)',
      });
      for (const p of res.data.permissions ?? []) {
        if (p.type === 'user' && p.emailAddress && p.id) {
          members.push({ permissionId: p.id, email: p.emailAddress.toLowerCase(), role: p.role ?? '' });
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return members;
  }

  async addMember(driveId: string, email: string, role: string): Promise<void> {
    await this.drive().permissions.create({
      fileId: driveId,
      supportsAllDrives: true,
      sendNotificationEmail: false,
      requestBody: { type: 'user', role, emailAddress: email },
    });
  }

  async updateMember(driveId: string, permissionId: string, role: string): Promise<void> {
    await this.drive().permissions.update({
      fileId: driveId,
      permissionId,
      supportsAllDrives: true,
      requestBody: { role },
    });
  }

  async removeMember(driveId: string, permissionId: string): Promise<void> {
    await this.drive().permissions.delete({ fileId: driveId, permissionId, supportsAllDrives: true });
  }

  // ─── Archivos (en nombre de quien opera) ────────────────────────────────────

  async listChildren(actAs: string, driveId: string, folderId: string): Promise<drive_v3.Schema$File[]> {
    if (!isDriveId(folderId)) return [];
    const files: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.drive(actAs).files.list({
        corpora: 'drive',
        driveId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        q: `'${folderId}' in parents and trashed = false`,
        orderBy: 'folder,name_natural',
        pageSize: 1000,
        pageToken,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
      });
      files.push(...(res.data.files ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return files;
  }

  async getFile(actAs: string, fileId: string): Promise<drive_v3.Schema$File> {
    const res = await this.drive(actAs).files.get({ fileId, supportsAllDrives: true, fields: FILE_FIELDS });
    return res.data;
  }

  async createFolder(actAs: string, parentId: string, name: string): Promise<drive_v3.Schema$File> {
    const res = await this.drive(actAs).files.create({
      supportsAllDrives: true,
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      fields: FILE_FIELDS,
    });
    return res.data;
  }

  async upload(
    actAs: string,
    parentId: string,
    file: { name: string; mimeType: string; path: string },
  ): Promise<drive_v3.Schema$File> {
    const res = await this.drive(actAs).files.create({
      supportsAllDrives: true,
      requestBody: { name: file.name, parents: [parentId] },
      media: { mimeType: file.mimeType, body: fs.createReadStream(file.path) },
      fields: FILE_FIELDS,
    });
    return res.data;
  }

  async rename(actAs: string, fileId: string, name: string): Promise<drive_v3.Schema$File> {
    const res = await this.drive(actAs).files.update({
      fileId,
      supportsAllDrives: true,
      requestBody: { name },
      fields: FILE_FIELDS,
    });
    return res.data;
  }

  /** A la papelera de la unidad: se puede recuperar desde Drive durante 30 días. */
  async trash(actAs: string, fileId: string): Promise<void> {
    await this.drive(actAs).files.update({ fileId, supportsAllDrives: true, requestBody: { trashed: true } });
  }

  async download(actAs: string, fileId: string): Promise<Readable> {
    const res = await this.drive(actAs).files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    return res.data as unknown as Readable;
  }

  async exportAs(actAs: string, fileId: string, mimeType: string): Promise<Readable> {
    const res = await this.drive(actAs).files.export({ fileId, mimeType }, { responseType: 'stream' });
    return res.data as unknown as Readable;
  }
}
