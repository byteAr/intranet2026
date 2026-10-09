/*
 * Coincidencia de "Mis alertas" (términos que cada usuario sigue en los MTO
 * que llegan: DNI, nombre y apellido, código estadístico, expediente...).
 *
 * Se compara el texto normalizado: sin tildes ni mayúsculas, la puntuación
 * como espacio y los números sin los puntos o espacios de miles
 * ("29.465.318" = "29465318"). Un término es una frase (palabras juntas y en
 * ese orden) o, con allWords, todas sus palabras en cualquier orden.
 */

/** Largo mínimo de un término (normalizado): con menos, aparecería en casi todos. */
export const MIN_TERM_LENGTH = 3;

export function normalizeForAlert(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    // 29.465.318 / 29 465 318 → 29465318 (solo entre cifras)
    .replace(/(\d)[.\s]+(?=\d)/g, '$1')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export interface AlertTerm {
  term: string;
  allWords: boolean;
}

/** Texto ya preparado para comparar muchos términos contra el mismo MTO. */
export interface PreparedText {
  padded: string;
  words: Set<string>;
}

export function prepareText(text: string): PreparedText {
  const normalized = normalizeForAlert(text);
  return { padded: ` ${normalized} `, words: new Set(normalized.split(' ').filter(Boolean)) };
}

export function termMatches(prepared: PreparedText, term: AlertTerm): boolean {
  const t = normalizeForAlert(term.term);
  if (t.length < MIN_TERM_LENGTH) return false;
  if (term.allWords) return t.split(' ').every((w) => prepared.words.has(w));
  return prepared.padded.includes(` ${t} `);
}
