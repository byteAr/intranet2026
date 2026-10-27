/**
 * Nombres de los archivos dentro de un .rar o .zip, leyendo solo los encabezados
 * (no descomprime nada). Sirve para saber si un comprimido trae adjuntos
 * encriptados por PON (".~00"): ES 4167/26 mandó "LIBRA.part2.rar" con los .~00
 * adentro y el texto mal escrito ("MEDIANTE33/96"), así que no se detectaba.
 *
 * - RAR 5 y RAR 1.5-4.x, también las partes de un volumen (.part2.rar, .r00):
 *   cada parte lleva el encabezado de los archivos que contiene.
 * - Si el RAR se creó cifrando también los nombres, no se pueden leer: null.
 * - ZIP: el directorio central del final.
 * Devuelve null si no es un comprimido conocido o no se pudo leer.
 */
import { isEncryptedAttachment } from './encrypted-attachment.util';

const RAR5_SIG = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
const RAR4_SIG = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);

/** Extensiones de comprimidos que se revisan (al ingresar y en la pasada única). */
export const ARCHIVE_NAME = /\.(rar|zip|r\d{2})$/i;
export const ARCHIVE_NAME_SQL = '\\.(rar|zip|r[0-9]{2})$';

export function listArchiveNames(buf: Buffer): string[] | null {
  try {
    // Un SFX (.exe) o basura delante: la firma puede no estar al principio.
    const window = buf.subarray(0, Math.min(buf.length, 1024 * 1024));
    const r5 = window.indexOf(RAR5_SIG);
    if (r5 >= 0) return rar5Names(buf, r5 + RAR5_SIG.length);
    const r4 = window.indexOf(RAR4_SIG);
    if (r4 >= 0) return rar4Names(buf, r4);
    if (buf.readUInt32LE(0) === 0x04034b50 || buf.length >= 22) return zipNames(buf);
  } catch {
    /* comprimido dañado o cortado: se trata como desconocido */
  }
  return null;
}

/** Si el comprimido trae algún adjunto encriptado por PON (".~00", "._00"). */
export function archiveHasEncrypted(filename: string, data: Buffer): boolean {
  if (!ARCHIVE_NAME.test(filename)) return false;
  const names = listArchiveNames(data);
  return !!names?.some((n) => isEncryptedAttachment(n.split(/[\\/]/).pop()));
}

/** Entero de largo variable de RAR 5 (7 bits por byte). */
function vint(buf: Buffer, pos: number): [number, number] {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 10; i++) {
    const b = buf[pos + i];
    if (b === undefined) throw new Error('vint cortado');
    value += (b & 0x7f) * 2 ** shift;
    shift += 7;
    if (!(b & 0x80)) return [value, pos + i + 1];
  }
  throw new Error('vint inválido');
}

function rar5Names(buf: Buffer, start: number): string[] | null {
  const names: string[] = [];
  let pos = start;
  while (pos + 7 <= buf.length) {
    const [headSize, afterSize] = vint(buf, pos + 4); // salta el CRC32
    const headEnd = afterSize + headSize;
    let p = afterSize;
    let type: number, flags: number;
    [type, p] = vint(buf, p);
    [flags, p] = vint(buf, p);
    if (flags & 0x0001) [, p] = vint(buf, p); // tamaño del área extra
    let dataSize = 0;
    if (flags & 0x0002) [dataSize, p] = vint(buf, p);

    if (type === 4) return null; // encabezados cifrados: no hay nombres legibles
    if (type === 5) break; // fin del archivo
    if (type === 2) {
      let fileFlags: number, nameLen: number;
      [fileFlags, p] = vint(buf, p);
      [, p] = vint(buf, p); // tamaño descomprimido
      [, p] = vint(buf, p); // atributos
      if (fileFlags & 0x0002) p += 4; // fecha
      if (fileFlags & 0x0004) p += 4; // CRC32 de los datos
      [, p] = vint(buf, p); // compresión
      [, p] = vint(buf, p); // sistema operativo
      [nameLen, p] = vint(buf, p);
      names.push(buf.toString('utf8', p, p + nameLen));
    }
    if (headSize <= 0 || headEnd + dataSize <= pos) break;
    pos = headEnd + dataSize;
  }
  return names;
}

function rar4Names(buf: Buffer, start: number): string[] | null {
  const names: string[] = [];
  let pos = start;
  while (pos + 7 <= buf.length) {
    const type = buf[pos + 2];
    const flags = buf.readUInt16LE(pos + 3);
    const headSize = buf.readUInt16LE(pos + 5);
    if (headSize < 7) break;
    let addSize = 0;
    if (flags & 0x8000 || type === 0x74) addSize = buf.readUInt32LE(pos + 7);

    if (type === 0x73 && flags & 0x0080) return null; // nombres cifrados (-hp)
    if (type === 0x7b) break; // fin del archivo
    if (type === 0x74) {
      const nameSize = buf.readUInt16LE(pos + 26);
      let nameStart = pos + 32;
      if (flags & 0x0100) {
        addSize += buf.readUInt32LE(pos + 32) * 2 ** 32; // tamaños de más de 4 GB
        nameStart += 8;
      }
      const raw = buf.subarray(nameStart, nameStart + nameSize);
      // Con nombre Unicode viene primero el nombre en ASCII y un 0: alcanza con ese.
      const zero = raw.indexOf(0);
      names.push((flags & 0x0200 && zero >= 0 ? raw.subarray(0, zero) : raw).toString('latin1'));
    }
    pos += headSize + addSize;
  }
  return names;
}

function zipNames(buf: Buffer): string[] | null {
  // Fin del directorio central: 22 bytes + comentario de hasta 64 KB.
  const from = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count && pos + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const utf8 = buf.readUInt16LE(pos + 8) & 0x0800;
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    names.push(buf.toString(utf8 ? 'utf8' : 'latin1', pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}
