import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, In, Repository } from 'typeorm';
import { drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import * as fs from 'fs/promises';
import { OfficeDrive } from './entities/office-drive.entity';
import { SharedItem } from './entities/shared-item.entity';
import { MAX_PREVIEW_BYTES, convertToPdf, googleEditUrl, previewKind } from './preview.util';
import { GroupPermission } from '../admin/entities/group-permission.entity';
import { User } from '../users/entities/user.entity';
import { AdminService } from '../admin/admin.service';
import { GoogleDriveService, isDriveId } from './google-drive.service';
import { NotificationsService } from '../notifications/notifications.service';

const DRIVE_NAME_PREFIX = 'Intranet - ';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.';
/** "Administrador de contenido": sube, edita, mueve y borra; no maneja miembros. */
const MEMBER_ROLE = 'fileOrganizer';
/** Tope al subir por los padres de un archivo; Drive no permite más de 100 niveles. */
const MAX_FOLDER_DEPTH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Como Google: 1 GB = 1024³ bytes. */
const GB = 1024 ** 3;
/** Cada cuánto se vuelve a preguntar a Drive cuánto ocupa una unidad. */
const USAGE_MAX_AGE_MS = 10 * 60_000;

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
  previewable: boolean;
  /** Para editarlo en Documentos/Hojas/Presentaciones de Google; null si no aplica. */
  googleUrl: string | null;
  size: number | null;
  modifiedTime: string | null;
  modifiedBy: string | null;
}

export interface FileStream {
  stream: Readable;
  name: string;
  mimeType: string;
  size: number | null;
}

/**
 * Hasta dónde llega el acceso de quien opera: toda la unidad de su oficina, o
 * solo algo que le compartieron (y su contenido, si es una carpeta).
 */
export interface AccessScope {
  office: OfficeDrive;
  /** Cuenta en cuyo nombre se opera en Drive. */
  actor: string;
  rootId: string;
  rootName: string;
  canWrite: boolean;
  /** Presente cuando el acceso es por algo compartido. */
  share?: SharedItem;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  path: string;
  size: number;
}

/** Espacio de una oficina. */
export interface OfficeUsage {
  groupName: string;
  quotaBytes: number;
  /** Papelera de Drive incluida, como lo cuenta Google. */
  usedBytes: number;
  trashedBytes: number;
  updatedAt: Date | null;
}

export type CurrentUser = Pick<User, 'username' | 'email' | 'roles'>;
export type Uploader = Pick<User, 'username' | 'displayName' | 'firstName' | 'lastName'>;

