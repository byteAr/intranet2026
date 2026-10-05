const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/**
 * Grupo fecha-hora de los MTO (DDHHMMMESAA, ej. 051455OCT26) en hora de
 * Argentina, igual que el que arma el servidor al enviar. No depende de la
 * hora configurada en la PC.
 */
export function fmtDateGroup(d: Date): string {
  const parts = PARTS.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(get('day'))}${pad(get('hour'))}${pad(get('minute'))}${MONTHS[get('month') - 1]}${String(get('year')).slice(-2)}`;
}
