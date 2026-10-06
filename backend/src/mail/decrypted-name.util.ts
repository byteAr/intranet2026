import { closeSync, openSync, readSync } from 'fs';

/**
 * Nombre real de un desencriptado. El programa de PON devuelve los archivos con
 * el nombre corto de DOS (CONTRO~1.DOC), igual que el encriptado (CONTRO~1.~00);
 * el nombre verdadero está en el cuerpo del MTO: ADJUNTO ARCHIVO "CONTROL09" (DOCX).
 */

interface DeclaredName {
  name: string;
  ext: string | null;
}

const OOXML = ['docx', 'xlsx', 'pptx'];
const OLE = ['doc', 'xls', 'ppt'];

/** Los nombres entre comillas del cuerpo, con el tipo si lo aclara: "CONTROL09" (DOCX). */
function declaredNames(body: string | null | undefined): DeclaredName[] {
  if (!body) return [];
  const out: DeclaredName[] = [];
  const re = /["“]([^"“”\r\n]{1,120})["”](?:\s*\(\s*([A-Za-z0-9]{2,5})\s*\))?/g;
  for (const m of body.matchAll(re)) {
    let name = m[1].trim();
    let ext = m[2]?.toLowerCase() ?? null;
    const dotted = /^(.+)\.([A-Za-z0-9]{2,5})$/.exec(name);
    if (dotted) {
      name = dotted[1];
      ext = ext ?? dotted[2].toLowerCase();
    }
    if (name) out.push({ name, ext });
  }
  return out;
}

const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Qué es por dentro: los .docx/.xlsx son un zip; los .doc/.xls, un archivo OLE. */
function contentKind(path: string): 'zip' | 'ole' | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(4);
    readSync(fd, head, 0, 4, 0);
    if (head.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'zip';
    if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) return 'ole';
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Nombre para mostrar y descargar. Si lo que subió TICOM tiene nombre corto de DOS
 * y en el cuerpo hay un único nombre que empieza igual, se usa ese, con la
 * extensión que corresponde a lo que el archivo es por dentro. Si no, el subido.
 */
export function decryptedDisplayName(uploadedName: string, storagePath: string, body: string | null | undefined): string {
  const short = /^([^~.]{1,6})~\d+(?:\.([A-Za-z0-9]{1,4}))?$/.exec(uploadedName);
  if (!short) return uploadedName;

  const prefix = normalize(short[1]);
  const matches = declaredNames(body).filter((d) => prefix && normalize(d.name).startsWith(prefix));
  // Dos nombres que empiezan igual (CONTROL09 y CONTROL10): no se adivina cuál es.
  if (matches.length !== 1) return uploadedName;

  let ext = matches[0].ext ?? short[2]?.toLowerCase() ?? '';
  const kind = contentKind(storagePath);
  if (kind === 'zip' && OLE.includes(ext)) ext += 'x';
  if (kind === 'ole' && OOXML.includes(ext)) ext = ext.slice(0, -1);
  return ext ? `${matches[0].name}.${ext}` : matches[0].name;
}
