import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource, Repository } from 'typeorm';
import { drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import * as fs from 'fs/promises';
import { OfficeDrive } from './entities/office-drive.entity';
import { GroupPermission } from '../admin/entities/group-permission.entity';
import { User } from '../users/entities/user.entity';
import { AdminService } from '../admin/admin.service';
import { GoogleDriveService, isDriveId } from './google-drive.service';

const DRIVE_NAME_PREFIX = 'Intranet - ';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.';
/** "Administrador de contenido": sube, edita, mueve y borra; no maneja miembros. */
const MEMBER_ROLE = 'fileOrganizer';

/** Los archivos nativos de Google se descargan convertidos a formato Office/PDF. */
const GOOGLE_EXPORTS: Record<string, { mimeType: string; ext: string }> = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
  },
  'application/vnd.google-apps.drawing': { mimeType: 'application/pdf', ext: 'pdf' },
};

export interface SharedFile {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  isGoogleDoc: boolean;
  downloadable: boolean;
  size: number | null;
  modifiedTime: string | null;
  modifiedBy: string | null;
  webViewLink: string | null;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  path: string;
}

type CurrentUser = Pick<User, 'username' | 'email' | 'roles'>;

/** Código HTTP de un error de la API de Google. */
function googleStatus(err: unknown): number | undefined {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  const code = Number(e?.code ?? e?.status ?? e?.response?.status);
  return Number.isFinite(code) ? code : undefined;
}

