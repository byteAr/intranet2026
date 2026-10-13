import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Más grande que esto no se lee (no frena el aviso del resto). */
const MAX_BYTES = 25 * 1024 * 1024;
/** Tope del texto que se compara por archivo. */
const MAX_TEXT = 2_000_000;
const WRITER = new Set(['.doc', '.docx', '.odt', '.rtf']);
const CALC = new Set(['.xls', '.xlsx', '.ods']);
const PLAIN = new Set(['.txt', '.csv']);

/** Si de este archivo se puede sacar el texto (PDF, Word, Excel, texto). */
export function canReadText(filename: string): boolean {
  const ext = extname(filename ?? '').toLowerCase();
  return ext === '.pdf' || WRITER.has(ext) || CALC.has(ext) || PLAIN.has(ext);
}

/** LibreOffice de a uno: cada conversión levanta un proceso pesado. */
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function decodeEntities(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|th|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Texto plano: UTF-8, o windows-1252 si no lo era (los .txt de Windows). */
function decodePlain(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

/** Word con LibreOffice a texto; Excel a HTML (trae todas las hojas, no solo la primera). */
async function viaLibreOffice(path: string, ext: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'alerta-'));
  try {
    const src = join(dir, `documento${ext}`);
    await copyFile(path, src);
    const target = CALC.has(ext) ? 'html' : 'txt:Text (encoded):UTF8';
    await execFileAsync(
      'libreoffice',
      [`-env:UserInstallation=file://${join(dir, 'perfil')}`, '--headless', '--convert-to', target, '--outdir', dir, src],
      { timeout: 90_000 },
    );
    const out = (await readdir(dir)).find((f) => f.startsWith('documento.') && f !== `documento${ext}`);
    if (!out) return '';
    const raw = await readFile(join(dir, out), 'utf8');
    return CALC.has(ext) ? decodeEntities(raw) : raw;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * El texto de un adjunto, para buscar los términos de "Mis alertas". null si
 * no se puede leer (tipo no soportado, muy grande, PDF escaneado sin texto,
 * cifrado .~NN, error). Nunca lanza.
 */
export async function extractAttachmentText(path: string, filename: string): Promise<string | null> {
  const ext = extname(filename ?? '').toLowerCase();
  if (!canReadText(filename) || !existsSync(path)) return null;
  try {
    if ((await stat(path)).size > MAX_BYTES) return null;
    let text: string;
    if (PLAIN.has(ext)) {
      text = decodePlain(await readFile(path));
    } else if (ext === '.pdf') {
      // pdftotext (poppler-utils): el texto del PDF; uno escaneado (solo imagen) no trae texto
      const { stdout } = await execFileAsync('pdftotext', ['-q', '-enc', 'UTF-8', path, '-'], {
        timeout: 60_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      text = stdout;
    } else {
      text = await oneAtATime(() => viaLibreOffice(path, ext));
    }
    return text.trim() ? text.slice(0, MAX_TEXT) : null;
  } catch {
    return null;
  }
}
