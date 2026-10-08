/**
 * Limpieza del texto de los correos antes de guardarlos.
 *
 * Muchos correos (sobre todo los que salen de Outlook) declaran
 * `charset=iso-8859-1` pero en realidad vienen en windows-1252. Las dos
 * codificaciones coinciden salvo en el rango 0x80-0x9F, que es justo donde
 * windows-1252 pone las comillas tipográficas, la raya, los puntos
 * suspensivos, etc. Decodificados como ISO-8859-1 esos bytes quedan como
 * caracteres de control C1 (U+0080-U+009F) y el navegador los dibuja como
 * cuadrados: `“CURSO”` se veía como `□CURSO□`.
 *
 * Los navegadores tratan ISO-8859-1 como windows-1252 por la misma razón
 * (estándar WHATWG Encoding); acá se hace lo mismo.
 */

/** windows-1252 → Unicode para el rango 0x80-0x9F. Los huecos no están definidos. */
const CP1252_C1: Record<number, string> = {
  0x80: '€', // €
  0x82: '‚', // ‚
  0x83: 'ƒ', // ƒ
  0x84: '„', // „
  0x85: '…', // …
  0x86: '†', // †
  0x87: '‡', // ‡
  0x88: 'ˆ', // ˆ
  0x89: '‰', // ‰
  0x8a: 'Š', // Š
  0x8b: '‹', // ‹
  0x8c: 'Œ', // Œ
  0x8e: 'Ž', // Ž
  0x91: '‘', // ‘
  0x92: '’', // ’
  0x93: '“', // “
  0x94: '”', // ”
  0x95: '•', // •
  0x96: '–', // –
  0x97: '—', // —
  0x98: '˜', // ˜
  0x99: '™', // ™
  0x9a: 'š', // š
  0x9b: '›', // ›
  0x9c: 'œ', // œ
  0x9e: 'ž', // ž
  0x9f: 'Ÿ', // Ÿ
};

const C1_CHARS = /[\u0080-\u009F]/g;

/** Controles C0 que nunca son texto (se conservan tabulador y saltos de línea). */
const C0_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function normalizeMailText<T extends string | null | undefined>(text: T): T {
  if (!text) return text;
  return replaceLostSpaces(decodeQpResidue(text))
    .replace(C1_CHARS, (ch) => CP1252_C1[ch.charCodeAt(0)] ?? '')
    .replace(C0_CHARS, '') as T;
}

/** Un byte de 0x80 en adelante escrito como quoted-printable: "=F3" (ó), "=E1" (á). */
const QP_HIGH_BYTE = /=[89A-F][0-9A-F]/g;
/** Una tira de bytes quoted-printable seguidos: "=C3=B3", "=F3". */
const QP_RUN = /(?:=[0-9A-F]{2})+/g;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Quoted-printable que quedó sin decodificar: el aviso de confidencialidad que
 * agrega el servidor de correo llega codificado pero sin declararlo, y se veía
 * "electr=F3nico", "est=E1". Solo se toca si hay al menos dos bytes altos (así
 * un "=E1" suelto en un texto real no cambia), y cada tira se lee como UTF-8 si
 * lo es ("=C3=B3") o, si no, como windows-1252 ("=F3").
 */
export function decodeQpResidue(text: string): string {
  if ((text.match(QP_HIGH_BYTE) ?? []).length < 2) return text;
  return text
    .replace(/=\r?\n/g, '') // saltos "blandos" del quoted-printable
    .replace(QP_RUN, (run) => {
      const bytes = Uint8Array.from(run.slice(1).split('=').map((h) => parseInt(h, 16)));
      if (!bytes.some((b) => b >= 0x80)) return run; // "=3D", "=20" solos: se dejan
      try {
        return UTF8.decode(bytes);
      } catch {
        return Array.from(bytes, (b) => (b >= 0x80 && b <= 0x9f ? CP1252_C1[b] ?? '' : String.fromCharCode(b))).join('');
      }
    });
}

/**
 * "�" (U+FFFD): un byte que no era UTF-8 en un correo que decía serlo. Casi
 * siempre era un espacio duro de Outlook (0xA0), con el que alinea "FDO:",
 * "BT:", "TX:" y deja renglones en blanco. Se vuelve espacio, salvo pegado
 * después de una letra ("est�", "l�nea"): ahí era una letra con tilde que no se
 * puede saber cuál era, y se deja para no perder que faltaba algo.
 */
export function replaceLostSpaces(text: string): string {
  if (!text.includes('�')) return text;
  return text.replace(/�/g, (_, i: number) => (i > 0 && /\p{L}/u.test(text[i - 1]) ? '�' : ' '));
}

/**
 * La misma corrección expresada para PostgreSQL, para reparar los correos
 * ya guardados: `translate(col, from, to)` reemplaza carácter por carácter y
 * elimina los de `from` que no tienen par en `to` (los huecos de cp1252).
 */
export function cp1252SqlRepair(): {
  translateFrom: string;
  translateTo: string;
  c0Pattern: string;
  dirtyPattern: string;
} {
  const definidos = Object.keys(CP1252_C1).map(Number);
  const indefinidos: number[] = [];
  for (let c = 0x80; c <= 0x9f; c++) if (!(c in CP1252_C1)) indefinidos.push(c);

  return {
    translateFrom: [...definidos, ...indefinidos].map((c) => String.fromCharCode(c)).join(''),
    translateTo: definidos.map((c) => CP1252_C1[c]).join(''),
    // U+0000 no puede existir en un text de PostgreSQL, así que se arranca en U+0001.
    c0Pattern: '[\u0001-\u0008\u000B\u000C\u000E-\u001F]',
    dirtyPattern: '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u0080-\u009F]',
  };
}
