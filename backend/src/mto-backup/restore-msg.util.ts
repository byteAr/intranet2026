/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { createHash } from 'crypto';

const MsgReader = require('@kenjiuno/msgreader').default;

/** El .msg del respaldo, en el formato que recibe /bridge/ingest. */
export function parseMsg(buf: Buffer, isSent: boolean) {
  const reader = new MsgReader(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const m = reader.getFileData();
  const date = new Date(m.clientSubmitTime || m.messageDeliveryTime || m.creationTime || 0);
  const from = (m.senderSmtpAddress || m.senderEmail || '').trim() || 'desconocido@restauracion.local';
  const to: string[] = [];
  const cc: string[] = [];
  for (const r of m.recipients ?? []) {
    const email = (r.smtpAddress || r.email || '').trim();
    if (!email) continue;
    (r.recipType === 'cc' ? cc : to).push(email);
  }
  const subject = (m.subject || '(sin asunto)').trim() || '(sin asunto)';
  const messageId =
    (m.messageId || '').trim() ||
    `<restaurado-${createHash('sha256').update(`${subject}|${from}|${date.toISOString()}`).digest('hex').slice(0, 32)}@restauracion.local>`;
  const html = m.html ? Buffer.from(m.html).toString(m.internetCodepage === 65001 || !m.internetCodepage ? 'utf8' : 'latin1') : undefined;
  const attachments = (m.attachments ?? [])
    .map((a: any) => {
      const got = reader.getAttachment(a);
      if (!got?.content?.length) return null;
      return {
        filename: (a.fileName || a.name || 'adjunto').trim(),
        contentType: a.attachMimeTag || 'application/octet-stream',
        base64: Buffer.from(got.content).toString('base64'),
      };
    })
    .filter(Boolean);
  return {
    internetMessageId: messageId,
    subject,
    fromAddress: from,
    toAddresses: to,
    ccAddresses: cc,
    bodyText: (m.body || '').trim() || '(sin cuerpo)',
    bodyHtml: html,
    date: date.toISOString(),
    isSentFolder: isSent,
    restore: true,
    attachments,
  };
}

