import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { ScansService } from './scans.service';
import { User } from '../users/entities/user.entity';

type AuthRequest = { user: User };

function isTicom(user: User): boolean {
  return (user.roles ?? []).some((r) => r.toUpperCase() === 'TICOM');
}

/** Escaneos de las impresoras: pestaña "Escaneos" de Archivos compartidos. */
@Controller('scans')
export class ScansController {
  constructor(private readonly scans: ScansService) {}

  // ─── TICOM: accesos para cargar en las impresoras ──────────────────────────

  @Get('admin/accounts')
  accounts(@Req() req: AuthRequest) {
    if (!isTicom(req.user)) throw new ForbiddenException('Solo TICOM.');
    return this.scans.listAccounts();
  }

  /** Crea el acceso de la oficina o le genera una contraseña nueva. */
  @Post('admin/accounts/:group')
  createAccount(@Req() req: AuthRequest, @Param('group') group: string) {
    if (!isTicom(req.user)) throw new ForbiddenException('Solo TICOM.');
    return this.scans.createOrResetAccount(group);
  }

  // ─── La oficina ────────────────────────────────────────────────────────────

  @Get(':group')
  list(@Req() req: AuthRequest, @Param('group') group: string) {
    return this.scans.list(req.user, group);
  }

  /** El archivo, para la vista previa; con ?download=1, como descarga. */
  @Get(':group/:id/file')
  async file(
    @Req() req: AuthRequest,
    @Param('group') group: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const scan = await this.scans.get(req.user, group, id);
    const name = encodeURIComponent(scan.filename);
    res.setHeader('Content-Type', scan.contentType);
    res.setHeader('Content-Length', String(scan.size));
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${name}"; filename*=UTF-8''${name}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    createReadStream(scan.storagePath).pipe(res);
  }

  @Patch(':group/:id')
  rename(
    @Req() req: AuthRequest,
    @Param('group') group: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string },
  ) {
    return this.scans.rename(req.user, group, id, body?.name);
  }

  @Delete(':group/:id')
  async remove(@Req() req: AuthRequest, @Param('group') group: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.scans.remove(req.user, group, id);
    return { ok: true };
  }

  /** Copia en Archivos: target 'office' (unidad de la oficina) o 'personal' (Mis archivos). */
  @Post(':group/:id/save')
  save(
    @Req() req: AuthRequest,
    @Param('group') group: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { target: 'office' | 'personal' },
  ) {
    return this.scans.saveToDrive(req.user, group, id, body?.target === 'personal' ? 'personal' : 'office');
  }
}
