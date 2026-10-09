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
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.';
/** "Administrador de contenido": sube, edita, mueve y borra; no maneja miembros. */
const MEMBER_ROLE = 'fileOrganizer';
/** Tope al subir por los padres de un archivo; Drive no permite más de 100 niveles. */
const MAX_FOLDER_DEPTH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Como Google: 1 GB = 1024³ bytes. */
const GB = 1024 ** 3;
/**
 * Máximo por archivo (subida directa a Google): SHARED_FOLDERS_MAX_FILE_GB,
 * 100 GB por defecto (hasta la 1.6.0 eran 10). Igual manda el espacio libre
 * de la oficina; Google acepta hasta 750 GB por día y por cuenta.
 */
function maxFileBytes(): number {
  const gb = Number(process.env.SHARED_FOLDERS_MAX_FILE_GB);
  return (Number.isFinite(gb) && gb > 0 ? gb : 100) * GB;
}
/** Cada cuánto se vuelve a preguntar a Drive cuánto ocupa una unidad. */
const USAGE_MAX_AGE_MS = 10 * 60_000;

/** Los archivos nativos de Google se descargan convertidos a formato Office/PDF. */
export const GOOGLE_EXPORTS: Record<string, { mimeType: string; ext: string }> = {
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
  /** La oficina, o PERSONAL_KEY para "Mis archivos". */
  groupName: string;
  /** Cómo mostrarlo: la oficina, o "Mis archivos". */
  label: string;
  quotaBytes: number;
  /** Papelera de Drive incluida, como lo cuenta Google. */
  usedBytes: number;
  trashedBytes: number;
  /** Integrantes habilitados del grupo en el AD (base del espacio automático). */
  memberCount: number;
  /** De dónde sale el espacio. */
  quotaRule: QuotaRule;
  gbPerMember: number;
  /** El espacio lo fijó TICOM a mano. */
  manualQuota: boolean;
  /** La oficina ya abrió Archivos compartidos (tiene su unidad en Drive). */
  opened: boolean;
  updatedAt: Date | null;
}

export type QuotaRule = 'manual' | 'per-member' | 'minimum' | 'maximum' | 'personal';

/**
 * "Mis archivos": en las rutas va en lugar de la oficina (/shared-folders/~mis-archivos/...).
 * En la base, el espacio de cada usuario se guarda con groupName '@usuario'.
 */
export const PERSONAL_KEY = '~mis-archivos';
const PERSONAL_NAME = 'Mis archivos';
/** Carpeta que se crea en el Drive personal ("Mi unidad") de cada usuario. */
const PERSONAL_FOLDER_NAME = 'Intranet - Mis archivos';

export function personalKeyOf(username: string): string {
  return `@${username.toLowerCase()}`;
}

