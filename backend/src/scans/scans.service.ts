import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, LessThan, Repository } from 'typeorm';
import { existsSync } from 'fs';
import { copyFile, mkdir, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, extname, join } from 'path';
import { randomInt, randomUUID } from 'crypto';
import { Scan } from './entities/scan.entity';
import { ScanAccount } from './entities/scan-account.entity';
import { GroupPermission } from '../admin/entities/group-permission.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { PERSONAL_KEY, SharedFoldersService } from '../shared-folders/shared-folders.service';
import { argentinaParts } from '../common/argentina-time';
import { openSecret, sealSecret } from '../common/secret-box.util';

/** Bandeja donde la impresora deja los archivos (volumen compartido con scan-inbox). */
const INBOX = process.env.SCAN_INBOX_PATH ?? '/app/storage/scan-inbox';
/** accounts.conf que lee scan-inbox para crear los usuarios y las carpetas. */
const CONFIG = process.env.SCAN_CONFIG_PATH ?? '/app/storage/scan-config';
/** Donde quedan los escaneos ya tomados. */
const STORE = process.env.SCANS_PATH ?? '/app/storage/scans';
const POLL_MS = 10_000;
/** Un archivo se toma cuando lleva este tiempo sin cambiar (la impresora lo escribe de a partes). */
const STABLE_MS = 15_000;
const PASSWORD_PURPOSE = 'scan-inbox-password';
/** Sin letras ni números que se confunden al tipearlos en el panel de la impresora. */
const PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Lo que la impresora deja junto al escaneo y no es un escaneo: el Centro de
 * digitalizaciones de Lexmark escribe un .xml con los datos de cada trabajo.
 * Se borra de la bandeja sin mostrarlo.
 */
const IGNORED_EXT = new Set(['.xml']);
const IGNORED_NAME = /^(thumbs\.db|desktop\.ini)$/i;

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.xps': 'application/vnd.ms-xpsdocument',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

type ScanUser = Pick<User, 'username' | 'email' | 'roles' | 'displayName' | 'firstName' | 'lastName'>;

export interface ScanDto {
  id: string;
  groupName: string;
  filename: string;
  contentType: string;
  size: number;
  receivedAt: Date;
  /** Cuándo se borra solo. */
  expiresAt: Date;
}

export interface ScanAccountDto {
  groupName: string;
  configured: boolean;
  username: string | null;
  password: string | null;
  /** \\10.98.40.24\escaneo-<carpeta> */
  networkPath: string | null;
  ftpHost: string;
  lastScanAt: Date | null;
  /** Escaneos de esa oficina que están guardados ahora. */
  scanCount: number;
}

/** "Legal y Técnica" → "legal-y-tecnica". */
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'oficina';
}

/**
 * Escaneos de las impresoras: cada oficina tiene una bandeja (carpeta de red o
 * FTP en el contenedor scan-inbox). Lo que llega se guarda en la VM (no en
 * Drive), lo ven solo los integrantes de la oficina y se borra a los 90 días;
 * se puede pasar a Archivos (unidad de la oficina o Mis archivos).
 */
