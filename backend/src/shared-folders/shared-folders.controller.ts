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
import { SharedFoldersService, UploadedFile } from './shared-folders.service';

/** Límite por archivo al subir desde la intranet. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 20;

type AuthRequest = { user: User };

/** Content-Disposition con el nombre en UTF-8 y una versión ASCII de respaldo. */
function attachmentHeader(name: string): string {
  const ascii = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'archivo';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

@Controller('shared-folders')
export class SharedFoldersController {
  constructor(private readonly service: SharedFoldersService) {}

  @Get('offices')
  offices(@Request() req: AuthRequest) {
    return this.service.myOffices(req.user);
  }

  /** Fuerza la sincronización de miembros de todas las unidades (solo TICOM). */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@Request() req: AuthRequest) {
    if (!(req.user.roles ?? []).some((r) => r.toUpperCase() === 'TICOM')) {
      throw new ForbiddenException('Solo TICOM puede sincronizar las carpetas.');
    }
    return this.service.syncNow();
  }

  @Get(':office/files')
  list(@Request() req: AuthRequest, @Param('office') office: string, @Query('folderId') folderId?: string) {
    return this.service.list(req.user, office, folderId);
  }

  @Post(':office/folders')
  createFolder(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Body() body: { parentId?: string; name: string },
  ) {
    return this.service.createFolder(req.user, office, body.parentId, body.name);
  }

  @Post(':office/upload')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD, {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  upload(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Query('folderId') folderId: string | undefined,
    @UploadedFiles() files: UploadedFile[],
  ) {
    return this.service.upload(req.user, office, folderId, files);
  }

  @Patch(':office/files/:id')
  rename(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    return this.service.rename(req.user, office, id, body.name);
  }

  @Delete(':office/files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trash(@Request() req: AuthRequest, @Param('office') office: string, @Param('id') id: string) {
    await this.service.trash(req.user, office, id);
  }

  @Get(':office/files/:id/download')
  async download(
    @Request() req: AuthRequest,
    @Param('office') office: string,
    @Param('id') id: string,
    @Response({ passthrough: true }) res: ExpressResponse,
  ): Promise<StreamableFile> {
    const file = await this.service.download(req.user, office, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', attachmentHeader(file.name));
    if (file.size !== null) res.setHeader('Content-Length', String(file.size));
    return new StreamableFile(file.stream);
  }
}
