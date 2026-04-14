#!/usr/bin/env node
/**
 * import-msg.js — Importa archivos .msg recursivamente a la base de datos
 *
 * Uso:
 *   node import-msg.js <directorio> [--dry-run]
 *
 * Variables de entorno requeridas:
 *   BRIDGE_SECRET   — mismo valor que MAIL_BRIDGE_SECRET en el backend
 *   BACKEND_URL     — URL del backend (default: http://localhost:3001)
 *
 * Opciones:
 *   --dry-run       — Parsea los archivos y muestra qué se procesaría, sin insertar en DB
 *
 * Detección de carpeta de enviados:
 *   Si el path del archivo contiene alguna de estas palabras (case-insensitive):
 *   salida, saliente, enviado, sent, outbox, tx
 *   → isSentFolder = true → el email se clasifica como TX
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Validar dependencias ────────────────────────────────────────────────────

let MsgReader;
try {
  const mod = require('@kenjiuno/msgreader');
  MsgReader = mod.default ?? mod.MsgReader ?? mod;
} catch {
  console.error('Error: falta @kenjiuno/msgreader');
  console.error('Ejecutá: cd scripts && npm install');
  process.exit(1);
}

// ─── Config desde env / args ─────────────────────────────────────────────────

const BACKEND_URL  = process.env.BACKEND_URL  || 'http://localhost:3001';
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;
const DRY_RUN      = process.argv.includes('--dry-run');

if (!BRIDGE_SECRET) {
  console.error('Error: la variable de entorno BRIDGE_SECRET no está seteada');
  process.exit(1);
}

const MSG_DIR = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!MSG_DIR) {
  console.error('Uso: node import-msg.js <directorio> [--dry-run]');
  process.exit(1);
}

if (!fs.existsSync(MSG_DIR)) {
  console.error(`Error: el directorio "${MSG_DIR}" no existe`);
  process.exit(1);
}

// ─── Detección de carpeta de enviados ────────────────────────────────────────

const SENT_KEYWORDS = ['salida', 'saliente', 'enviado', 'sent', 'outbox', '/tx/'];

function isSentPath(filePath) {
  const lower = filePath.toLowerCase().replace(/\\/g, '/');
  return SENT_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Búsqueda recursiva de archivos .msg ─────────────────────────────────────

function findMsgFiles(dir) {
  const results = [];

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      console.error(`\nNo se puede leer: ${currentDir} — ${e.message}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.msg')) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

// ─── Parseo de archivo .msg ───────────────────────────────────────────────────

function generateFallbackId(subject, fromAddress, dateIso) {
  const hash = crypto
    .createHash('sha256')
    .update(`${subject}|${fromAddress}|${dateIso}`)
    .digest('hex')
    .slice(0, 32);
  return `<generated-${hash}@msg-import.local>`;
}

function parseRecipients(recipients) {
  const toAddresses = [];
  const ccAddresses = [];

  if (!Array.isArray(recipients)) return { toAddresses, ccAddresses };

  for (const r of recipients) {
    const email = (r.smtpAddress || r.email || r.emailAddress || '').trim();
    if (!email || !email.includes('@')) continue;
    // MAPI recipientType: 1 = To, 2 = CC, 3 = BCC
    if (r.recipientType === 2) {
      ccAddresses.push(email);
    } else {
      toAddresses.push(email);
    }
  }

  return { toAddresses, ccAddresses };
}

function parseMsg(filePath) {
  const nodeBuf = fs.readFileSync(filePath);
  // msgreader v1.x espera ArrayBuffer
  const arrayBuffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
  const reader = new MsgReader(arrayBuffer);
  const data   = reader.getFileData();

  // ─ Fecha ─
  let date = null;
  for (const field of ['sentOn', 'creationTime', 'lastModificationTime', 'deliveryTime']) {
    if (data[field]) {
      const d = new Date(data[field]);
      if (!isNaN(d.getTime())) { date = d; break; }
    }
  }
  if (!date) date = new Date(0); // fallback al epoch si no hay fecha

  const dateIso = date.toISOString();

  // ─ Remitente ─
  const fromAddress = (
    data.senderEmail ||
    data.senderSmtpAddress ||
    data.sender ||
    ''
  ).trim();

  // ─ Destinatarios ─
  const { toAddresses, ccAddresses } = parseRecipients(data.recipients);

  // ─ Message-ID ─
  let internetMessageId = (
    data.internetMessageId ||
    data.messageId ||
    ''
  ).trim();

  if (!internetMessageId) {
    internetMessageId = generateFallbackId(data.subject || '', fromAddress, dateIso);
  }

  // ─ Cuerpo ─
  const bodyText = (data.body || '').trim();
  const bodyHtml = data.bodyHtml || data.bodyHTML || null;

  // ─ Adjuntos ─
  const attachments = [];
  if (Array.isArray(data.attachments)) {
    for (let i = 0; i < data.attachments.length; i++) {
      const att = data.attachments[i];
      try {
        // v1.x: getAttachment() devuelve { fileName, content: Uint8Array, ... }
        const attData = reader.getAttachment(att);
        const content = attData?.content ?? att.content;
        if (!content || content.length === 0) continue;

        const filename    = (att.fileName || att.name || attData?.fileName || `attachment_${i + 1}`).trim();
        const contentType = att.mimeTag || att.mimeType || att.mime || 'application/octet-stream';

        attachments.push({
          filename,
          contentType,
          base64: Buffer.from(content).toString('base64'),
        });
      } catch {
        // adjunto corrupto — ignorar
      }
    }
  }

  return {
    internetMessageId,
    subject:      (data.subject || '(sin asunto)').trim(),
    fromAddress:  fromAddress || 'desconocido@msg-import.local',
    toAddresses:  toAddresses.length ? toAddresses : ['sin-destinatario@msg-import.local'],
    ccAddresses,
    bodyText:     bodyText || '(sin cuerpo)',
    bodyHtml,
    date:         dateIso,
    isSentFolder: isSentPath(filePath),
    attachments,
  };
}

// ─── Envío al backend ─────────────────────────────────────────────────────────

async function ingest(emailData) {
  const res = await fetch(`${BACKEND_URL}/api/mail/bridge/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BRIDGE_SECRET}`,
    },
    body: JSON.stringify(emailData),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nDirectorio : ${path.resolve(MSG_DIR)}`);
  console.log(`Backend    : ${BACKEND_URL}`);
  if (DRY_RUN) console.log('MODO       : DRY RUN — no se insertará nada\n');
  else         console.log('');

  process.stdout.write('Buscando archivos .msg...');
  const files = findMsgFiles(MSG_DIR);
  console.log(` ${files.length} encontrados\n`);

  if (files.length === 0) {
    console.log('Nada que procesar.');
    return;
  }

  let processed = 0;
  let inserted  = 0;
  let skipped   = 0;
  let errors    = 0;
  const errorLog = [];
  const startMs  = Date.now();

  for (const filePath of files) {
    processed++;
    const relPath = path.relative(MSG_DIR, filePath);

    let emailData;
    try {
      emailData = parseMsg(filePath);
    } catch (e) {
      errors++;
      errorLog.push(`PARSE  ${relPath}: ${e.message}`);
      continue;
    }

    if (DRY_RUN) {
      const sent = emailData.isSentFolder ? 'ENVIADO' : 'RECIBIDO';
      console.log(`[${String(processed).padStart(6)}] ${sent.padEnd(8)} ${emailData.subject.slice(0, 60)}`);
      inserted++;
    } else {
      try {
        const result = await ingest(emailData);
        if (result?.skipped) skipped++;
        else                  inserted++;
      } catch (e) {
        errors++;
        errorLog.push(`INGEST ${relPath}: ${e.message}`);
      }
    }

    // Progreso cada 50 archivos (o al final)
    if (!DRY_RUN && (processed % 50 === 0 || processed === files.length)) {
      const elapsedSec = (Date.now() - startMs) / 1000;
      const rate = (processed / elapsedSec).toFixed(1);
      process.stdout.write(
        `\r[${processed}/${files.length}]  Insertados: ${inserted}  Duplicados: ${skipped}  Errores: ${errors}  ${rate} emails/s   `
      );
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(`\n\n${'─'.repeat(50)}`);
  console.log(`Finalizado en ${elapsed}s`);
  console.log(`  Total procesados : ${processed}`);
  console.log(`  Insertados       : ${inserted}`);
  console.log(`  Duplicados omit. : ${skipped}`);
  console.log(`  Errores          : ${errors}`);

  if (errorLog.length) {
    console.log(`\nDetalle de errores:`);
    errorLog.forEach(e => console.log(`  ${e}`));
  }
}

main().catch(e => {
  console.error('\nError fatal:', e.message);
  process.exit(1);
});