@Injectable()
export class ScansService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScansService.name);
  /** Solo el backend que tiene montada la bandeja (producción) la procesa; staging no. */
  private worker = false;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  /** Tamaño y fecha de cada archivo de la bandeja, y desde cuándo no cambian. */
  private readonly seen = new Map<string, { size: number; mtimeMs: number; since: number }>();
  private lastAccountsFile = '';

  constructor(
    @InjectRepository(Scan) private readonly scans: Repository<Scan>,
    @InjectRepository(ScanAccount) private readonly accounts: Repository<ScanAccount>,
    @InjectRepository(GroupPermission) private readonly groups: Repository<GroupPermission>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly sharedFolders: SharedFoldersService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureTables();
    this.worker = existsSync(INBOX);
    if (!this.worker) {
      this.logger.log(`Sin bandeja de escaneo en ${INBOX}: este backend no toma escaneos`);
      return;
    }
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Con NODE_ENV=production (staging) TypeORM no sincroniza: las tablas se crean
   * acá si faltan, con las mismas columnas que las entidades.
   */
  private async ensureTables(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "scans" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "groupName" character varying NOT NULL,
          "filename" character varying NOT NULL,
          "contentType" character varying NOT NULL,
          "size" bigint NOT NULL,
          "storagePath" character varying NOT NULL,
          "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )`);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS "idx_scans_group_received" ON "scans" ("groupName", "receivedAt")`,
      );
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "scan_accounts" (
          "groupName" character varying PRIMARY KEY,
          "folder" character varying NOT NULL UNIQUE,
          "username" character varying NOT NULL UNIQUE,
          "passwordEnc" text NOT NULL,
          "lastScanAt" TIMESTAMP WITH TIME ZONE NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )`);
    } catch (err) {
      this.logger.error(`No se pudieron crear las tablas de escaneos: ${(err as Error).message}`);
    }
  }

  get retentionDays(): number {
    const days = Number(this.config.get<string>('SCANS_RETENTION_DAYS'));
    return Number.isFinite(days) && days >= 1 ? days : 90;
  }

  private get publicHost(): string {
    return this.config.get<string>('SCAN_PUBLIC_IP') || '10.98.40.24';
  }

  /**
   * Las contraseñas se cifran con el secreto del ad-bridge, que staging y
   * producción comparten (secrets/bridge_secret.txt): staging comparte la base,
   * y así los accesos creados al probar en staging siguen andando en producción.
   */
  private get secret(): string {
    return this.config.get<string>('BRIDGE_SECRET') ?? 'pac-bridge-secret-change-me';
  }

  // ─── Bandeja ───────────────────────────────────────────────────────────────

  /** Cada 10 s: mantiene al día las cuentas de scan-inbox y toma lo que terminó de llegar. */
  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const accounts = await this.accounts.find();
      await this.writeAccountsFile(accounts);
      const present = new Set<string>();
      for (const account of accounts) {
        const dir = join(INBOX, account.folder);
        for (const file of await this.filesIn(dir)) {
          present.add(file);
          await this.checkFile(account, file);
        }
      }
      for (const path of this.seen.keys()) if (!present.has(path)) this.seen.delete(path);
    } catch (err) {
      this.logger.warn(`Bandeja de escaneo: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /** Archivos de la carpeta, también en subcarpetas (algunas impresoras crean una). */
  private async filesIn(dir: string, depth = 0): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isFile()) out.push(full);
      else if (e.isDirectory() && depth < 3) out.push(...(await this.filesIn(full, depth + 1)));
    }
    return out;
  }

  private async checkFile(account: ScanAccount, path: string): Promise<void> {
    let info;
    try {
      info = await stat(path);
    } catch {
      return;
    }
    const now = Date.now();
    const prev = this.seen.get(path);
    if (!prev || prev.size !== info.size || prev.mtimeMs !== info.mtimeMs) {
      this.seen.set(path, { size: info.size, mtimeMs: info.mtimeMs, since: now });
      return;
    }
    if (now - prev.since < STABLE_MS) return;
    this.seen.delete(path);
    if (IGNORED_EXT.has(extname(path).toLowerCase()) || IGNORED_NAME.test(basename(path))) {
      await rm(path, { force: true });
      return;
    }
    if (info.size === 0) return;
    await this.ingest(account, path, info.size, info.mtime);
  }

  /** Pasa el archivo de la bandeja al almacén, lo registra y avisa a la oficina. */
  private async ingest(account: ScanAccount, path: string, size: number, mtime: Date): Promise<void> {
    const ext = extname(path).toLowerCase();
    const dir = join(STORE, account.folder);
    await mkdir(dir, { recursive: true });
    const dest = join(dir, `${randomUUID()}${ext}`);
    try {
      await rename(path, dest);
    } catch {
      // Otro volumen: se copia y se borra de la bandeja.
      await copyFile(path, dest);
      await unlink(path);
    }

    const p = argentinaParts(mtime);
    const two = (n: number) => String(n).padStart(2, '0');
    const filename = `Escaneo ${two(p.day)}-${two(p.month)}-${p.year} ${two(p.hour)}.${two(p.minute)}.${two(p.second)}${ext}`;
    const scan = await this.scans.save(
      this.scans.create({
        groupName: account.groupName,
        filename,
        contentType: MIME_BY_EXT[ext] ?? 'application/octet-stream',
        size,
        storagePath: dest,
      }),
    );
    await this.accounts.update({ groupName: account.groupName }, { lastScanAt: new Date() });
    this.logger.log(`Escaneo de ${account.groupName}: ${filename} (${size} bytes)`);
    void this.notifyOffice(scan);
  }

  private async notifyOffice(scan: Scan): Promise<void> {
    try {
      const members = await this.users
        .createQueryBuilder('u')
        .select(['u.username'])
        .where('u.isActive = true')
        .andWhere(`EXISTS (SELECT 1 FROM unnest(string_to_array(u.roles, ',')) r WHERE UPPER(r) = UPPER(:group))`, {
          group: scan.groupName,
        })
        .getMany();
      await this.notifications.notify(
        members.map((m) => m.username),
        {
          type: 'scan',
          title: `Nuevo escaneo en ${scan.groupName}`,
          body: `Llegó «${scan.filename}». Está en Archivos compartidos → Escaneos.`,
          data: { groupName: scan.groupName, scanId: scan.id },
        },
      );
    } catch (err) {
      this.logger.warn(`No se pudo avisar el escaneo: ${(err as Error).message}`);
    }
  }

  /** accounts.conf para scan-inbox; la base manda (se reescribe si cambió algo). */
  private async writeAccountsFile(accounts: ScanAccount[]): Promise<void> {
    if (!existsSync(CONFIG)) return;
    const lines = accounts
      .map((a) => {
        const password = openSecret(a.passwordEnc, this.secret, PASSWORD_PURPOSE);
        return password ? `${a.username}\t${password}\t${a.folder}` : null;
      })
      .filter(Boolean)
      .sort();
    const content = lines.length ? `${lines.join('\n')}\n` : '';
    if (content === this.lastAccountsFile) return;
    const file = join(CONFIG, 'accounts.conf');
    await writeFile(`${file}.tmp`, content, { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    this.lastAccountsFile = content;
  }

  /**
   * Todos los días: borra lo que pasó el plazo de conservación. Solo lo que
   * está en este servidor: staging comparte la base y tiene sus propios escaneos.
   */
  @Cron('30 3 * * *')
  async purgeExpired(): Promise<void> {
    if (!this.worker) return;
    const limit = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    const old = (await this.scans.find({ where: { receivedAt: LessThan(limit) } })).filter((s) =>
      existsSync(s.storagePath),
    );
    for (const scan of old) {
      await rm(scan.storagePath, { force: true });
      await this.scans.delete(scan.id);
    }
    if (old.length) this.logger.log(`Escaneos: ${old.length} borrados por tener más de ${this.retentionDays} días`);
  }

  // ─── Lo que ve la oficina ──────────────────────────────────────────────────

  /** La oficina existe (category='oficina') y el usuario es de ella; devuelve el nombre tal como está. */
  private async assertMember(user: ScanUser, groupName: string): Promise<string> {
    const offices = await this.groups.find({ where: { category: 'oficina' } });
    const office = offices.find((g) => g.groupName.toUpperCase() === groupName.toUpperCase());
    const roles = new Set((user.roles ?? []).map((r) => r.toUpperCase()));
    if (!office || !roles.has(office.groupName.toUpperCase())) {
      throw new ForbiddenException('No pertenecés a esa oficina.');
    }
    return office.groupName;
  }

  private toDto(scan: Scan): ScanDto {
    return {
      id: scan.id,
      groupName: scan.groupName,
      filename: scan.filename,
      contentType: scan.contentType,
      size: scan.size,
      receivedAt: scan.receivedAt,
      expiresAt: new Date(scan.receivedAt.getTime() + this.retentionDays * 24 * 60 * 60 * 1000),
    };
  }

  async list(user: ScanUser, groupName: string): Promise<ScanDto[]> {
    const office = await this.assertMember(user, groupName);
    const rows = await this.scans.find({ where: { groupName: office }, order: { receivedAt: 'DESC' } });
    // Solo los que están en este servidor: staging comparte la base pero no los archivos.
    return rows.filter((s) => existsSync(s.storagePath)).map((s) => this.toDto(s));
  }

  async get(user: ScanUser, groupName: string, id: string): Promise<Scan> {
    const office = await this.assertMember(user, groupName);
    const scan = await this.scans.findOne({ where: { id, groupName: office } });
    if (!scan) throw new NotFoundException('Escaneo no encontrado.');
    if (!existsSync(scan.storagePath)) throw new NotFoundException('El archivo ya no está en el servidor.');
    return scan;
  }

  async rename(user: ScanUser, groupName: string, id: string, name: string): Promise<ScanDto> {
    const scan = await this.get(user, groupName, id);
    let clean = String(name ?? '')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    if (!clean) throw new BadRequestException('Escribí un nombre.');
    // Si no le pusieron la extensión, se conserva la que tenía (.pdf, .jpg…).
    const ext = extname(scan.filename);
    if (ext && extname(clean).toLowerCase() !== ext.toLowerCase()) clean += ext;
    scan.filename = clean;
    return this.toDto(await this.scans.save(scan));
  }

  async remove(user: ScanUser, groupName: string, id: string): Promise<void> {
    const scan = await this.get(user, groupName, id).catch(async (err) => {
      // Si el archivo ya no estaba, igual se saca de la lista.
      if (err instanceof NotFoundException) {
        const office = await this.assertMember(user, groupName);
        const row = await this.scans.findOne({ where: { id, groupName: office } });
        if (row) return row;
      }
      throw err;
    });
    await rm(scan.storagePath, { force: true });
    await this.scans.delete(scan.id);
  }

  /**
   * Una copia en Archivos: la unidad de la oficina (ocupa su espacio) o Mis
   * archivos del usuario. El escaneo sigue en la bandeja hasta que venza o se borre.
   */
  async saveToDrive(user: ScanUser, groupName: string, id: string, target: 'office' | 'personal') {
    const scan = await this.get(user, groupName, id);
    const scope = await this.sharedFolders.scopeByKey(user, target === 'personal' ? PERSONAL_KEY : scan.groupName);
    // upload() borra el archivo que recibe: se le pasa una copia.
    const tmp = join(tmpdir(), `scan-${randomUUID()}${extname(scan.filename)}`);
    await copyFile(scan.storagePath, tmp);
    const uploaded = await this.sharedFolders.upload(
      scope,
      undefined,
      [{
        // upload() espera el nombre como lo entrega multer (latin1)
        originalname: Buffer.from(scan.filename, 'utf8').toString('latin1'),
        mimetype: scan.contentType,
        path: tmp,
        size: scan.size,
      }],
      user,
    );
    return { target, file: uploaded[0] ?? null };
  }

  // ─── TICOM: accesos para cargar en las impresoras ──────────────────────────

  async listAccounts(): Promise<ScanAccountDto[]> {
    const [offices, accounts, counts] = await Promise.all([
      this.groups.find({ where: { category: 'oficina' } }),
      this.accounts.find(),
      this.scans
        .createQueryBuilder('s')
        .select(['s.groupName', 's.storagePath'])
        .getMany(),
    ]);
    const byGroup = new Map(accounts.map((a) => [a.groupName, a]));
    const countOf = new Map<string, number>();
    for (const s of counts) if (existsSync(s.storagePath)) countOf.set(s.groupName, (countOf.get(s.groupName) ?? 0) + 1);
    return offices
      .map((o) => o.groupName)
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((groupName) => {
        const a = byGroup.get(groupName);
        return {
          groupName,
          configured: !!a,
          username: a?.username ?? null,
          password: a ? openSecret(a.passwordEnc, this.secret, PASSWORD_PURPOSE) : null,
          networkPath: a ? `\\\\${this.publicHost}\\escaneo-${a.folder}` : null,
          ftpHost: this.publicHost,
          lastScanAt: a?.lastScanAt ?? null,
          scanCount: countOf.get(groupName) ?? 0,
        };
      });
  }

  /** Crea el acceso de la oficina o le genera una contraseña nueva. */
  async createOrResetAccount(groupName: string): Promise<ScanAccountDto> {
    const office = (await this.groups.find({ where: { category: 'oficina' } })).find(
      (g) => g.groupName.toUpperCase() === groupName.toUpperCase(),
    );
    if (!office) throw new NotFoundException('Esa oficina no existe.');

    const password = Array.from({ length: 12 }, () => PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]).join('');
    let account = await this.accounts.findOne({ where: { groupName: office.groupName } });
    if (account) {
      account.passwordEnc = sealSecret(password, this.secret, PASSWORD_PURPOSE);
    } else {
      const taken = new Set((await this.accounts.find()).map((a) => a.folder));
      const base = slugify(office.groupName);
      let folder = base;
      for (let i = 2; taken.has(folder); i++) folder = `${base}-${i}`;
      account = this.accounts.create({
        groupName: office.groupName,
        folder,
        username: `esc-${folder}`.slice(0, 32),
        passwordEnc: sealSecret(password, this.secret, PASSWORD_PURPOSE),
        lastScanAt: null,
      });
    }
    await this.accounts.save(account);
    // En producción se aplica al instante; si no, en la próxima vuelta del backend que tiene la bandeja.
    if (this.worker) await this.writeAccountsFile(await this.accounts.find());
    return (await this.listAccounts()).find((a) => a.groupName === office.groupName)!;
  }
}
