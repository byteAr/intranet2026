import { ConsoleLogger } from '@nestjs/common';
import { ZONA_ARGENTINA } from './argentina-time';

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_ARGENTINA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Los logs de Nest con la hora de Argentina (05/10/2026, 14:55:38) en vez de
 * la del contenedor, que es UTC y en formato de EE. UU.
 */
export class ArgentinaLogger extends ConsoleLogger {
  protected getTimestamp(): string {
    return TIMESTAMP_FORMAT.format(new Date());
  }
}
