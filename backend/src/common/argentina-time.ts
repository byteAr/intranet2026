/**
 * Hora de Argentina para lo que ven las personas (grupo fecha-hora de los
 * MTO, años de los códigos, logs). El contenedor corre en UTC a propósito
 * (las tareas programadas y la base cuentan con eso): no usar getHours(),
 * getDate() ni getFullYear() de un Date para mostrar fechas, sino esto.
 */
export const ZONA_ARGENTINA = 'America/Argentina/Buenos_Aires';

export interface ArgentinaParts {
  year: number;
  /** 1 a 12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_ARGENTINA,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

/** Año, mes, día, hora… de ese instante en Argentina. */
export function argentinaParts(date: Date = new Date()): ArgentinaParts {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(PARTS_FORMAT.formatToParts(date).find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Año en Argentina (el 31/12 a las 22 h todavía es este año, aunque en UTC ya sea el siguiente). */
export function argentinaYear(date: Date = new Date()): number {
  return argentinaParts(date).year;
}