/** La unidad donde buscar; null en "Mis archivos" (está en el Drive personal). */
export function driveIdOf(office: OfficeDrive): string | null {
  return office.kind === 'personal' ? null : office.driveId;
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
  /** Carpetas de "Mis archivos" que ya se comprobó que existen (una vez por proceso). */
  private readonly personalChecked = new Set<string>();

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
        ADD COLUMN IF NOT EXISTS "usageAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "memberCount" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "kind" varchar NOT NULL DEFAULT 'office',
        ADD COLUMN IF NOT EXISTS "ownerEmail" varchar NULL`);
    // Las unidades que ya existían no tienen contados sus integrantes todavía.
    if (this.gdrive.isConfigured && (await this.driveRepo.count({ where: { memberCount: 0, kind: 'office' } }))) {
      setTimeout(() => void this.syncAll(), 20_000);
    }
  }

  // ─── Espacio por oficina ───────────────────────────────────────────────────

  /** GB de configuración (con su valor por defecto si falta o no es válido). */
  private gbSetting(key: string, fallback: number): number {
    const gb = Number(this.config.get(key) ?? fallback);
    return Number.isFinite(gb) && gb > 0 ? gb : fallback;
  }

  /**
   * Espacio de una oficina: el que fijó TICOM o, si no, 2 GB por integrante
   * habilitado del AD, entre un mínimo y un tope (10 y 40 GB por defecto).
   */
  private quotaRule(memberCount: number, manualBytes: number | null): { bytes: number; rule: QuotaRule; gbPerMember: number } {
    const gbPerMember = this.gbSetting('SHARED_FOLDERS_GB_PER_MEMBER', 2);
    if (manualBytes) return { bytes: manualBytes, rule: 'manual', gbPerMember };
    const min = this.gbSetting('SHARED_FOLDERS_MIN_GB', 10);
    const max = Math.max(min, this.gbSetting('SHARED_FOLDERS_MAX_GB', 40));
    const byMembers = memberCount * gbPerMember;
    const gb = Math.min(max, Math.max(min, byMembers));
    const rule: QuotaRule = byMembers < min ? 'minimum' : byMembers > max ? 'maximum' : 'per-member';
    return { bytes: Math.round(gb * GB), rule, gbPerMember };
  }

  /** "Mis archivos": 10 GB por persona (SHARED_FOLDERS_PERSONAL_GB), o lo que fije TICOM. */
  private personalQuota(space: OfficeDrive | null): number {
    return space?.quotaBytes || Math.round(this.gbSetting('SHARED_FOLDERS_PERSONAL_GB', 10) * GB);
  }

  private quotaOf(office: OfficeDrive | null): number {
    if (office?.kind === 'personal') return this.personalQuota(office);
    return this.quotaRule(office?.memberCount ?? 0, office?.quotaBytes ?? null).bytes;
  }

  /** Cómo se nombra el espacio en los mensajes y en la barra. */
  private spaceLabel(office: OfficeDrive): string {
    return office.kind === 'personal' ? PERSONAL_NAME : office.groupName;
  }

  /** Espacio de "Mis archivos" (null: todavía no lo abrió). */
  private personalUsage(space: OfficeDrive | null): OfficeUsage {
    return {
      groupName: PERSONAL_KEY,
      label: PERSONAL_NAME,
      quotaBytes: this.personalQuota(space),
      quotaRule: space?.quotaBytes ? 'manual' : 'personal',
      gbPerMember: 0,
      usedBytes: space?.usedBytes ?? 0,
      trashedBytes: 0,
      memberCount: 1,
      manualQuota: !!space?.quotaBytes,
      opened: !!space,
      updatedAt: space?.usageAt ?? null,
    };
  }

  /** `memberCount` para las oficinas que todavía no abrieron su unidad (se cuentan en el AD). */
  private toUsage(groupName: string, office: OfficeDrive | null, memberCount?: number): OfficeUsage {
    const members = office?.memberCount || memberCount || 0;
    const { bytes, rule, gbPerMember } = this.quotaRule(members, office?.quotaBytes ?? null);
    return {
      groupName,
      label: groupName,
      quotaBytes: bytes,
      quotaRule: rule,
      gbPerMember,
      usedBytes: office?.usedBytes ?? 0,
      trashedBytes: office?.trashedBytes ?? 0,
      memberCount: members,
      manualQuota: rule === 'manual',
      opened: !!office,
      updatedAt: office?.usageAt ?? null,
    };
  }

  /** Integrantes habilitados de cada grupo según el AD (para las oficinas sin unidad todavía). */
  private async adMemberCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    try {
      for (const u of await this.adminService.listAdUsers()) {
        if (!u.enabled) continue;
        for (const g of u.groups ?? []) counts.set(g.toUpperCase(), (counts.get(g.toUpperCase()) ?? 0) + 1);
      }
    } catch (err) {
      this.logger.warn(`No se pudo contar los integrantes en el AD: ${(err as Error).message}`);
    }
    return counts;
  }

  /** TICOM fija el espacio de una oficina a mano; null vuelve al cálculo por integrantes. */
  async setQuota(groupName: string, gb: number | null): Promise<OfficeUsage> {
    if (gb !== null && !(Number.isFinite(gb) && gb > 0 && gb <= 1000)) {
      throw new BadRequestException('El espacio tiene que ser un número de GB entre 1 y 1000.');
    }
    const office = await this.driveRepo
      .createQueryBuilder('d')
      .where('UPPER(d.groupName) = UPPER(:g)', { g: groupName ?? '' })
      .getOne();
    if (!office) throw new NotFoundException('Esa oficina todavía no abrió Archivos compartidos.');
    office.quotaBytes = gb === null ? null : Math.round(gb * GB);
    await this.driveRepo.update(office.id, { quotaBytes: office.quotaBytes });
    this.logger.log(`Espacio de ${office.groupName}: ${gb === null ? 'automático' : `${gb} GB`} (TICOM)`);
    return this.toUsage(office.groupName, office);
  }

  /**
   * Recalcula lo que ocupa la unidad preguntándole a Drive. Si hay algo en la
   * papelera (borrado desde Drive), la vacía: Google la sigue contando 30 días
   * y quien libera espacio tiene que verlo libre enseguida.
   */
  async refreshUsage(office: OfficeDrive): Promise<OfficeDrive> {
    if (office.kind === 'personal') {
      // Su papelera es del usuario (puede tener otras cosas): no se toca ni se cuenta.
      office.usedBytes = await this.gdrive.folderUsage(office.ownerEmail!, office.driveId);
      office.trashedBytes = 0;
      office.usageAt = new Date();
      await this.driveRepo.update(office.id, { usedBytes: office.usedBytes, trashedBytes: 0, usageAt: office.usageAt });
      return office;
    }
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
    const offices = allowedModules.includes('carpetas') ? await this.usageFor(await this.userOffices(user), fresh) : [];
    // "Mis archivos", para quien tiene cuenta de Google (sin ella no hay dónde guardarlo).
    if (!(await this.googleEmailOf(user.username, user.email))) return offices;
    const space = await this.driveRepo.findOne({ where: { groupName: personalKeyOf(user.username) } });
    return [...offices, this.personalUsage(space ? await this.usageOf(space, fresh ? 0 : USAGE_MAX_AGE_MS) : null)];
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
    const counts = groups.some((g) => !byGroup.has(g.toUpperCase())) ? await this.adMemberCounts() : new Map<string, number>();
    return Promise.all(
      groups.map(async (g) => {
        const drive = byGroup.get(g.toUpperCase());
        if (!drive) return this.toUsage(g, null, counts.get(g.toUpperCase()));
        return this.toUsage(g, await this.usageOf(drive, fresh ? 0 : USAGE_MAX_AGE_MS));
      }),
    );
  }

  // ─── Oficinas y acceso ──────────────────────────────────────────────────────

  /**
   * Oficinas cuya unidad puede abrir el usuario. Sin el módulo "carpetas" no
   * hay ninguna, pero igual puede ver lo que le compartieron.
   */
  async myOffices(user: CurrentUser) {
    if (!this.gdrive.isConfigured) return { configured: false, offices: [], googleEmail: null, maxFileBytes: maxFileBytes() };
    const { allowedModules } = await this.adminService.getEffectiveModules(user.roles ?? []);
    return {
      configured: true,
      offices: allowedModules.includes('carpetas') ? await this.userOffices(user) : [],
      // Para abrir en Documentos de Google con esa cuenta (authuser).
      googleEmail: await this.googleEmailOf(user.username, user.email),
      // El navegador avisa antes de empezar a subir algo más grande.
      maxFileBytes: maxFileBytes(),
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
    // Solo las unidades de oficina: "Mis archivos" no tiene miembros que sincronizar.
    const offices = await this.driveRepo.find({ where: { kind: 'office' } });
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
    // Una carpeta personal no es una unidad: tocar sus permisos le quitaría el acceso al dueño.
    if (office.kind === 'personal') return;
    try {
      const users = adUsers ?? (await this.adminService.listAdUsers());
      const accounts = await this.gdrive.domainAccounts(true);
      const owner = this.gdrive.ownerEmail;
      const group = office.groupName.toUpperCase();

      const officeUsers = users.filter((u) => u.enabled && (u.groups ?? []).some((g) => g.toUpperCase() === group));
      const desired = new Set(
        officeUsers
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
      // El espacio se calcula con todos los integrantes, tengan o no cuenta de Google.
      office.memberCount = officeUsers.length;
      // Solo estos campos: guardar el registro entero pisaría el uso con un valor viejo.
      await this.driveRepo.update(office.id, {
        lastSyncAt: office.lastSyncAt,
        lastSyncError: null,
        memberCount: office.memberCount,
      });
      if (added || removed || updated) {
        this.logger.log(`Carpeta ${office.groupName}: +${added} -${removed} ~${updated} miembros`);
      }
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Sincronización de la carpeta ${office.groupName} falló: ${message}`);
      office.lastSyncError = message.slice(0, 1000);
      await this.driveRepo.update(office.id, { lastSyncError: office.lastSyncError });
    }
  }

  /** Fuerza la sincronización de todas las unidades (botón en Admin). */
  async syncNow() {
    await this.syncAll();
    const offices = await this.driveRepo.find({ where: { kind: 'office' }, order: { groupName: 'ASC' } });
    return offices.map((o) => ({
      groupName: o.groupName,
      lastSyncAt: o.lastSyncAt,
      lastSyncError: o.lastSyncError,
    }));
  }

  // ─── Ámbitos de acceso ─────────────────────────────────────────────────────

  /** Lo que va en la ruta: una oficina, o PERSONAL_KEY para "Mis archivos". */
  scopeByKey(user: CurrentUser, key: string): Promise<AccessScope> {
    return key === PERSONAL_KEY ? this.personalScope(user) : this.officeScope(user, key);
  }

  /**
   * "Mis archivos": una carpeta en el Drive personal del usuario, en su
   * nombre. Necesita cuenta @iugna.edu.ar; la carpeta se crea la primera vez.
   */
  async personalScope(user: CurrentUser): Promise<AccessScope> {
    if (!this.gdrive.isConfigured) {
      throw new ServiceUnavailableException('Las carpetas compartidas no están configuradas.');
    }
    const email = await this.googleEmailOf(user.username, user.email);
    if (!email) {
      throw new ForbiddenException('Para usar Mis archivos necesitás una cuenta @iugna.edu.ar. Pedísela a TICOM.');
    }
    const space = await this.personalSpace(user.username, email);
    return { office: space, actor: email, rootId: space.driveId, rootName: PERSONAL_NAME, canWrite: true };
  }

  /** El espacio personal del usuario; si no existe, o borró la carpeta desde Drive, se crea. */
  private personalSpace(username: string, email: string): Promise<OfficeDrive> {
    const key = personalKeyOf(username);
    let pending = this.creating.get(key);
    if (!pending) {
      pending = this.ensurePersonalSpace(key, email).finally(() => this.creating.delete(key));
      this.creating.set(key, pending);
    }
    return pending;
  }

  private async ensurePersonalSpace(key: string, email: string): Promise<OfficeDrive> {
    const existing = await this.driveRepo.findOne({ where: { groupName: key } });
    if (existing && (this.personalChecked.has(existing.driveId) || (await this.personalFolderAlive(email, existing.driveId)))) {
      this.personalChecked.add(existing.driveId);
      if (existing.ownerEmail !== email) {
        existing.ownerEmail = email;
        await this.driveRepo.update(existing.id, { ownerEmail: email });
      }
      return existing;
    }
    const folder = await this.run(() => this.gdrive.createFolder(email, 'root', PERSONAL_FOLDER_NAME));
    this.personalChecked.add(folder.id!);
    this.logger.log(`Mis archivos de ${key.slice(1)}: carpeta creada en su Drive (${folder.id})`);
    if (existing) {
      Object.assign(existing, { driveId: folder.id!, ownerEmail: email, usedBytes: 0, trashedBytes: 0, usageAt: null });
      await this.driveRepo.update(existing.id, { driveId: folder.id!, ownerEmail: email, usedBytes: 0, trashedBytes: 0, usageAt: null });
      return existing;
    }
    return this.driveRepo.save(this.driveRepo.create({ kind: 'personal', groupName: key, driveId: folder.id!, ownerEmail: email }));
  }

  /** La carpeta sigue en su Drive. Ante un error que no sea "no existe" se asume que sí (no duplicar). */
  private async personalFolderAlive(email: string, folderId: string): Promise<boolean> {
    try {
      return !(await this.gdrive.getFile(email, folderId)).trashed;
    } catch (err) {
      return googleStatus(err) !== 404;
    }
  }

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
      // De "Mis archivos" de otro: se opera como su dueño (la cuenta de la intranet no tiene acceso).
      actor: office.kind === 'personal' ? office.ownerEmail! : this.gdrive.ownerEmail,
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
        // En "Mis archivos" la cuenta dueña de las unidades no tiene acceso: no hay a quién recurrir.
        if (scope.office.kind !== 'personal' && scope.actor !== this.gdrive.ownerEmail && (status === 403 || status === 404)) {
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
    if (!file || file.trashed) throw notFound;
    if (scope.office.kind === 'personal') {
      // "Mis archivos" está en el Drive personal: nada de una unidad, y siempre
      // dentro de su carpeta (el resto del Drive del usuario no se expone).
      if (file.driveId) throw notFound;
    } else {
      if (file.driveId !== scope.office.driveId) throw notFound;
      if (scope.rootId === scope.office.driveId) return;
    }
    let current = file;
    for (let depth = 0; depth < MAX_FOLDER_DEPTH; depth++) {
      if (current.id === scope.rootId) return;
      const parent = current.parents?.[0];
      if (!parent) break;
      if (parent === scope.rootId) return;
      if (parent === scope.office.driveId) break;
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
  async currentFile(fileId: string, actAs: string = this.gdrive.ownerEmail): Promise<drive_v3.Schema$File | null> {
    try {
      const file = await this.gdrive.getFile(actAs, fileId);
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
      // Una carpeta se descarga entera, en .zip.
      downloadable: isFolder || !isGoogleDoc || !!GOOGLE_EXPORTS[mimeType],
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
        this.gdrive.listChildren(actAs, driveIdOf(scope.office), folder.id!),
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

  /**
   * Con quiet no avisa: al subir una carpeta el navegador manda los archivos
   * en tandas y al final pide un único aviso (notifyUploaded).
   */
  async upload(scope: AccessScope, parentId: string | undefined, files: UploadedFile[], uploader: Uploader, quiet = false) {
    try {
      this.assertWritable(scope);
      if (!files?.length) throw new BadRequestException('No se recibió ningún archivo.');
      await this.assertRoomFor(scope.office, files.reduce((sum, f) => sum + (f.size ?? 0), 0));
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
      if (!quiet) void this.notifyUpload(scope, parent, uploaded, uploader);
      return uploaded;
    } finally {
      await this.discardUploads(files);
    }
  }

  // ─── Subida directa a Google (archivos grandes) ────────────────────────────

  /**
   * Abre una subida reanudable en Drive para un archivo grande: el navegador
   * lo manda directo a Google, en partes, sin pasar por este servidor. Acá se
   * valida el acceso, la carpeta, el tamaño y el espacio de la oficina.
   */
  async startDirectUpload(
    scope: AccessScope,
    parentId: string | undefined,
    body: { name?: string; mimeType?: string; size?: number },
    origin?: string,
  ): Promise<{ uploadUrl: string }> {
    this.assertWritable(scope);
    const name = this.cleanName(body?.name ?? '');
    const size = Math.trunc(Number(body?.size));
    if (!Number.isFinite(size) || size <= 0) throw new BadRequestException('Falta el tamaño del archivo.');
    if (size > maxFileBytes()) {
      throw new PayloadTooLargeException(`El archivo supera el máximo de ${Math.round(maxFileBytes() / GB)} GB.`);
    }
    await this.assertRoomFor(scope.office, size);
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(body?.mimeType ?? '') ? body.mimeType! : 'application/octet-stream';
    // Solo una página web (la de la intranet) para que Google acepte sus pedidos.
    const cleanOrigin = origin && /^https?:\/\/[\w.-]+(:\d+)?$/.test(origin) ? origin : undefined;
    const uploadUrl = await this.as(scope, async (actAs) => {
      const parent = await this.folderIn(actAs, scope, parentId);
      return this.gdrive.createUploadSession(actAs, parent.id!, { name, mimeType, size }, cleanOrigin);
    });
    return { uploadUrl };
  }

  /** Cierra una subida directa: valida que el archivo quedó en el ámbito, suma el espacio y avisa. */
  async finishDirectUpload(scope: AccessScope, fileId: string, uploader: Uploader, quiet = false): Promise<SharedFile> {
    this.assertWritable(scope);
    const { file, parent } = await this.as(scope, async (actAs) => {
      const file = await this.fileIn(actAs, scope, fileId);
      const parentId = file.parents?.[0];
      const parent: drive_v3.Schema$File =
        parentId && parentId !== scope.office.driveId
          ? await this.gdrive.getFile(actAs, parentId)
          : { id: scope.office.driveId, name: scope.office.groupName };
      return { file, parent };
    });
    const shared = this.toShared(file);
    await this.addUsage(scope.office, Number(file.quotaBytesUsed ?? file.size ?? 0) || 0);
    if (!quiet) void this.notifyUpload(scope, parent, [shared], uploader);
    return shared;
  }

  /**
   * Lo compartido cuenta para la oficina dueña, no para quien lo recibe. Lo
   * que se sube directo en Drive no pasa por acá: lo frena el límite que se
   * configura en la consola de Google.
   */
  private async assertRoomFor(office: OfficeDrive, incoming: number): Promise<void> {
    let current = await this.usageOf(office);
    let quota = this.quotaOf(current);
    if (incoming <= quota - current.usedBytes) return;
    // Antes de rechazar, el dato fresco: quizás borraron algo desde Drive.
    current = await this.usageOf(office, 0);
    quota = this.quotaOf(current);
    const free = Math.max(0, quota - current.usedBytes);
    if (incoming <= free) return;
    throw new PayloadTooLargeException(
      `No hay espacio en ${this.spaceLabel(office)}: quedan ${formatBytes(free)} libres de ${formatBytes(quota)} ` +
        `y querés subir ${formatBytes(incoming)}. Eliminá archivos para liberar lugar.`,
    );
  }

  /**
   * Un único aviso para una subida hecha en tandas (una carpeta arrastrada):
   * `itemIds` son lo que quedó a la vista en `folderId` (las carpetas
   * creadas y los archivos sueltos) y `fileCount` el total de archivos.
   */
  async notifyUploaded(scope: AccessScope, folderId: string, itemIds: string[], fileCount: number, uploader: Uploader): Promise<void> {
    this.assertWritable(scope);
    const ids = (Array.isArray(itemIds) ? itemIds : []).filter((id) => typeof id === 'string' && isDriveId(id)).slice(0, 50);
    if (!ids.length) return;
    const { parent, items } = await this.as(scope, async (actAs) => {
      const parent = await this.folderIn(actAs, scope, folderId);
      const items: SharedFile[] = [];
      for (const id of ids) items.push(this.toShared(await this.fileIn(actAs, scope, id)));
      return { parent, items };
    });
    const count = Math.max(0, Math.min(Math.trunc(Number(fileCount) || 0), 100_000));
    void this.notifyUpload(scope, parent, items, uploader, count);
  }

  /**
   * Avisa a los demás integrantes de la oficina: una notificación por subida
   * aunque sean varios archivos. Lleva los archivos para que quien tenga esa
   * carpeta abierta los vea aparecer sin recargar.
   */
  private async notifyUpload(
    scope: AccessScope,
    parent: drive_v3.Schema$File,
    files: SharedFile[],
    uploader: Uploader,
    fileCount?: number,
  ): Promise<void> {
    // "Mis archivos" es de una sola persona: no hay a quién avisar.
    if (scope.office.kind === 'personal') return;
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
      const total = fileCount ?? n;
      const archivos = `${total} ${total === 1 ? 'archivo' : 'archivos'}`;
      const folders = files.filter((f) => f.isFolder);
      const what =
        folders.length === 1 && n === 1
          ? `la carpeta «${folders[0].name}»${total ? ` con ${archivos}` : ''}`
          : folders.length
            ? `${folders.length === n ? `${n} carpetas` : `${n} elementos`} con ${archivos}`
            : n === 1 ? 'un archivo' : `${n} archivos`;
      // Archivos abierto en esa carpeta muestra lo nuevo solo (la campanita ya no avisa las subidas).
      this.notifications.signalTo(members.map((m) => m.username), 'drive_uploaded', {
        groupName: group,
        folderId: parent.id,
        files,
      });
      await this.notifications.notify(
        members.map((m) => m.username),
        {
          type: 'upload',
          title: `${who} subió ${what} a ${group}`,
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
      await this.gdrive.deleteForever(fileId, scope.office.kind === 'personal' ? scope.office.ownerEmail! : undefined);
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
