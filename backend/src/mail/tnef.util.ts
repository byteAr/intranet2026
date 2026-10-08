/**
 * winmail.dat (TNEF, "application/ms-tnef"): cuando alguien manda desde Outlook
 * en "Texto enriquecido", los adjuntos no viajan sueltos sino dentro de este
 * paquete. Outlook lo abre solo; la intranet mostraba el paquete cerrado y los
 * archivos (muchas veces encriptados .~00) no se veían. Esto saca los adjuntos.
 *
 * Formato: firma 0x223E9F78, clave (2 bytes) y una lista de atributos
 * [nivel 1 B][id 4 B][largo 4 B][datos][checksum 2 B]. Nivel 2 = adjunto.
 */

const TNEF_SIGNATURE = 0x223e9f78;
const LVL_ATTACHMENT = 0x02;

/** Atributos de nivel adjunto (id completo: tipo << 16 | atributo). */
const ATT_ATTACH_REND_DATA = 0x00069002; // empieza un adjunto nuevo
const ATT_ATTACH_TITLE = 0x00018010; // nombre (8.3, en la página de códigos de Windows)
const ATT_ATTACH_DATA = 0x0006800f; // contenido
const ATT_ATTACHMENT = 0x00069005; // propiedades MAPI (nombre largo, tipo MIME)

/** Propiedades MAPI que interesan. */
const PR_ATTACH_LONG_FILENAME = 0x3707;
const PR_ATTACH_FILENAME = 0x3704;
const PR_ATTACH_MIME_TAG = 0x370e;
const PR_DISPLAY_NAME = 0x3001;

export interface TnefAttachment {
  filename: string;
  contentType: string | null;
  data: Buffer;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  txt: 'text/plain',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
};

/** ¿Es el paquete de Outlook? Por el nombre o el tipo, y confirmado por la firma. */
export function isTnefAttachment(att: { filename: string; contentType?: string | null; data: Buffer }): boolean {
  return (/^winmail\.dat$/i.test(att.filename) || /ms-tnef/i.test(att.contentType ?? '')) && isTnef(att.data);
}

/**
 * Reemplaza cada winmail.dat por los archivos que trae adentro. Si un paquete no
 * se puede abrir (o viene vacío), queda como estaba: nunca se pierde nada.
 */
export function expandTnef<T extends { filename: string; contentType: string; data: Buffer }>(
  attachments: T[],
): { filename: string; contentType: string; data: Buffer }[] {
  const out: { filename: string; contentType: string; data: Buffer }[] = [];
  for (const att of attachments) {
    const inner = isTnefAttachment(att) ? parseTnef(att.data) : [];
    if (!inner.length) {
      out.push(att);
      continue;
    }
    for (const f of inner) {
      const ext = f.filename.split('.').pop()?.toLowerCase() ?? '';
      out.push({ filename: f.filename, contentType: f.contentType || MIME_BY_EXT[ext] || 'application/octet-stream', data: f.data });
    }
  }
  return out;
}

export function isTnef(buf: Buffer): boolean {
  return buf.length >= 6 && buf.readUInt32LE(0) === TNEF_SIGNATURE;
}

