import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PassThrough } from 'stream';
import archiver from 'archiver';
import { User } from '../users/entities/user.entity';
import { GoogleDriveService } from './google-drive.service';
import {
  AccessScope,
  CurrentUser,
  FOLDER_MIME,
  FileStream,
  GOOGLE_EXPORTS,
  SharedFoldersService,
  driveIdOf,
} from './shared-folders.service';

/** Dónde está el archivo: la unidad de una oficina o algo compartido. */
export type ScopeRef = { kind: 'office'; office: string } | { kind: 'share'; shareId: string };

interface DownloadClaims {
  p: 'dl';
  u: string;
  k: ScopeRef['kind'];
  r: string;
  f: string;
}

/** Validez del enlace: alcanza para que el navegador empiece la descarga. */
const LINK_TTL = '2m';
const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.';

/**
 * Descargas con enlace: el navegador baja el archivo por su cuenta (barra de
 * descargas, sin cargarlo en la memoria de la página), así que no puede
 * mandar el JWT de la sesión. Se pide un enlace firmado de un par de minutos
 * con la sesión, y la descarga vuelve a validar el acceso de ese usuario.
 * Una carpeta baja como .zip con toda su estructura, armado al vuelo.
 */
@Injectable()
export class FolderDownloadService {
  private readonly logger = new Logger(FolderDownloadService.name);

  constructor(
    private readonly folders: SharedFoldersService,
    private readonly gdrive: GoogleDriveService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /** Secreto propio: un enlace de descarga no sirve como sesión, ni al revés. */
  private get secret(): string {
    return `${this.config.get<string>('jwt.secret')}:descarga-archivos`;
  }

  private scopeFor(user: CurrentUser, ref: ScopeRef): Promise<AccessScope> {
    return ref.kind === 'office' ? this.folders.scopeByKey(user, ref.office) : this.folders.shareScope(user, ref.shareId);
  }

  /** Valida el acceso ahora (para avisar enseguida si no puede) y firma el enlace. */
  async createLink(user: CurrentUser, ref: ScopeRef, fileId: string): Promise<{ url: string }> {
    await this.folders.fileInScope(await this.scopeFor(user, ref), fileId);
    const claims: DownloadClaims = {
      p: 'dl',
      u: user.username,
      k: ref.kind,
      r: ref.kind === 'office' ? ref.office : ref.shareId,
      f: fileId,
    };
    const token = this.jwt.sign(claims, { secret: this.secret, expiresIn: LINK_TTL });
    return { url: `/api/shared-folders/dl/${token}` };
  }

  /** Canjea el enlace: el archivo, o la carpeta entera en .zip. */
  async redeem(token: string): Promise<FileStream> {
    let claims: DownloadClaims;
    try {
      claims = this.jwt.verify<DownloadClaims>(token, { secret: this.secret });
    } catch {
      throw new UnauthorizedException('El enlace de descarga venció. Volvé a pedir la descarga.');
    }
    if (claims.p !== 'dl') throw new UnauthorizedException('Enlace de descarga inválido.');
    const user = await this.userRepo.findOne({ where: { username: claims.u } });
    if (!user || user.isActive === false) throw new UnauthorizedException('Enlace de descarga inválido.');
    const ref: ScopeRef = claims.k === 'office' ? { kind: 'office', office: claims.r } : { kind: 'share', shareId: claims.r };
    const scope = await this.scopeFor(user, ref);
    const file = await this.folders.fileInScope(scope, claims.f);
    if (file.mimeType !== FOLDER_MIME) return this.folders.download(scope, claims.f);
    return this.zipFolder(scope, file.id!, file.name ?? 'carpeta');
  }

  /**
   * Arma el .zip mientras lo envía: recorre la carpeta (como la cuenta dueña;
   * el acceso ya se validó) y agrega los archivos de a uno, cada uno en su
   * subcarpeta. Los Docs/Hojas/Presentaciones van convertidos a Office.
   */
  private async zipFolder(scope: AccessScope, folderId: string, folderName: string): Promise<FileStream> {
    // En "Mis archivos" solo su dueño puede leerlo; en las unidades, la cuenta dueña.
    const owner = scope.office.kind === 'personal' ? scope.office.ownerEmail! : this.gdrive.ownerEmail;
    const driveId = driveIdOf(scope.office);
    const out = new PassThrough();
    // Nivel 1: lo que más se guarda (PDF, imágenes, Office) ya viene comprimido.
    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('warning', (err) => this.logger.warn(`Zip de ${folderName}: ${err.message}`));
    archive.on('error', (err) => out.destroy(err));
    archive.pipe(out);
    // Si el usuario cancela la descarga, se deja de pedir archivos a Drive.
    let cancelled = false;
    out.once('close', () => (cancelled = true));

    const addFolder = async (id: string, path: string): Promise<void> => {
      if (cancelled) throw new Error('descarga cancelada');
      const children = await this.gdrive.listChildren(owner, driveId, id);
      const used = new Set<string>();
      if (!children.length) archive.append('', { name: `${path}/` });
      for (const child of children) {
        const mimeType = child.mimeType ?? '';
        const exp = GOOGLE_EXPORTS[mimeType];
        if (mimeType.startsWith(GOOGLE_APPS_PREFIX) && mimeType !== FOLDER_MIME && !exp) continue; // formularios, etc.
        const base = safeName(child.name ?? 'archivo') + (exp ? `.${exp.ext}` : '');
        const name = uniqueName(base, used);
        if (mimeType === FOLDER_MIME) {
          await addFolder(child.id!, `${path}/${name}`);
          continue;
        }
        if (cancelled) throw new Error('descarga cancelada');
        const stream = exp ? await this.gdrive.exportAs(owner, child.id!, exp.mimeType) : await this.gdrive.download(owner, child.id!);
        // De a uno: se espera a que el zip lo termine antes de pedir el siguiente.
        await new Promise<void>((resolve, reject) => {
          archive.once('entry', () => resolve());
          stream.once('error', reject);
          archive.append(stream, { name: `${path}/${name}` });
        });
      }
    };

    const root = safeName(folderName);
    void addFolder(folderId, root)
      .then(() => archive.finalize())
      .catch((err: Error) => {
        if (!cancelled) this.logger.error(`No se pudo armar el zip de ${folderName}: ${err.message}`);
        archive.abort();
        out.destroy(err);
      });

    return { stream: out, name: `${root}.zip`, mimeType: 'application/zip', size: null };
  }
}

/** Sin separadores ni caracteres que Windows no acepta en un nombre. */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'archivo';
}

/** Drive permite nombres repetidos en una carpeta; el zip no: «x (2).pdf». */
function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${stem} (${i})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
