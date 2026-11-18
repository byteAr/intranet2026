import * as fs from 'fs';

/**
 * Revisa la cabecera de un PST (MS-PST 2.2.2.6) sin abrirlo: el propio archivo
 * dice cuántos bytes tiene (`ibFileEof`). Si en el disco hay menos, la copia o
 * la subida quedó cortada y los índices (que Outlook guarda al final) no están:
 * no se puede importar. Pasó con 2019.pst (18/11/2026): llegaron 8,19 GB de
 * 8,84 GB y la pantalla lo dejaba importar porque solo miraba si pesaba 0 B.
 */
export interface PstCheck {
  /** Texto corto para la pantalla; vacío si el archivo está bien. */
  problem: string | null;
  expectedSize: number | null;
  actualSize: number;
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function checkPstFile(filePath: string): PstCheck {
  const actualSize = fs.statSync(filePath).size;
  if (actualSize === 0) return { problem: 'Subida incompleta (0 B)', expectedSize: null, actualSize };
  if (actualSize < 512) return { problem: 'No es un PST (o la subida lo dañó)', expectedSize: null, actualSize };

  const h = Buffer.alloc(512);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, h, 0, 512, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (h.subarray(0, 4).toString('latin1') !== '!BDN') {
    return { problem: 'No es un PST (o la subida lo dañó)', expectedSize: null, actualSize };
  }

  const ver = h.readUInt16LE(10);
  const ansi = ver === 14 || ver === 15;
  // ROOT: en ANSI empieza en 168 y los offsets son de 4 bytes; en Unicode (23 y 36), en 180 y de 8.
  const expectedSize = ansi ? h.readUInt32LE(168 + 4) : Number(h.readBigUInt64LE(180 + 4));
  if (expectedSize > actualSize) {
    return {
      problem: `Subida incompleta: faltan ${formatBytes(expectedSize - actualSize)}`,
      expectedSize,
      actualSize,
    };
  }
  return { problem: null, expectedSize, actualSize };
}

/** Error del lector al abrir un PST con el índice roto, en castellano. */
export function explainPstError(message: string): string {
  if (/findBtreeItem|Unable to find node/i.test(message)) {
    return 'No se pudo abrir el PST: su índice interno está dañado o incompleto. ' +
      'Repararlo con SCANPST.EXE (con Outlook cerrado) o exportarlo a un PST nuevo desde Outlook, y volver a subirlo.';
  }
  return message;
}
