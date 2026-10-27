/**
 * Restaura los MTO desde el respaldo de Google Drive ("Respaldo MTO" de
 * MTO_BACKUP_ACCOUNT, ver mto-backup.service.ts). Para un servidor nuevo o una
 * base perdida. Corre DENTRO del contenedor del backend, con el backend andando:
 *
 *   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend \
 *     node dist/mto-backup/restore.js [--desde=2024] [--hasta=2026] [--probar]
 *
 *   --desde / --hasta   solo esos años (por defecto, todos)
 *   --probar            recorre y cuenta, sin guardar nada
 *
 * Por cada carpeta de MTO: baja el .msg y lo reingresa por la misma vía que el
 * mail-bridge (POST /api/mail/bridge/ingest) con `restore: true`, así se
 * reclasifica, se extraen códigos y referencias igual que siempre, pero sin
 * avisar a nadie y con la fecha del MTO como fecha de ingreso. Los demás
 * archivos de la carpeta son los desencriptados (o SIENA): se guardan en su
 * volumen y se enganchan al adjunto encriptado. Anota en mto_backups /
 * mto_backup_files / mto_backup_folders que ya están en Drive (el respaldo de
 * la madrugada no los vuelve a subir). Se puede cortar y volver a correr: lo
 * que ya está no se duplica.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto';
import { createWriteStream, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { google, drive_v3 } from 'googleapis';
import { parseMsg } from './restore-msg.util';

const { Client } = require('pg');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_NAME = 'Respaldo MTO';
const ENCRYPTED = /\.[~_]\d{2}$/;

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const DESDE = Number(arg('desde') ?? 0);
const HASTA = Number(arg('hasta') ?? 9999);
const PROBAR = process.argv.includes('--probar');

function secret(file: string, env: string, fallback = ''): string {
  try {
    const v = readFileSync(`/run/secrets/${file}`, 'utf8').trim();
    if (v) return v;
  } catch {
    /* sin archivo: variable de entorno */
  }
  return process.env[env] ?? fallback;
}

const ACCOUNT = (process.env.MTO_BACKUP_ACCOUNT || 'telematicodiredtos@iugna.edu.ar').toLowerCase();
const BACKEND = process.env.RESTORE_BACKEND_URL || 'http://127.0.0.1:3000';
const BRIDGE_SECRET = secret('mail_bridge_secret', 'MAIL_BRIDGE_SECRET');
const DECRYPTED_DIR = process.env.DECRYPTED_ATTACHMENTS_PATH || '/app/storage/decrypted-attachments';
const SIENA_DIR = process.env.SIENA_FILES_PATH || '/app/storage/siena-files';

const stats = { mto: 0, nuevos: 0, yaEstaban: 0, archivos: 0, errores: 0 };
const errores: string[] = [];

function drive(): drive_v3.Drive {
  const key = JSON.parse(readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_PATH!, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: ACCOUNT,
  });
  return google.drive({ version: 'v3', auth });
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let wait = 2000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = Number(err?.code ?? err?.response?.status ?? 0);
      if (!(status === 429 || status >= 500 || status === 403) || i >= 6) throw err;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 64_000);
    }
  }
}

async function children(d: drive_v3.Drive, parentId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() =>
      d.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size)',
        pageSize: 1000,
        pageToken,
      }),
    );
    out.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

const isFolder = (f: drive_v3.Schema$File) => f.mimeType === FOLDER_MIME;

