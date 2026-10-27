import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { MtoBackupService } from './mto-backup.service';

/** Administración → Respaldo MTO (TICOM): estado y prueba a mano. */
@Controller('mto-backup')
@Roles('TICOM')
export class MtoBackupController {
  constructor(private readonly backup: MtoBackupService) {}

  @Get('status')
  status() {
    return this.backup.status();
  }

  /** Respalda ya unos pocos MTO (los más nuevos que falten), para probar. */
  @Post('run')
  run(@Body() body: { limit?: number }) {
    const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 200);
    if (!this.backup.enabled) throw new BadRequestException('El respaldo no está activado en este servidor (MTO_BACKUP_ENABLED).');
    if (!this.backup.startManual(limit)) throw new BadRequestException('Ya hay un respaldo en curso.');
    return { ok: true, limit };
  }
}
