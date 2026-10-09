/*
 * Códigos de MTO dentro de un texto, incluidos los mal escritos.
 * ⚠️ Copia idéntica en frontend/src/app/features/mail/mail-code.ts (la pantalla
 * pinta las referencias con la misma regla): si se cambia una, cambiar la otra.
 *
 * Bien escrito: PREFIJO NUM/AA ("DE 130/19"; tolera ruido entre las partes:
 * "AA 12../19", "DE(130)/19"). Errores frecuentes de quien confecciona el MTO
 * que también se reconocen (09/10/2026):
 *  - sin /AA pero con el grupo fecha-hora: "SDQ 446 (07OCT26)", "DEI 390 DEL
 *    302003MAR26" → el año sale de la fecha;
 *  - año con 4 cifras: "SDQ 446/2026" → SDQ 446/26;
 *  - "MTO" + código sin año ni fecha: "REL MTO SDQ 446" → el año del MTO que
 *    lo cita o, si solo existe ese, el anterior (enero que cita a diciembre).
 */

/** PREFIJO NUM/AA bien escrito (el mismo de siempre). */
export const CODE_REGEX = /\b([A-ZÁÉÍÓÚÑ]{1,4})[ \t]*(\d+)[^\w\/]*\/[^\w]*(\d[^\w\/]*\d)\b/g;

/** Nunca son códigos de MTO: indicadores (PON = clave de cifrado) o palabras comunes antes de un número. */
export const EXCLUDED_PREFIXES = new Set(['PON', 'DDNG']);
const NOT_A_PREFIX = new Set([
  ...EXCLUDED_PREFIXES,
  'MTO', 'MTOS', 'NRO', 'NOTA', 'LEY', 'ART', 'DNI', 'CE', 'MI', 'HS', 'KM', 'RES', 'DTO', 'EXP',
  'CUIT', 'CUIL', 'DE', 'DEL', 'EL', 'LA', 'LOS', 'LAS', 'AL', 'EN', 'Y', 'NO', 'POR', 'CON', 'SIN',
  'DIA', 'DIAS', 'HORA', 'ANO', 'AÑO', 'CAP', 'INC', 'PAG', 'FS', 'TEL', 'INT',
]);

const MONTHS = 'ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC|JAN|APR|AUG|DEC';
/** El prefijo no puede venir pegado a otra letra o número (\b no sirve con Ñ o tildes). */
const START = '(?<![A-Za-zÁÉÍÓÚÑ0-9])';
const PREFIX = '([A-ZÁÉÍÓÚÑ]{2,4})';

/** "SDQ 446 (07OCT26)", "SDQ 446, DEL 07OCT26", "SDQ 446 DE FECHA 302003MAR26" */
const WITH_DATE = new RegExp(
  `${START}${PREFIX}[ \\t]*(\\d{1,4})[ \\t]*,?[ \\t]*(?:\\([ \\t]*|(?:DEL|DE FECHA|FECHA|DE)[ \\t]+)?\\d{2}(?:\\d{4})?[ \\t]*(?:${MONTHS})[ \\t]*(\\d{2})(?![0-9])\\)?`,
  'g',
);
/** "SDQ 446/2026" */
const FULL_YEAR = new RegExp(`${START}${PREFIX}[ \\t]*(\\d{1,4})[ \\t]*\\/[ \\t]*20(\\d{2})(?![0-9])`, 'g');
/** "MTO SDQ 446", "MTOS SDQ 446", "MTO NRO SDQ 446": el código es el grupo 1 y 2 */
const AFTER_MTO = new RegExp(`${START}MTOS?[ \\t.:]+(?:N(?:RO|°|º)?\\.?[ \\t]*)?${PREFIX}[ \\t]*(\\d{1,4})(?![0-9])`, 'gd');

export interface CodeMention {
  /** Dónde está en el texto (lo que se resalta). */
  index: number;
  length: number;
  /** Código normalizado "PREFIJO NUM/AA"; si hay más de uno, el primero es el más probable. */
  candidates: string[];
}

const AR_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric' });

/** Año (2 cifras) en Argentina de la fecha del MTO, o de hoy si no hay. */
function twoDigitYear(date?: Date | string | null): number {
  const d = date ? new Date(date) : new Date();
  return Number(AR_YEAR.format(Number.isNaN(d.getTime()) ? new Date() : d)) % 100;
}

const pad = (n: number) => String((n + 100) % 100).padStart(2, '0');

/**
 * Todas las menciones de códigos en el texto, en orden y sin superponerse:
 * primero las bien escritas y después las inferidas (una inferida que pisa a
 * una bien escrita se descarta).
 */
export function findCodeMentions(text: string, emailDate?: Date | string | null): CodeMention[] {
  if (!text) return [];
  const found: CodeMention[] = [];
  const overlaps = (index: number, length: number) =>
    found.some((m) => index < m.index + m.length && m.index < index + length);

  for (const m of text.matchAll(new RegExp(CODE_REGEX.source, 'g'))) {
    if (EXCLUDED_PREFIXES.has(m[1])) continue;
    found.push({ index: m.index!, length: m[0].length, candidates: [`${m[1]} ${m[2]}/${m[3].replace(/\D/g, '')}`] });
  }
  for (const m of text.matchAll(WITH_DATE)) {
    if (NOT_A_PREFIX.has(m[1]) || overlaps(m.index!, m[0].length)) continue;
    found.push({ index: m.index!, length: m[0].length, candidates: [`${m[1]} ${m[2]}/${m[3]}`] });
  }
  for (const m of text.matchAll(FULL_YEAR)) {
    if (NOT_A_PREFIX.has(m[1]) || overlaps(m.index!, m[0].length)) continue;
    found.push({ index: m.index!, length: m[0].length, candidates: [`${m[1]} ${m[2]}/${m[3]}`] });
  }
  const yy = twoDigitYear(emailDate);
  for (const m of text.matchAll(AFTER_MTO)) {
    // Solo el código (sin "MTO "): es lo que se resalta.
    const [start] = (m as RegExpMatchArray & { indices: [number, number][] }).indices[1];
    const length = m.index! + m[0].length - start;
    if (NOT_A_PREFIX.has(m[1]) || overlaps(start, length)) continue;
    // Si lo que sigue es "/" es un código bien escrito con ruido raro: no se adivina.
    if (/^[^\w\n]*\//.test(text.slice(m.index! + m[0].length))) continue;
    const num = m[2];
    found.push({ index: start, length, candidates: [`${m[1]} ${num}/${pad(yy)}`, `${m[1]} ${num}/${pad(yy - 1)}`] });
  }
  return found.sort((a, b) => a.index - b.index);
}
