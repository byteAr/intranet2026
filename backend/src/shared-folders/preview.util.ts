import { execFile } from 'child_process';
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Más grande que esto no se previsualiza: se descarga. */
export const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;

/** Docs, Sheets, Slides y dibujos de Google: Drive los exporta a PDF. */
const GOOGLE_TO_PDF = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
]);

/**
 * Se muestran tal cual en el visor. Sin SVG ni HTML: se abren como blob con el
 * origen de la intranet y podrían ejecutar código.
 */
const INLINE = /^(application\/pdf|image\/(png|jpe?g|gif|webp|bmp)|video\/(mp4|webm)|audio\/(mpeg|mp4|ogg|wav|webm))$/;

/** Documentos de oficina: LibreOffice los convierte a PDF, como los adjuntos de MTO. */
const OFFICE_EXT = new Set([
  '.doc', '.docx', '.odt', '.rtf',
  '.xls', '.xlsx', '.ods',
  '.ppt', '.pptx', '.odp',
]);

export type PreviewKind = 'inline' | 'text' | 'google-pdf' | 'convert' | 'none';

export function previewKind(mimeType: string, name: string): PreviewKind {
  if (GOOGLE_TO_PDF.has(mimeType)) return 'google-pdf';
  if (INLINE.test(mimeType)) return 'inline';
  if (OFFICE_EXT.has(extname(name).toLowerCase())) return 'convert';
  if (mimeType.startsWith('text/') || /\.(txt|csv|log)$/i.test(name)) return 'text';
  return 'none';
}

/**
 * Convierte un documento a PDF con LibreOffice. Cada conversión usa su propia
 * carpeta y su propio perfil de LibreOffice: dos a la vez con el perfil
 * compartido fallan. La carpeta se borra al terminar de leer el PDF.
 */
export async function convertToPdf(source: Readable, name: string): Promise<Readable> {
  const dir = await mkdtemp(join(tmpdir(), 'preview-'));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => undefined);
  try {
    const src = join(dir, `documento${extname(name).toLowerCase()}`);
    await pipeline(source, createWriteStream(src));
    await execFileAsync(
      'libreoffice',
      [`-env:UserInstallation=file://${join(dir, 'perfil')}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, src],
      { timeout: 60_000 },
    );
    const pdf = join(dir, 'documento.pdf');
    if (!existsSync(pdf)) throw new Error('LibreOffice no generó el PDF');
    const stream = createReadStream(pdf);
    stream.on('close', () => void cleanup());
    return stream;
  } catch (err) {
    await cleanup();
    throw err;
  }
}
