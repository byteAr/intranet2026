import * as fs from 'fs';

/**
 * Espacio del disco del servidor, visto desde el contenedor. Los volúmenes de
 * Docker están en el mismo disco que todo lo demás (/dev/sda1 de la VM), así
 * que alcanza con preguntar por cualquier carpeta montada.
 *
 * 19/11/2026: el disco llegó al 100 % (1,9 GB libres) sin que nadie se
 * enterara; una subida de PST de 9 GB se cortaba con "Error al subir el
 * archivo" y la base podía quedarse sin lugar. De ahí el aviso a TICOM.
 */
export const DISK_LOW_PERCENT = 90;
export const DISK_LOW_FREE_BYTES = 20 * 1024 ** 3;
/** Lo que se deja libre siempre (base, MTO que entran, registros) al aceptar una subida grande. */
export const DISK_UPLOAD_MARGIN_BYTES = 5 * 1024 ** 3;

export interface DiskSpace {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
  /** Pasó del 90 % o quedan menos de 20 GB. */
  low: boolean;
  /** Lo más grande que se puede subir sin comerse el margen. */
  uploadMaxBytes: number;
}

export async function diskSpace(...paths: (string | undefined)[]): Promise<DiskSpace | null> {
  const target = [...paths, '/app/storage', '/'].find((p) => !!p && fs.existsSync(p));
  if (!target) return null;
  try {
    const s = await fs.promises.statfs(target);
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    const usedBytes = totalBytes - s.bfree * s.bsize;
    // Como df: usado / (usado + disponible), sin el reservado para root.
    const usedPercent = Math.round((usedBytes / (usedBytes + freeBytes)) * 100);
    return {
      totalBytes,
      freeBytes,
      usedPercent,
      low: usedPercent >= DISK_LOW_PERCENT || freeBytes < DISK_LOW_FREE_BYTES,
      uploadMaxBytes: Math.max(0, freeBytes - DISK_UPLOAD_MARGIN_BYTES),
    };
  } catch {
    return null;
  }
}
