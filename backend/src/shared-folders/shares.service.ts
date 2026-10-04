import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GoogleDriveService } from './google-drive.service';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SharedItem, ShareRole } from './entities/shared-item.entity';
import { User } from '../users/entities/user.entity';
import { CurrentUser, SharedFoldersService } from './shared-folders.service';

const USERNAME = /^[a-z0-9._-]{2,64}$/;

type Sharer = CurrentUser & Pick<User, 'displayName' | 'firstName' | 'lastName'>;

function fullName(u: Pick<User, 'displayName' | 'firstName' | 'lastName' | 'username'>): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || u.username;
}

/**
 * Compartir archivos y carpetas de una oficina con otros usuarios de la
 * intranet. El permiso vive en la intranet (tabla shared_items), no en Drive.
 */
@Injectable()
export class SharesService {
  private readonly logger = new Logger(SharesService.name);

  constructor(
    @InjectRepository(SharedItem) private readonly shareRepo: Repository<SharedItem>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly folders: SharedFoldersService,
    private readonly gdrive: GoogleDriveService,
  ) {}

  // ─── Desde la oficina que comparte ─────────────────────────────────────────

  /** Con quién está compartido un archivo o carpeta de la oficina. */
  async listForItem(user: CurrentUser, groupName: string, fileId: string) {
    const scope = await this.folders.officeScope(user, groupName);
    await this.folders.fileInScope(scope, fileId);
    const shares = await this.shareRepo.find({
      where: { driveId: scope.office.driveId, fileId },
      order: { createdAt: 'ASC' },
    });
    return shares.map((s) => ({
      id: s.id,
      username: s.sharedWith,
      name: s.sharedWithName ?? s.sharedWith,
      role: s.role,
      sharedByName: s.sharedByName,
      createdAt: s.createdAt,
    }));
  }

  async share(
    user: Sharer,
    groupName: string,
    fileId: string,
    body: { username?: string; name?: string; role?: string },
  ) {
    const scope = await this.folders.officeScope(user, groupName);
    const file = await this.folders.fileInScope(scope, fileId);

    const username = (body.username ?? '').trim().toLowerCase();
    if (!USERNAME.test(username)) throw new BadRequestException('Elegí un usuario de la lista.');
    if (username === user.username.toLowerCase()) throw new BadRequestException('No hace falta compartirlo con vos.');
    const role: ShareRole = body.role === 'writer' ? 'writer' : 'reader';

    // Quien es de la oficina ya ve toda la unidad. Si nunca entró a la
    // intranet no está en la base: se comparte igual y lo ve al entrar.
    const target = await this.userRepo
      .createQueryBuilder('u')
      .where('LOWER(u.username) = :username', { username })
      .getOne();
    if (target && (await this.folders.isOfficeMember(target.roles, scope.office.groupName))) {
      throw new BadRequestException(`${fullName(target)} es de ${scope.office.groupName} y ya tiene acceso.`);
    }

    let saved = await this.shareRepo.findOne({ where: { fileId, sharedWith: username } });
    if (saved) {
      saved.role = role;
      saved = await this.shareRepo.save(saved);
    } else {
      saved = await this.shareRepo.save(
        this.shareRepo.create({
          driveId: scope.office.driveId,
          groupName: scope.office.groupName,
          fileId,
          fileName: file.name ?? 'archivo',
          isFolder: file.mimeType === 'application/vnd.google-apps.folder',
          sharedWith: username,
          sharedWithName: target ? fullName(target) : (body.name?.trim().slice(0, 200) || null),
          sharedBy: user.username.toLowerCase(),
          sharedByName: fullName(user),
          role,
        }),
      );
    }
    await this.syncDriveAccess(saved, target?.email);
    return this.listForItem(user, groupName, fileId);
  }

  async unshare(user: CurrentUser, groupName: string, shareId: string): Promise<void> {
    const scope = await this.folders.officeScope(user, groupName);
    const share = await this.shareRepo.findOne({ where: { id: shareId, driveId: scope.office.driveId } });
    if (!share) throw new NotFoundException('Ya no estaba compartido.');
    if (share.drivePermissionId) {
      await this.gdrive.revoke(share.fileId, share.drivePermissionId).catch((err: Error) =>
        this.logger.warn(`No se pudo quitar el acceso en Drive a ${share.sharedWith}: ${err.message}`),
      );
    }
    await this.shareRepo.delete(share.id);
  }

  /**
   * Replica el permiso en Drive para la cuenta @iugna.edu.ar de quien lo
   * recibe, así puede abrirlo en Documentos de Google. Si no tiene cuenta, o
   * Drive falla, lo compartido igual funciona desde la intranet.
   */
  private async syncDriveAccess(share: SharedItem, mail?: string | null): Promise<void> {
    try {
      if (share.drivePermissionId) {
        try {
          await this.gdrive.changeGrant(share.fileId, share.drivePermissionId, share.role);
          return;
        } catch {
          // El permiso ya no existe en Drive (lo quitaron a mano): se vuelve a dar.
          share.drivePermissionId = null;
        }
      }
      const email = await this.folders.googleEmailOf(share.sharedWith, mail);
      if (!email) return;
      share.drivePermissionId = await this.gdrive.grant(share.fileId, email, share.role);
      await this.shareRepo.save(share);
    } catch (err) {
      this.logger.warn(`No se pudo dar acceso en Drive a ${share.sharedWith}: ${(err as Error).message}`);
    }
  }

  // ─── Para quien recibe ─────────────────────────────────────────────────────

  /**
   * Lo compartido con el usuario, con el nombre y los datos actuales de Drive.
   * Lo que fue borrado no se muestra (se conserva por si lo restauran).
   */
  async withMe(user: CurrentUser) {
    const shares = await this.shareRepo.find({
      where: { sharedWith: user.username.toLowerCase() },
      order: { createdAt: 'DESC' },
    });
    const items = await Promise.all(
      shares.map(async (s) => {
        const file = await this.folders.currentFile(s.fileId);
        if (!file || file.driveId !== s.driveId) return null;
        // Compartidos antes de tener cuenta de Google (o antes de este cambio).
        if (!s.drivePermissionId) await this.syncDriveAccess(s, user.email);
        return {
          shareId: s.id,
          role: s.role,
          groupName: s.groupName,
          sharedByName: s.sharedByName,
          sharedAt: s.createdAt,
          isNew: !s.seenAt,
          file: this.folders.toShared(file),
        };
      }),
    );
    return items.filter((i) => i !== null);
  }

  async counts(user: CurrentUser): Promise<{ total: number; unseen: number }> {
    const sharedWith = user.username.toLowerCase();
    const [total, unseen] = await Promise.all([
      this.shareRepo.count({ where: { sharedWith } }),
      this.shareRepo.count({ where: { sharedWith, seenAt: IsNull() } }),
    ]);
    return { total, unseen };
  }

  /** Al abrir "Compartidos conmigo" todo pasa a visto y el badge se apaga. */
  async markSeen(user: CurrentUser): Promise<void> {
    await this.shareRepo.update({ sharedWith: user.username.toLowerCase(), seenAt: IsNull() }, { seenAt: new Date() });
  }
}