async function download(d: drive_v3.Drive, fileId: string): Promise<Buffer> {
  const res = await withRetry(() => d.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' }));
  return Buffer.from(res.data as ArrayBuffer);
}

async function ingest(payload: object): Promise<{ id?: string; skipped?: boolean }> {
  const res = await fetch(`${BACKEND}/api/mail/bridge/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BRIDGE_SECRET}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`el backend respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<{ id?: string; skipped?: boolean }>;
}

async function main() {
  if (!BRIDGE_SECRET) throw new Error('Falta el secreto del puente (/run/secrets/mail_bridge_secret)');
  const d = drive();
  const db = new Client({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: secret('postgres_password', 'POSTGRES_PASSWORD'),
  });
  await db.connect();

  const rootList = await withRetry(() =>
    d.files.list({ q: `'root' in parents and name = '${ROOT_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`, fields: 'files(id)' }),
  );
  const rootId = rootList.data.files?.[0]?.id;
  if (!rootId) throw new Error(`No hay una carpeta "${ROOT_NAME}" en el Drive de ${ACCOUNT}`);
  console.log(`Respaldo encontrado en el Drive de ${ACCOUNT}${PROBAR ? ' — MODO PRUEBA: no se guarda nada' : ''}`);

  const cache = async (path: string, id: string) => {
    if (!PROBAR) await db.query(`INSERT INTO mto_backup_folders ("path", "folderId") VALUES ($1, $2) ON CONFLICT ("path") DO NOTHING`, [path, id]);
  };
  await cache('', rootId);
  const t0 = Date.now();

  for (const year of (await children(d, rootId)).filter((f) => isFolder(f) && /^\d{4}$/.test(f.name!))) {
    const y = Number(year.name);
    if (y < DESDE || y > HASTA) continue;
    console.log(`\n== ${y}`);
    await cache(year.name!, year.id!);
    for (const month of (await children(d, year.id!)).filter(isFolder)) {
      const pMonth = `${year.name}/${month.name}`;
      await cache(pMonth, month.id!);
      for (const day of (await children(d, month.id!)).filter(isFolder)) {
        const pDay = `${pMonth}/${day.name}`;
        await cache(pDay, day.id!);
        for (const cat of (await children(d, day.id!)).filter(isFolder)) {
          const pCat = `${pDay}/${cat.name}`;
          await cache(pCat, cat.id!);
          // Encriptados tiene un nivel más: PON y SIENA.
          const groups =
            cat.name === 'Encriptados'
              ? (await children(d, cat.id!)).filter(isFolder).map((s) => ({ folder: s, path: `${pCat}/${s.name}`, siena: s.name === 'SIENA' }))
              : [{ folder: cat, path: pCat, siena: false }];
          for (const g of groups) {
            if (g.folder !== cat) await cache(g.path, g.folder.id!);
            for (const mtoFolder of (await children(d, g.folder.id!)).filter(isFolder)) {
              await restoreMto(d, db, mtoFolder, g.folder.id!, cat.name === 'Enviados', g.siena);
              if (stats.mto % 100 === 0) {
                const rate = (stats.mto / ((Date.now() - t0) / 1000)).toFixed(1);
                process.stdout.write(`\r${pDay}  MTO: ${stats.mto} (nuevos ${stats.nuevos}, ya estaban ${stats.yaEstaban})  archivos: ${stats.archivos}  errores: ${stats.errores}  ${rate}/s   `);
              }
            }
          }
        }
      }
    }
  }

  console.log(`\n\nListo en ${Math.round((Date.now() - t0) / 60000)} min: ${stats.mto} MTO (${stats.nuevos} restaurados, ${stats.yaEstaban} ya estaban), ${stats.archivos} desencriptados/SIENA, ${stats.errores} errores.`);
  if (errores.length) console.log(`\nErrores:\n  ${errores.slice(0, 200).join('\n  ')}`);
  await db.end();
}

async function restoreMto(d: drive_v3.Drive, db: any, folder: drive_v3.Schema$File, parentId: string, isSent: boolean, siena: boolean) {
  stats.mto++;
  try {
    const files = (await children(d, folder.id!)).filter((f) => !isFolder(f));
    const msg = files.find((f) => f.name?.toLowerCase().endsWith('.msg'));
    if (!msg) throw new Error('la carpeta no tiene .msg');
    if (PROBAR) return;

    const payload = parseMsg(await download(d, msg.id!), isSent);
    const res = await ingest(payload);
    if (res.skipped) stats.yaEstaban++;
    else stats.nuevos++;
    const { rows } = await db.query(`SELECT id::text AS id FROM emails WHERE "internetMessageId" = $1`, [payload.internetMessageId]);
    const emailId: string | undefined = res.id ?? rows[0]?.id;
    if (!emailId) throw new Error('no quedó en la base');

    const folderName = folder.name!;
    await db.query(
      `INSERT INTO mto_backups ("emailId", "folderId", "parentId", "baseName", "folderName", "msgFileId")
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ("emailId") DO NOTHING`,
      [emailId, folder.id, parentId, folderName.replace(/ \(\d+\)$/, ''), folderName, msg.id],
    );

    // Los demás archivos de la carpeta: desencriptados o SIENA.
    const extras = files.filter((f) => f !== msg);
    if (!extras.length) return;
    const atts: { id: string; filename: string }[] = (
      await db.query(`SELECT id::text AS id, filename, "encryptedInside" FROM attachments WHERE "emailId"::text = $1`, [emailId])
    ).rows.filter((a: { filename: string; encryptedInside: boolean }) => ENCRYPTED.test(a.filename) || a.encryptedInside);
    for (const f of extras) {
      const { rows: done } = await db.query(`SELECT 1 FROM mto_backup_files WHERE "fileId" = $1`, [f.id]);
      if (done.length) continue;
      const kind = siena || !atts.length ? 'siena' : 'decrypted';
      const dir = kind === 'siena' ? SIENA_DIR : DECRYPTED_DIR;
      mkdirSync(dir, { recursive: true });
      const storagePath = join(dir, `${randomUUID()}_${f.name!.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
      const stream = await withRetry(() => d.files.get({ fileId: f.id!, alt: 'media' }, { responseType: 'stream' }));
      await pipeline(stream.data as NodeJS.ReadableStream, createWriteStream(storagePath));
      const size = Number(f.size ?? 0);
      let sourceId: string;
      if (kind === 'siena') {
        ({ rows: [{ id: sourceId }] } = await db.query(
          `INSERT INTO siena_files ("emailId", filename, "contentType", size, "storagePath", "uploadedById", "uploadedByName")
           VALUES ($1, $2, 'application/octet-stream', $3, $4, 'restauracion', 'Restaurado del respaldo') RETURNING id::text AS id`,
          [emailId, f.name, size, storagePath],
        ));
      } else {
        // Al encriptado del mismo nombre (LUNA25_1.PDF → LUNA25_1._00); si no, al primero.
        const base = (n: string) => n.replace(/\.[^.]*$/, '').trim().toUpperCase();
        const target = atts.find((a) => base(a.filename) === base(f.name!)) ?? atts[0];
        ({ rows: [{ id: sourceId }] } = await db.query(
          `INSERT INTO decrypted_attachments ("attachmentId", "emailId", filename, "contentType", size, "storagePath", "uploadedById", "uploadedByName")
           VALUES ($1, $2, $3, 'application/octet-stream', $4, $5, 'restauracion', 'Restaurado del respaldo') RETURNING id::text AS id`,
          [target.id, emailId, f.name, size, storagePath],
        ));
      }
      await db.query(
        `INSERT INTO mto_backup_files ("sourceId", "kind", "emailId", "fileId") VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [sourceId, kind, emailId, f.id],
      );
      stats.archivos++;
    }
  } catch (err) {
    stats.errores++;
    errores.push(`${folder.name}: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error(`\nLa restauración se cortó: ${(err as Error).message}`);
  process.exit(1);
});