/** 1.5 GB, 320 MB… para los mensajes. */
function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = i === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits).replace('.', ',').replace(/,0$/, '')} ${units[i]}`;
}

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
    @InjectRepository(SharedItem) private readonly shareRepo: Repository<SharedItem>,
    private readonly gdrive: GoogleDriveService,
    private readonly adminService: AdminService,
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
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
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "shared_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "driveId" varchar NOT NULL,
        "groupName" varchar NOT NULL,
        "fileId" varchar NOT NULL,
        "fileName" varchar NOT NULL,
        "isFolder" boolean NOT NULL DEFAULT false,
        "sharedWith" varchar NOT NULL,
        "sharedWithName" varchar NULL,
        "sharedBy" varchar NOT NULL,
        "sharedByName" varchar NOT NULL,
        "role" varchar NOT NULL DEFAULT 'reader',
        "drivePermissionId" varchar NULL,
        "seenAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        UNIQUE ("fileId", "sharedWith")
      )`);
    await this.dataSource.query(`ALTER TABLE "shared_items" ADD COLUMN IF NOT EXISTS "drivePermissionId" varchar NULL`);
    await this.dataSource.query(`
      ALTER TABLE "office_drives"
        ADD COLUMN IF NOT EXISTS "quotaBytes" bigint NULL,
        ADD COLUMN IF NOT EXISTS "usedBytes" bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "trashedBytes" bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "usageAt" timestamp NULL`);
  }

  // ─── Espacio por oficina ───────────────────────────────────────────────────

  /** Espacio por defecto de cada oficina (SHARED_FOLDERS_QUOTA_GB, 5 GB si no se define). */
  private get defaultQuotaBytes(): number {
    const gb = Number(this.config.get('SHARED_FOLDERS_QUOTA_GB') ?? 5);
    return Math.round((Number.isFinite(gb) && gb > 0 ? gb : 5) * GB);
  }

  private quotaOf(office: OfficeDrive | null): number {
    return office?.quotaBytes ?? this.defaultQuotaBytes;
  }

  private toUsage(groupName: string, office: OfficeDrive | null): OfficeUsage {
    return {
      groupName,
      quotaBytes: this.quotaOf(office),
      usedBytes: office?.usedBytes ?? 0,
      trashedBytes: office?.trashedBytes ?? 0,
      updatedAt: office?.usageAt ?? null,
    };
  }

  /**
   * Recalcula lo que ocupa la unidad preguntándole a Drive. Si hay algo en la
   * papelera (borrado desde Drive), la vacía: Google la sigue contando 30 días
   * y quien libera espacio tiene que verlo libre enseguida.
   */
  async refreshUsage(office: OfficeDrive): Promise<OfficeDrive> {
    let { used, trashed } = await this.gdrive.driveUsage(office.driveId);
    if (trashed > 0) {
      try {
        await this.gdrive.emptyTrash(office.driveId);
        this.logger.log(`Papelera de ${office.groupName} vaciada (${formatBytes(trashed)})`);
        used -= trashed;
        trashed = 0;
      } catch (err) {
        this.logger.warn(`No se pudo vaciar la papelera de ${office.groupName}: ${(err as Error).message}`);
      }
    }
    office.usedBytes = used;
    office.trashedBytes = trashed;
    office.usageAt = new Date();
    await this.driveRepo.update(office.id, { usedBytes: used, trashedBytes: trashed, usageAt: office.usageAt });
    return office;
  }

  /**
   * Uso de la unidad. Entre recálculos se lleva sumando y restando lo que pasa
   * por la intranet; lo que se hace directo en Drive aparece al recalcular.
   */
  private async usageOf(office: OfficeDrive, maxAgeMs = USAGE_MAX_AGE_MS): Promise<OfficeDrive> {
    if (office.usageAt && Date.now() - office.usageAt.getTime() < maxAgeMs) return office;
    try {
      return await this.refreshUsage(office);
    } catch (err) {
      this.logger.warn(`No se pudo calcular el espacio de ${office.groupName}: ${(err as Error).message}`);
      return office;
    }
  }

  private async addUsage(office: OfficeDrive, bytes: number): Promise<void> {
    if (!bytes) return;
    await this.driveRepo
      .createQueryBuilder()
      .update()
      .set({ usedBytes: () => `GREATEST(0, "usedBytes" + ${Math.trunc(bytes)})` })
      .where('id = :id', { id: office.id })
      .execute();
    office.usedBytes = Math.max(0, office.usedBytes + bytes);
  }

  /** Espacio de las oficinas del usuario (para el inicio y Archivos compartidos). */
  async myUsage(user: CurrentUser, fresh = false): Promise<OfficeUsage[]> {
    if (!this.gdrive.isConfigured) return [];
    const { allowedModules } = await this.adminService.getEffectiveModules(user.roles ?? []);
    if (!allowedModules.includes('carpetas')) return [];
    return this.usageFor(await this.userOffices(user), fresh);
  }

  /** Todas las oficinas (TICOM). */
  async allUsage(): Promise<OfficeUsage[]> {
    if (!this.gdrive.isConfigured) return [];
    const groups = await this.groupRepo.find({ where: { category: 'oficina' } });
    return this.usageFor(groups.map((g) => g.groupName).sort((a, b) => a.localeCompare(b)));
  }

  /** Las oficinas que todavía no abrieron su unidad figuran vacías. */
  private async usageFor(groups: string[], fresh = false): Promise<OfficeUsage[]> {
    if (!groups.length) return [];
    const drives = await this.driveRepo.find({ where: { groupName: In(groups) } });
    const byGroup = new Map(drives.map((d) => [d.groupName.toUpperCase(), d]));
    return Promise.all(
      groups.map(async (g) => {
        const drive = byGroup.get(g.toUpperCase());
        return this.toUsage(g, drive ? await this.usageOf(drive, fresh ? 0 : USAGE_MAX_AGE_MS) : null);
      }),
    );
  }

  // ─── Oficinas y acceso ──────────────────────────────────────────────────────

  /**
   * Oficinas cuya unidad puede abrir el usuario. Sin el módulo "carpetas" no
   * hay ninguna, pero igual puede ver lo que le compartieron.
   */
  async myOffices(user: CurrentUser) {
    if (!this.gdrive.isConfigured) return { configured: false, offices: [], googleEmail: null };
    const { allowedModules } = await this.adminService.getEffectiveModules(user.roles ?? []);
    return {
      configured: true,
      offices: allowedModules.includes('carpetas') ? await this.userOffices(user) : [],
      // Para abrir en Documentos de Google con esa cuenta (authuser).
      googleEmail: await this.googleEmailOf(user.username, user.email),
    };
  }

  /** Cuenta @iugna.edu.ar activa de un usuario, o null si no tiene. */
  async googleEmailOf(username: string, mail?: string | null): Promise<string | null> {
    try {
      const email = this.gdrive.emailFor(username, mail);
      return (await this.gdrive.domainAccounts()).has(email) ? email : null;
    } catch (err) {
      this.logger.warn(`No se pudo consultar las cuentas del dominio: ${(err as Error).message}`);
      return null;
    }
  }

  /** Si quien tiene esos roles es de la oficina: ya ve toda su unidad, no hace falta compartirle. */
  async isOfficeMember(roles: string[] | null | undefined, groupName: string): Promise<boolean> {
    return (await this.userOffices({ roles: roles ?? [] } as CurrentUser)).some(
      (o) => o.toUpperCase() === groupName.toUpperCase(),
    );
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
    return (await this.googleEmailOf(user.username, user.email)) !== null;
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
    // También el espacio: así aparece lo que se subió o borró directo en Drive.
    for (const office of offices) await this.usageOf(office, 0);
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

  // ─── Ámbitos de acceso ─────────────────────────────────────────────────────

  /** Acceso de un integrante a toda la unidad de su oficina. */
  async officeScope(user: CurrentUser, groupName: string): Promise<AccessScope> {
    const office = await this.officeDrive(user, groupName);
    return {
      office,
      actor: await this.actorFor(user, office),
      rootId: office.driveId,
      rootName: office.groupName,
      canWrite: true,
    };
  }

  /**
   * Acceso a algo compartido con el usuario. Se opera como la cuenta dueña:
   * quien lo recibe no es miembro de la unidad en Drive, el permiso es de la
   * intranet. No exige el módulo "carpetas": cualquiera puede recibir.
   */
  async shareScope(user: CurrentUser, shareId: string): Promise<AccessScope> {
    if (!this.gdrive.isConfigured) {
      throw new ServiceUnavailableException('Las carpetas compartidas no están configuradas.');
    }
    const share = UUID.test(shareId ?? '')
      ? await this.shareRepo.findOne({ where: { id: shareId, sharedWith: user.username.toLowerCase() } })
      : null;
    const office = share ? await this.driveRepo.findOne({ where: { driveId: share.driveId } }) : null;
    if (!share || !office) throw new NotFoundException('Ya no está compartido con vos.');
    return {
      office,
      actor: this.gdrive.ownerEmail,
      rootId: share.fileId,
      rootName: share.fileName,
      canWrite: share.role === 'writer',
      share,
    };
  }

  private assertWritable(scope: AccessScope, fileId?: string): void {
    if (!scope.canWrite) throw new ForbiddenException('Solo tenés permiso para ver lo que te compartieron.');
    if (scope.share && fileId === scope.rootId) {
      throw new BadRequestException('Lo que te compartieron no se puede renombrar ni borrar; solo su contenido.');
    }
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
   * Ejecuta la operación en nombre de scope.actor; si Google le niega el
   * acceso (p. ej. el permiso recién agregado todavía no se propagó) la
   * reintenta como la cuenta dueña. Traduce los errores de Google a HTTP.
   */
  private async as<T>(scope: AccessScope, op: (actAs: string) => Promise<T>): Promise<T> {
    return this.run(async () => {
      try {
        return await op(scope.actor);
      } catch (err) {
        if (err instanceof HttpException) throw err;
        const status = googleStatus(err);
        if (scope.actor !== this.gdrive.ownerEmail && (status === 403 || status === 404)) {
          this.logger.warn(`Drive negó el acceso a ${scope.actor} en ${scope.office.groupName}; reintento como la cuenta dueña`);
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
        throw new BadRequestException('El documento es demasiado grande para convertirlo.');
      }
      if (status === 404) throw new NotFoundException('El archivo no existe o fue borrado.');
      this.logger.error(`Error de Google Drive: ${message}`);
      throw new ServiceUnavailableException('Google Drive no respondió. Probá de nuevo en unos minutos.');
    }
  }

  /**
   * El archivo tiene que estar en la unidad y fuera de la papelera. Si el
   * acceso es por algo compartido, además tiene que estar dentro de eso: se
   * sube por los padres hasta encontrarlo o llegar a la raíz de la unidad.
   */
  private async assertInScope(actAs: string, scope: AccessScope, file: drive_v3.Schema$File): Promise<void> {
    const notFound = new NotFoundException('El archivo no existe o fue borrado.');
    if (!file || file.driveId !== scope.office.driveId || file.trashed) throw notFound;
    if (scope.rootId === scope.office.driveId) return;
    let current = file;
    for (let depth = 0; depth < MAX_FOLDER_DEPTH; depth++) {
      if (current.id === scope.rootId) return;
      const parent = current.parents?.[0];
      if (!parent || parent === scope.office.driveId) break;
      current = await this.gdrive.getFile(actAs, parent);
      if (current.trashed) break;
    }
    throw notFound;
  }

  /** Carpeta validada: la indicada o, sin indicar, la raíz del ámbito. */
  private async folderIn(actAs: string, scope: AccessScope, folderId?: string): Promise<drive_v3.Schema$File> {
    const id = folderId || scope.rootId;
    if (id === scope.office.driveId) {
      if (scope.rootId !== scope.office.driveId) throw new NotFoundException('La carpeta no existe.');
      return { id, name: scope.rootName };
    }
    if (!isDriveId(id)) throw new NotFoundException('La carpeta no existe.');
    const folder = await this.gdrive.getFile(actAs, id);
    await this.assertInScope(actAs, scope, folder);
    if (folder.mimeType !== FOLDER_MIME) throw new BadRequestException('No es una carpeta.');
    return folder;
  }

  private async fileIn(actAs: string, scope: AccessScope, fileId: string): Promise<drive_v3.Schema$File> {
    if (!isDriveId(fileId) || fileId === scope.office.driveId) throw new NotFoundException('El archivo no existe.');
    const file = await this.gdrive.getFile(actAs, fileId);
    await this.assertInScope(actAs, scope, file);
    return file;
  }

  /** Un archivo o carpeta validado dentro del ámbito (para compartirlo). */
  fileInScope(scope: AccessScope, fileId: string): Promise<drive_v3.Schema$File> {
    return this.as(scope, (actAs) => this.fileIn(actAs, scope, fileId));
  }

  /** Metadatos actuales de un archivo, como la cuenta dueña; null si ya no existe. */
  async currentFile(fileId: string): Promise<drive_v3.Schema$File | null> {
    try {
      const file = await this.gdrive.getFile(this.gdrive.ownerEmail, fileId);
      return file.trashed ? null : file;
    } catch {
      return null;
    }
  }

  toShared(f: drive_v3.Schema$File): SharedFile {
    const mimeType = f.mimeType ?? '';
    const isFolder = mimeType === FOLDER_MIME;
    const isGoogleDoc = !isFolder && mimeType.startsWith(GOOGLE_APPS_PREFIX);
    const name = f.name ?? '';
    return {
      id: f.id!,
      name,
      mimeType,
      isFolder,
      isGoogleDoc,
      downloadable: !isFolder && (!isGoogleDoc || !!GOOGLE_EXPORTS[mimeType]),
      previewable: !isFolder && previewKind(mimeType, name) !== 'none',
      googleUrl: googleEditUrl(f.id!, mimeType, name),
      size: f.size ? Number(f.size) : null,
      modifiedTime: f.modifiedTime ?? null,
      modifiedBy: f.lastModifyingUser?.displayName ?? null,
    };
  }

  private cleanName(name: string): string {
    const clean = (name ?? '').replace(/[\u0000-\u001f]/g, '').trim();
    if (!clean) throw new BadRequestException('El nombre no puede estar vacío.');
    if (clean.length > 255) throw new BadRequestException('El nombre es demasiado largo.');
    return clean;
  }

  /**
   * Contenido de una carpeta. Con withPath devuelve además la ruta desde la
   * raíz del ámbito (sin incluirla), para abrir una subcarpeta directamente
   * desde una notificación.
   */
  async list(scope: AccessScope, folderId?: string, withPath = false) {
    return this.as(scope, async (actAs) => {
      const folder = await this.folderIn(actAs, scope, folderId);
      const [files, path] = await Promise.all([
        this.gdrive.listChildren(actAs, scope.office.driveId, folder.id!),
        withPath ? this.pathTo(actAs, scope, folder) : Promise.resolve(undefined),
      ]);
      return {
        folder: { id: folder.id!, name: folder.name ?? scope.rootName },
        rootId: scope.rootId,
        canWrite: scope.canWrite,
        files: files.map((f) => this.toShared(f)),
        path,
      };
    });
  }

  /** Carpetas desde la raíz del ámbito (excluida) hasta `folder` (incluida). */
  private async pathTo(actAs: string, scope: AccessScope, folder: drive_v3.Schema$File): Promise<{ id: string; name: string }[]> {
    const chain: { id: string; name: string }[] = [];
    let current = folder;
    for (let depth = 0; depth < MAX_FOLDER_DEPTH; depth++) {
      if (!current.id || current.id === scope.rootId || current.id === scope.office.driveId) break;
      chain.unshift({ id: current.id, name: current.name ?? '' });
      const parent = current.parents?.[0];
      if (!parent) break;
      current = await this.gdrive.getFile(actAs, parent);
    }
    return chain;
  }

  async createFolder(scope: AccessScope, parentId: string | undefined, name: string) {
    this.assertWritable(scope);
    const clean = this.cleanName(name);
    return this.as(scope, async (actAs) => {
      const parent = await this.folderIn(actAs, scope, parentId);
      return this.toShared(await this.gdrive.createFolder(actAs, parent.id!, clean));
    });
  }

  async upload(scope: AccessScope, parentId: string | undefined, files: UploadedFile[], uploader: Uploader) {
    try {
      this.assertWritable(scope);
      if (!files?.length) throw new BadRequestException('No se recibió ningún archivo.');
      await this.assertRoomFor(scope.office, files);
      const { parent, uploaded } = await this.as(scope, async (actAs) => {
        const parent = await this.folderIn(actAs, scope, parentId);
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
        return { parent, uploaded };
      });
      await this.addUsage(scope.office, uploaded.reduce((sum, f) => sum + (f.size ?? 0), 0));
      void this.notifyUpload(scope, parent, uploaded, uploader);
      return uploaded;
    } finally {
      await this.discardUploads(files);
    }
  }

  /**
   * Lo compartido cuenta para la oficina dueña, no para quien lo recibe. Lo
   * que se sube directo en Drive no pasa por acá: lo frena el límite que se
   * configura en la consola de Google.
   */
  private async assertRoomFor(office: OfficeDrive, files: UploadedFile[]): Promise<void> {
    const incoming = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
    let current = await this.usageOf(office);
    let quota = this.quotaOf(current);
    if (incoming <= quota - current.usedBytes) return;
    // Antes de rechazar, el dato fresco: quizás borraron algo desde Drive.
    current = await this.usageOf(office, 0);
    quota = this.quotaOf(current);
    const free = Math.max(0, quota - current.usedBytes);
    if (incoming <= free) return;
    throw new PayloadTooLargeException(
      `No hay espacio en ${office.groupName}: quedan ${formatBytes(free)} libres de ${formatBytes(quota)} ` +
        `y querés subir ${formatBytes(incoming)}. Eliminá archivos para liberar lugar.`,
    );
  }

  /**
   * Avisa a los demás integrantes de la oficina: una notificación por subida
   * aunque sean varios archivos. Lleva los archivos para que quien tenga esa
   * carpeta abierta los vea aparecer sin recargar.
   */
  private async notifyUpload(scope: AccessScope, parent: drive_v3.Schema$File, files: SharedFile[], uploader: Uploader): Promise<void> {
    try {
      const group = scope.office.groupName;
      const members = await this.userRepo
        .createQueryBuilder('u')
        .select(['u.username'])
        .where('u.isActive = true')
        .andWhere('LOWER(u.username) <> :me', { me: uploader.username.toLowerCase() })
        .andWhere(`EXISTS (SELECT 1 FROM unnest(string_to_array(u.roles, ',')) r WHERE UPPER(r) = UPPER(:group))`, { group })
        .getMany();
      if (!members.length) return;

      const who = [uploader.firstName, uploader.lastName].filter(Boolean).join(' ') || uploader.displayName || uploader.username;
      const n = files.length;
      const names = files.slice(0, 3).map((f) => f.name).join(', ');
      await this.notifications.notify(
        members.map((m) => m.username),
        {
          type: 'upload',
          title: `${who} subió ${n === 1 ? 'un archivo' : `${n} archivos`} a ${group}`,
          body: n > 3 ? `${names} y ${n - 3} más` : names,
          data: {
            groupName: group,
            folderId: parent.id,
            folderName: parent.id === scope.office.driveId ? group : parent.name,
            fileIds: files.map((f) => f.id),
            files,
          },
        },
      );
    } catch (err) {
      this.logger.warn(`No se pudo avisar la subida a ${scope.office.groupName}: ${(err as Error).message}`);
    }
  }

  /** Borra los temporales que dejó multer. */
  async discardUploads(files: UploadedFile[] | undefined): Promise<void> {
    await Promise.all((files ?? []).map((f) => fs.unlink(f.path).catch(() => undefined)));
  }

  async rename(scope: AccessScope, fileId: string, name: string) {
    this.assertWritable(scope, fileId);
    const clean = this.cleanName(name);
    return this.as(scope, async (actAs) => {
      await this.fileIn(actAs, scope, fileId);
      return this.toShared(await this.gdrive.rename(actAs, fileId, clean));
    });
  }

  /**
   * Borra para siempre (libera el espacio en el momento). Quien opera solo
   * necesita poder ver el archivo: el borrado lo hace la cuenta dueña.
   */
  async remove(scope: AccessScope, fileId: string): Promise<void> {
    this.assertWritable(scope, fileId);
    const file = await this.as(scope, async (actAs) => {
      const file = await this.fileIn(actAs, scope, fileId);
      await this.gdrive.deleteForever(fileId);
      return file;
    });
    if (file.mimeType === FOLDER_MIME) {
      // Lo que tenía adentro no se conoce sin recorrerla: se recalcula, con
      // unos segundos para que la búsqueda de Drive ya no lo incluya.
      setTimeout(() => void this.usageOf(scope.office, 0), 10_000);
    } else {
      await this.addUsage(scope.office, -(Number(file.quotaBytesUsed ?? file.size ?? 0) || 0));
    }
  }

  async download(scope: AccessScope, fileId: string): Promise<FileStream> {
    return this.as(scope, async (actAs) => {
      const file = await this.fileIn(actAs, scope, fileId);
      const mimeType = file.mimeType ?? 'application/octet-stream';
      if (mimeType === FOLDER_MIME) throw new BadRequestException('Las carpetas no se pueden descargar.');
      if (mimeType.startsWith(GOOGLE_APPS_PREFIX)) {
        const exp = GOOGLE_EXPORTS[mimeType];
        if (!exp) throw new BadRequestException('Este tipo de archivo de Google no se puede descargar.');
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

  /** Vista previa dentro de la intranet, como los adjuntos de MTO. */
  async preview(scope: AccessScope, fileId: string): Promise<FileStream> {
    return this.as(scope, async (actAs) => {
      const file = await this.fileIn(actAs, scope, fileId);
      const mimeType = file.mimeType ?? '';
      const name = file.name ?? 'archivo';
      if (file.size && Number(file.size) > MAX_PREVIEW_BYTES) {
        throw new PayloadTooLargeException('Es demasiado grande para verlo acá. Descargalo.');
      }
      const pdf = { name: `${name}.pdf`, mimeType: 'application/pdf', size: null };
      switch (previewKind(mimeType, name)) {
        case 'inline':
          return { stream: await this.gdrive.download(actAs, fileId), name, mimeType, size: null };
        case 'text':
          return { stream: await this.gdrive.download(actAs, fileId), name, mimeType: 'text/plain; charset=utf-8', size: null };
        case 'google-pdf':
          return { ...pdf, stream: await this.gdrive.exportAs(actAs, fileId, 'application/pdf') };
        case 'convert': {
          const source = await this.gdrive.download(actAs, fileId);
          const stream = await convertToPdf(source, name).catch((err: Error) => {
            this.logger.warn(`No se pudo convertir ${name} a PDF: ${err.message}`);
            throw new UnprocessableEntityException('No se pudo generar la vista previa de este documento. Descargalo.');
          });
          return { ...pdf, stream };
        }
        default:
          throw new UnsupportedMediaTypeException('Este tipo de archivo no tiene vista previa. Descargalo.');
      }
    });
  }
}
