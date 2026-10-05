import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Public } from './auth/decorators/public.decorator';

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
}