@Injectable()
export class SharedFoldersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SharedFoldersService.name);
  /** Evita crear dos unidades para la misma oficina si llegan pedidos simultáneos. */
  private readonly creating = new Map<string, Promise<OfficeDrive>>();
  /** driveId → cuentas con acceso según la última sincronización. */
  private readonly members = new Map<string, Set<string>>();

  constructor(
    @InjectRepository(OfficeDrive) private readonly driveRepo: Repository<OfficeDrive>,
    @InjectRepository(GroupPermission) private readonly groupRepo: Repository<GroupPermission>,
    private readonly gdrive: GoogleDriveService,
    private readonly adminService: AdminService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Con NODE_ENV=production TypeORM no sincroniza el esquema: la tabla se crea
   * acá si falta. Si la sincronización está activa ya existe y no hace nada.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "office_drives" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "groupName" varchar NOT NULL UNIQUE,
        "driveId" varchar NOT NULL,
        "lastSyncAt" timestamp NULL,
        "lastSyncError" text NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )`);
  }

  // ─── Oficinas y acceso ──────────────────────────────────────────────────────

  async myOffices(user: CurrentUser) {
    if (!this.gdrive.isConfigured) return { configured: false, hasGoogleAccount: false, offices: [] };
    const [offices, hasGoogleAccount] = await Promise.all([this.userOffices(user), this.hasGoogleAccount(user)]);
    return { configured: true, hasGoogleAccount, offices };
  }

  /** Oficinas (grupos AD con category='oficina') a las que pertenece el usuario. */
  private async userOffices(user: CurrentUser): Promise<string[]> {
    const groups = await this.groupRepo.find({ where: { category: 'oficina' } });
    const roles = new Set((user.roles ?? []).map((r) => r.toUpperCase()));
    return groups
      .map((g) => g.groupName)
      .filter((name) => roles.has(name.toUpperCase()))
      .sort((a, b) => a.localeCompare(b));
  }

  private async hasGoogleAccount(user: CurrentUser): Promise<boolean> {
    try {
      const accounts = await this.gdrive.domainAccounts();
      return accounts.has(this.gdrive.emailFor(user.username, user.email));
    } catch (err) {
      this.logger.warn(`No se pudo consultar las cuentas del dominio: ${(err as Error).message}`);
      return false;
    }
  }

  /** Verifica que el usuario pertenezca a la oficina y devuelve su unidad (la crea la primera vez). */
  private async officeDrive(user: CurrentUser, groupName: string): Promise<OfficeDrive> {
    if (!this.gdrive.isConfigured) {
      throw new ServiceUnavailableException('Las carpetas compartidas no están configuradas.');
    }
    const { allowedModules } = await this.adminService.getEffectiveModules(user.roles ?? []);
    if (!allowedModules.includes('carpetas')) {
      throw new ForbiddenException('Tu grupo no tiene habilitadas las carpetas compartidas.');
    }
    const office = (await this.userOffices(user)).find((o) => o.toUpperCase() === groupName?.toUpperCase());
    if (!office) throw new ForbiddenException('No pertenecés a esa oficina.');

    const existing = await this.driveRepo.findOne({ where: { groupName: office } });
    if (existing) return existing;

    let pending = this.creating.get(office);
    if (!pending) {
      pending = this.createOfficeDrive(office).finally(() => this.creating.delete(office));
      this.creating.set(office, pending);
    }
    return pending;
  }

  private async createOfficeDrive(groupName: string): Promise<OfficeDrive> {
    const driveId = await this.run(() => this.gdrive.createSharedDrive(`${DRIVE_NAME_PREFIX}${groupName}`));
    const office = await this.driveRepo.save(this.driveRepo.create({ groupName, driveId }));
    await this.syncMembers(office);
    return office;
  }

  // ─── Sincronización de miembros con el AD ──────────────────────────────────

  @Cron('*/30 * * * *')
  async syncAll(): Promise<void> {
    if (!this.gdrive.isConfigured) return;
    const offices = await this.driveRepo.find();
    if (!offices.length) return;
    let adUsers: Awaited<ReturnType<AdminService['listAdUsers']>>;
    try {
      adUsers = await this.adminService.listAdUsers();
    } catch (err) {
      this.logger.error(`Sincronización de carpetas: el AD no respondió: ${(err as Error).message}`);
      return;
    }
    for (const office of offices) await this.syncMembers(office, adUsers);
  }

  /**
   * Deja como miembros de la unidad exactamente a los integrantes habilitados
   * del grupo AD que tienen cuenta de Google. Los "administradores" de la
   * unidad (organizer) no se tocan: se gestionan a mano desde Drive.
   */
  async syncMembers(
    office: OfficeDrive,
    adUsers?: Awaited<ReturnType<AdminService['listAdUsers']>>,
  ): Promise<void> {
    try {
      const users = adUsers ?? (await this.adminService.listAdUsers());
      const accounts = await this.gdrive.domainAccounts(true);
      const owner = this.gdrive.ownerEmail;
      const group = office.groupName.toUpperCase();

      const desired = new Set(
        users
          .filter((u) => u.enabled && (u.groups ?? []).some((g) => g.toUpperCase() === group))
          .map((u) => this.gdrive.emailFor(u.username, u.email))
          .filter((email) => accounts.has(email) && email !== owner),
      );

      const current = await this.gdrive.listMembers(office.driveId);
      const withAccess = new Set<string>([owner]);
      let added = 0, removed = 0, updated = 0;

      for (const m of current) {
        if (m.email === owner || m.role === 'organizer') {
          withAccess.add(m.email);
        } else if (!desired.has(m.email)) {
          await this.gdrive.removeMember(office.driveId, m.permissionId);
          removed++;
        } else if (m.role !== MEMBER_ROLE) {
          await this.gdrive.updateMember(office.driveId, m.permissionId, MEMBER_ROLE);
          updated++;
        }
      }
      const currentEmails = new Set(current.map((m) => m.email));
      for (const email of desired) {
        if (!currentEmails.has(email)) {
          await this.gdrive.addMember(office.driveId, email, MEMBER_ROLE);
          added++;
        }
        withAccess.add(email);
      }

      this.members.set(office.driveId, withAccess);
      office.lastSyncAt = new Date();
      office.lastSyncError = null;
      await this.driveRepo.save(office);
      if (added || removed || updated) {
        this.logger.log(`Carpeta ${office.groupName}: +${added} -${removed} ~${updated} miembros`);
      }
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Sincronización de la carpeta ${office.groupName} falló: ${message}`);
      office.lastSyncError = message.slice(0, 1000);
      await this.driveRepo.save(office);
    }
  }

  /** Fuerza la sincronización de todas las unidades (botón en Admin). */
  async syncNow() {
    await this.syncAll();
    const offices = await this.driveRepo.find({ order: { groupName: 'ASC' } });
    return offices.map((o) => ({
      groupName: o.groupName,
      lastSyncAt: o.lastSyncAt,
      lastSyncError: o.lastSyncError,
    }));
  }

  // ─── Operaciones con archivos ──────────────────────────────────────────────

  /**
   * En nombre de quién se opera: el propio usuario si tiene cuenta de Google y
   * ya es miembro de la unidad (así Drive registra al autor real); si no, la
   * cuenta dueña. El acceso ya lo validó la intranet en officeDrive().
   */
  private async actorFor(user: CurrentUser, office: OfficeDrive): Promise<string> {
    if (!(await this.hasGoogleAccount(user))) return this.gdrive.ownerEmail;
    const email = this.gdrive.emailFor(user.username, user.email);
    if (!this.members.get(office.driveId)?.has(email)) await this.syncMembers(office);
    return this.members.get(office.driveId)?.has(email) ? email : this.gdrive.ownerEmail;
  }

  /**
   * Ejecuta la operación como el usuario; si Google le niega el acceso (p. ej.
   * el permiso recién agregado todavía no se propagó) la reintenta como la
   * cuenta dueña. Traduce los errores de Google a respuestas HTTP claras.
   */
  private async as<T>(user: CurrentUser, office: OfficeDrive, op: (actAs: string) => Promise<T>): Promise<T> {
    const actor = await this.actorFor(user, office);
    return this.run(async () => {
      try {
        return await op(actor);
      } catch (err) {
        if (err instanceof HttpException) throw err;
        const status = googleStatus(err);
        if (actor !== this.gdrive.ownerEmail && (status === 403 || status === 404)) {
          this.logger.warn(`Drive negó el acceso a ${actor} en ${office.groupName}; reintento como la cuenta dueña`);
          return op(this.gdrive.ownerEmail);
        }
        throw err;
      }
    });
  }

  private async run<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const message = (err as Error).message ?? '';
      const status = googleStatus(err);
      if (/unauthorized_client|invalid_grant/i.test(message)) {
        this.logger.error(`Google rechazó la delegación de dominio: ${message}`);
        throw new ServiceUnavailableException(
          'Google no autorizó el acceso a Drive. Falta habilitar el permiso de Drive para la cuenta de servicio en la consola de administración de Google.',
        );
      }
      if (/exportSizeLimitExceeded|too large to be exported/i.test(message)) {
        throw new BadRequestException('El documento es demasiado grande para descargarlo convertido. Abrilo en Google Drive.');
      }
      if (status === 404) throw new NotFoundException('El archivo no existe o fue borrado.');
      this.logger.error(`Error de Google Drive: ${message}`);
      throw new ServiceUnavailableException('Google Drive no respondió. Probá de nuevo en unos minutos.');
    }
  }

  private assertInDrive(file: drive_v3.Schema$File, office: OfficeDrive): void {
    if (!file || file.driveId !== office.driveId || file.trashed) {
      throw new NotFoundException('El archivo no existe o fue borrado.');
    }
  }

  /** Carpeta destino validada: la raíz de la unidad o una carpeta dentro de ella. */
  private async folderIn(actAs: string, office: OfficeDrive, folderId?: string): Promise<drive_v3.Schema$File> {
    if (!folderId || folderId === office.driveId) return { id: office.driveId, name: office.groupName };
    if (!isDriveId(folderId)) throw new NotFoundException('La carpeta no existe.');
    const folder = await this.gdrive.getFile(actAs, folderId);
    this.assertInDrive(folder, office);
    if (folder.mimeType !== FOLDER_MIME) throw new BadRequestException('No es una carpeta.');
    return folder;
  }

  private async fileIn(actAs: string, office: OfficeDrive, fileId: string): Promise<drive_v3.Schema$File> {
    if (!isDriveId(fileId) || fileId === office.driveId) throw new NotFoundException('El archivo no existe.');
    const file = await this.gdrive.getFile(actAs, fileId);
    this.assertInDrive(file, office);
    return file;
  }

  private toShared(f: drive_v3.Schema$File): SharedFile {
    const mimeType = f.mimeType ?? '';
    const isFolder = mimeType === FOLDER_MIME;
    const isGoogleDoc = !isFolder && mimeType.startsWith(GOOGLE_APPS_PREFIX);
    return {
      id: f.id!,
      name: f.name ?? '',
      mimeType,
      isFolder,
      isGoogleDoc,
      downloadable: !isFolder && (!isGoogleDoc || !!GOOGLE_EXPORTS[mimeType]),
      size: f.size ? Number(f.size) : null,
      modifiedTime: f.modifiedTime ?? null,
      modifiedBy: f.lastModifyingUser?.displayName ?? null,
      webViewLink: f.webViewLink ?? null,
    };
  }

  private cleanName(name: string): string {
    const clean = (name ?? '').replace(/[\u0000-\u001f]/g, '').trim();
    if (!clean) throw new BadRequestException('El nombre no puede estar vacío.');
    if (clean.length > 255) throw new BadRequestException('El nombre es demasiado largo.');
    return clean;
  }

  async list(user: CurrentUser, groupName: string, folderId?: string) {
    const office = await this.officeDrive(user, groupName);
    return this.as(user, office, async (actAs) => {
      const folder = await this.folderIn(actAs, office, folderId);
      const files = await this.gdrive.listChildren(actAs, office.driveId, folder.id!);
      return {
        driveId: office.driveId,
        folder: { id: folder.id!, name: folder.name ?? office.groupName },
        files: files.map((f) => this.toShared(f)),
      };
    });
  }

  async createFolder(user: CurrentUser, groupName: string, parentId: string | undefined, name: string) {
    const office = await this.officeDrive(user, groupName);
    const clean = this.cleanName(name);
    return this.as(user, office, async (actAs) => {
      const parent = await this.folderIn(actAs, office, parentId);
      return this.toShared(await this.gdrive.createFolder(actAs, parent.id!, clean));
    });
  }

  async upload(user: CurrentUser, groupName: string, parentId: string | undefined, files: UploadedFile[]) {
    try {
      if (!files?.length) throw new BadRequestException('No se recibió ningún archivo.');
      const office = await this.officeDrive(user, groupName);
      return await this.as(user, office, async (actAs) => {
        const parent = await this.folderIn(actAs, office, parentId);
        const uploaded: SharedFile[] = [];
        for (const f of files) {
          const created = await this.gdrive.upload(actAs, parent.id!, {
            // multer entrega el nombre como latin1; se recupera el UTF-8 original
            name: this.cleanName(Buffer.from(f.originalname, 'latin1').toString('utf8')),
            mimeType: f.mimetype || 'application/octet-stream',
            path: f.path,
          });
          uploaded.push(this.toShared(created));
        }
        return uploaded;
      });
    } finally {
      await Promise.all((files ?? []).map((f) => fs.unlink(f.path).catch(() => undefined)));
    }
  }

  async rename(user: CurrentUser, groupName: string, fileId: string, name: string) {
    const office = await this.officeDrive(user, groupName);
    const clean = this.cleanName(name);
    return this.as(user, office, async (actAs) => {
      await this.fileIn(actAs, office, fileId);
      return this.toShared(await this.gdrive.rename(actAs, fileId, clean));
    });
  }

  async trash(user: CurrentUser, groupName: string, fileId: string): Promise<void> {
    const office = await this.officeDrive(user, groupName);
    await this.as(user, office, async (actAs) => {
      await this.fileIn(actAs, office, fileId);
      await this.gdrive.trash(actAs, fileId);
    });
  }

  async download(
    user: CurrentUser,
    groupName: string,
    fileId: string,
  ): Promise<{ stream: Readable; name: string; mimeType: string; size: number | null }> {
    const office = await this.officeDrive(user, groupName);
    return this.as(user, office, async (actAs) => {
      const file = await this.fileIn(actAs, office, fileId);
      const mimeType = file.mimeType ?? 'application/octet-stream';
      if (mimeType === FOLDER_MIME) throw new BadRequestException('Las carpetas no se pueden descargar.');
      if (mimeType.startsWith(GOOGLE_APPS_PREFIX)) {
        const exp = GOOGLE_EXPORTS[mimeType];
        if (!exp) throw new BadRequestException('Este tipo de archivo solo se puede abrir en Google Drive.');
        return {
          stream: await this.gdrive.exportAs(actAs, fileId, exp.mimeType),
          name: `${file.name}.${exp.ext}`,
          mimeType: exp.mimeType,
          size: null,
        };
      }
      return {
        stream: await this.gdrive.download(actAs, fileId),
        name: file.name ?? 'archivo',
        mimeType,
        size: file.size ? Number(file.size) : null,
      };
    });
  }
}
