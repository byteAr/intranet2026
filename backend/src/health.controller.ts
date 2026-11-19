import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Public } from './auth/decorators/public.decorator';
import { Roles } from './auth/decorators/roles.decorator';
import { diskSpace } from './common/disk-space.util';

/**
 * Para el healthcheck de Docker: en un pase sin corte (scripts/rollout.sh)
 * el contenedor nuevo recibe tráfico recién cuando esto responde, y el
 * viejo se apaga después. Sano = la app arrancó y llega a la base.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Sin conexión con la base de datos');
    }
    return { ok: true };
  }

  /** Espacio del disco del servidor: el layout le avisa a TICOM si se está llenando. */
  @Roles('TICOM')
  @Get('disk')
  async disk() {
    return (await diskSpace(process.env['MAIL_PST_UPLOAD_PATH'])) ?? { unknown: true };
  }
}