/** Los adjuntos del paquete. Si no es TNEF o viene roto, lo que se pudo leer (o []). */
export function parseTnef(buf: Buffer): TnefAttachment[] {
  if (!isTnef(buf)) return [];
  const out: { title?: string; longName?: string; mime?: string; data?: Buffer }[] = [];
  let current: (typeof out)[number] | null = null;
  let pos = 6; // firma + clave

  while (pos + 9 <= buf.length) {
    const level = buf.readUInt8(pos);
    const id = buf.readUInt32LE(pos + 1);
    const len = buf.readUInt32LE(pos + 5);
    const start = pos + 9;
    const end = start + len;
    if (end + 2 > buf.length) break; // cortado
    const data = buf.subarray(start, end);
    pos = end + 2; // + checksum

    if (level !== LVL_ATTACHMENT) continue;
    if (id === ATT_ATTACH_REND_DATA) {
      current = {};
      out.push(current);
    } else if (current && id === ATT_ATTACH_TITLE) {
      current.title = cString(data, 'latin1');
    } else if (current && id === ATT_ATTACH_DATA) {
      current.data = Buffer.from(data);
    } else if (current && id === ATT_ATTACHMENT) {
      const props = readMapiProps(data);
      current.longName = props.get(PR_ATTACH_LONG_FILENAME) ?? props.get(PR_ATTACH_FILENAME) ?? props.get(PR_DISPLAY_NAME);
      current.mime = props.get(PR_ATTACH_MIME_TAG);
    }
  }

  return out
    .filter((a) => a.data && a.data.length > 0)
    .map((a, i) => ({
      filename: (a.longName || a.title || `adjunto-${i + 1}`).trim(),
      contentType: a.mime ?? null,
      data: a.data!,
    }));
}

function cString(data: Buffer, encoding: 'latin1' | 'utf16le'): string {
  let text = data.toString(encoding);
  const nul = text.indexOf('\u0000');
  if (nul >= 0) text = text.slice(0, nul);
  return text;
}

/**
 * Lista de propiedades MAPI (solo las de texto que interesan). Formato:
 * [cantidad 4 B] y por cada una [tipo 2 B][id 2 B] (+ nombre si id >= 0x8000)
 * y el valor; los de largo variable van como [cantidad][largo][datos con relleno a 4].
 */
function readMapiProps(buf: Buffer): Map<number, string> {
  const props = new Map<number, string>();
  try {
    let p = 0;
    const count = buf.readUInt32LE(p);
    p += 4;
    for (let n = 0; n < count && p + 4 <= buf.length; n++) {
      let type = buf.readUInt16LE(p);
      const propId = buf.readUInt16LE(p + 2);
      p += 4;
      if (propId >= 0x8000) {
        // Propiedad con nombre: GUID (16) + tipo de nombre (4) + id o nombre
        p += 16;
        const kind = buf.readUInt32LE(p);
        p += 4;
        if (kind === 0) p += 4;
        else {
          const nameLen = buf.readUInt32LE(p);
          p += 4 + pad4(nameLen);
        }
      }
      const multi = (type & 0x1000) !== 0;
      type &= ~0x1000;
      const values = multi || isVariable(type) ? buf.readUInt32LE(p) : 1;
      if (multi || isVariable(type)) p += 4;
      for (let v = 0; v < values; v++) {
        if (isVariable(type)) {
          const len = buf.readUInt32LE(p);
          p += 4;
          const raw = buf.subarray(p, p + len);
          p += pad4(len);
          if (v === 0 && type === 0x001e) props.set(propId, cString(raw, 'latin1'));
          if (v === 0 && type === 0x001f) props.set(propId, cString(raw, 'utf16le'));
        } else {
          p += pad4(fixedSize(type));
        }
      }
    }
  } catch {
    /* propiedades rotas: se usa lo que se leyó */
  }
  return props;
}

function isVariable(type: number): boolean {
  // PT_STRING8, PT_UNICODE, PT_BINARY, PT_OBJECT
  return type === 0x001e || type === 0x001f || type === 0x0102 || type === 0x000d;
}

function fixedSize(type: number): number {
  switch (type) {
    case 0x0002: // PT_SHORT
    case 0x000b: // PT_BOOLEAN
    case 0x0003: // PT_LONG
    case 0x0004: // PT_FLOAT
    case 0x000a: // PT_ERROR
      return 4;
    case 0x0005: // PT_DOUBLE
    case 0x0006: // PT_CURRENCY
    case 0x0007: // PT_APPTIME
    case 0x0014: // PT_I8
    case 0x0040: // PT_SYSTIME
      return 8;
    case 0x0048: // PT_CLSID
      return 16;
    default:
      return 4;
  }
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}
