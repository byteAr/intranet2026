import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Response,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { Response as ExpressResponse } from 'express';
import { User } from '../users/entities/user.entity';
import { AccessScope, FileStream, SharedFoldersService, UploadedFile } from './shared-folders.service';
import { SharesService } from './shares.service';

/** Límite por archivo al subir desde la intranet. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 20;

const uploadInterceptor = FilesInterceptor('files', MAX_FILES_PER_UPLOAD, {
  storage: diskStorage({ destination: tmpdir() }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

type AuthRequest = { user: User };

function isTicom(user: User): boolean {
  return (user.roles ?? []).some((r) => r.toUpperCase() === 'TICOM');
}

/** Content-Disposition con el nombre en UTF-8 y una versión ASCII de respaldo. */
function disposition(type: 'attachment' | 'inline', name: string): string {
  const ascii = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'archivo';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function send(res: ExpressResponse, file: FileStream, type: 'attachment' | 'inline'): StreamableFile {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', disposition(type, file.name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (file.size !== null) res.setHeader('Content-Length', String(file.size));
  return new StreamableFile(file.stream);
}

/**
 * Las mismas operaciones existen en dos ámbitos con idénticos sufijos:
 *   /shared-folders/:office/...          toda la unidad de la oficina
 *   /shared-folders/shares/:shareId/...  algo compartido con el usuario
 * El frontend solo cambia el prefijo.
 */
@Controller('shared-folders')
export class SharedFoldersController {
  constructor(
    private readonly service: SharedFoldersService,
    private readonly shares: SharesService,
  ) {}

  @Get('offices')
  offices(@Request() req: AuthRequest) {
    return this.service.myOffices(req.user);
  }

  /** Fuerza la sincronización de miembros de todas las unidades (solo TICOM). */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@Request() req: AuthRequest) {
    if (!isTicom(req.user)) throw new ForbiddenException('Solo TICOM puede sincronizar las carpetas.');
    return this.service.syncNow();
  }

  /** Espacio usado y disponible de las oficinas del usuario. */
  @Get('usage')
  usage(@Request() req: AuthRequest, @Query('fresh') fresh?: string) {
    // fresh=1: recalcula en Drive (antes de rechazar una subida por falta de lugar).
    return this.service.myUsage(req.user, fresh === '1');
  }

  /** Espacio de todas las oficinas (solo TICOM). */
  @Get('usage/all')
  allUsage(@Request() req: AuthRequest) {
    if (!isTicom(req.user)) throw new ForbiddenException('Solo TICOM ve el espacio de todas las oficinas.');
    return this.service.allUsage();
  }

  /** Espacio fijo para una oficina; { gb: null } vuelve al automático (solo TICOM). */
  @Patch('usage/:group')
  setQuota(@Request() req: AuthRequest, @Param('group') group: string, @Body() body: { gb?: number | null }) {
    if (!isTicom(req.user)) throw new ForbiddenException('Solo TICOM puede cambiar el espacio de una oficina.');
    return this.service.setQuota(group, body?.gb === null || body?.gb === undefined ? null : Number(body.gb));
  }

  // ─── Compartidos conmigo ───────────────────────────────────────────────────

  @Get('shares')
  sharedWithMe(@Request() req: AuthRequest) {
    return this.shares.withMe(req.user);
  }

  @Get('shares/count')
  sharedCount(@Request() req: AuthRequest) {
    return this.shares.counts(req.user);
  }

  @Post('shares/seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markSeen(@Request() req: AuthRequest) {
    await this.shares.markSeen(req.user);
  }

  @Get('shares/:shareId/files')
  async shareList(@Request() req: AuthRequest, @Param('shareId') shareId: string, @Query('folderId') folderId?: string) {
    return this.service.list(await this.service.shareScope(req.user, shareId), folderId);
  }

  @Post('shares/:shareId/folders')
  async shareCreateFolder(
    @Request() req: AuthRequest,
    @Param('shareId') shareId: string,
    @Body() body: { parentId?: string; name: string },
  ) {
    return this.service.createFolder(await this.service.shareScope(req.user, shareId), body.parentId, body.name);
  }

  @Post('shares/:shareId/upload')
  @UseInterceptors(uploadInterceptor)
  async shareUpload(
    @Request() req: AuthRequest,
    @Param('shareId') shareId: string,
    @Query('folderId') folderId: string | undefined,
    @UploadedFiles() files: UploadedFile[],
  ) {
    return this.service.upload(await this.scopeOrCleanup(() => this.service.shareScope(req.user, shareId), files), folderId, files, req.user);
  }

  @Patch('shares/:shareId/files/:id')
  async shareRename(
    @Request() req: AuthRequest,
    @Param('shareId') shareId: string,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    return this.service.rename(await this.service.shareScope(req.user, shareId), id, body.name);
  }

  @Delete('shares/:shareId/files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async shareTrash(@Request() req: AuthRequest, @Param('shareId') shareId: string, @Param('id') id: string) {
    await this.service.remove(await this.service.shareScope(req.user, shareId), id);
  }

  @Get('shares/:shareId/files/:id/download')
  async shareDownload(
    @Request() req: AuthRequest,
    @Param('shareId') shareId: string,
    @Param('id') id: string,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const file = await this.service.download(await this.service.shareScope(req.user, shareId), id);
    return send(res, file, 'attachment');
  }

  @Get('shares/:shareId/files/:id/preview')
  async sharePreview(
    @Request() req: AuthRequest,
    @Param('shareId') shareId: string,
    @Param('id') id: string,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const file = await this.service.preview(await this.service.shareScope(req.user, shareId), id);
    return send(res, file, 'inline');
  }

  // ─── Unidad de la oficina ──────────────────────────────────────────────────

  @Get(':office/files')
  async list(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Query('folderId') folderId?: string,
    @Query('path') path?: string,
  ) {
    return this.service.list(await this.service.officeScope(req.user, office), folderId, path === '1');
  }

  @Post(':office/folders')
  async createFolder(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Body() body: { parentId?: string; name: string },
  ) {
    return this.service.createFolder(await this.service.officeScope(req.user, office), body.parentId, body.name);
  }

  @Post(':office/upload')
  @UseInterceptors(uploadInterceptor)
  async upload(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Query('folderId') folderId: string | undefined,
    @UploadedFiles() files: UploadedFile[],
  ) {
    return this.service.upload(await this.scopeOrCleanup(() => this.service.officeScope(req.user, office), files), folderId, files, req.user);
  }

  @Patch(':office/files/:id')
  async rename(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    return this.service.rename(await this.service.officeScope(req.user, office), id, body.name);
  }

  @Delete(':office/files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trash(@Request() req: AuthRequest, @Param('office') office: string, @Param('id') id: string) {
    await this.service.remove(await this.service.officeScope(req.user, office), id);
  }

  @Get(':office/files/:id/download')
  async download(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Param('id') id: string,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const file = await this.service.download(await this.service.officeScope(req.user, office), id);
    return send(res, file, 'attachment');
  }

  @Get(':office/files/:id/preview')
  async preview(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Param('id') id: string,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const file = await this.service.preview(await this.service.officeScope(req.user, office), id);
    return send(res, file, 'inline');
  }

  // ─── Compartir (desde la oficina) ──────────────────────────────────────────

  @Get(':office/files/:id/shares')
  listShares(@Request() req: AuthRequest, @Param('office') office: string, @Param('id') id: string) {
    return this.shares.listForItem(req.user, office, id);
  }

  @Post(':office/files/:id/shares')
  share(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Param('id') id: string,
    @Body() body: { username?: string; name?: string; role?: string },
  ) {
    return this.shares.share(req.user, office, id, body);
  }

  @Delete(':office/shares/:shareId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unshare(@Request() req: AuthRequest, @Param('office') office: string, @Param('shareId') shareId: string) {
    await this.shares.unshare(req.user, office, shareId);
  }

  /**
   * Si el usuario no tiene acceso, la subida igual dejó los archivos en el
   * temporal: se borran antes de devolver el error.
   */
  private async scopeOrCleanup(resolve: () => Promise<AccessScope>, files: UploadedFile[]): Promise<AccessScope> {
    try {
      return await resolve();
    } catch (err) {
      await this.service.discardUploads(files);
      throw err;
    }
  }
}
