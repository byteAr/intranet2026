import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { MtoBackupService } from './mto-backup.service';

/** Administración → Respaldo MTO (TICOM): estado del respaldo nocturno. */
@Controller('mto-backup')
@Roles('TICOM')
export class MtoBackupController {
  constructor(private readonly backup: MtoBackupService) {}

  @Get('status')
  status() {
    return this.backup.status();
  }
}
