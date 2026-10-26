import * as CFB from 'cfb';

/**
 * Arma un .msg de Outlook (MS-OXMSG: un archivo compuesto CFB con las
 * propiedades MAPI en streams) a partir de un MTO guardado. Lo usa TICOM para
 * reenviar un MTO como adjunto a unidades que todavía usan Outlook, que solo
 * abren el reenvío si viene como .msg (26/10/2026).
 *
 * Se arma con lo que guarda la intranet (no hay copia del correo original):
 * asunto, remitente, Para/CC, fecha, cuerpo en texto y HTML, Message-ID y los
 * adjuntos originales (los .~00 tal cual llegaron; nunca los desencriptados).
 */

export interface MsgInput {
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: Date;
  bodyText: string;
  bodyHtml?: string | null;
  messageId?: string | null;
  attachments: { filename: string; contentType: string; data: Buffer }[];
}

// Tipos de propiedad MAPI
const PT_LONG = 0x0003;
const PT_BOOLEAN = 0x000b;
const PT_SYSTIME = 0x0040;
const PT_UNICODE = 0x001f;
const PT_BINARY = 0x0102;

/** Identificador de clase de un .msg (IPM.Note en un archivo compuesto). */
const MSG_CLSID = '0b0d020000000000c000000000000046';

type Prop =
  | { id: number; type: typeof PT_LONG; value: number }
  | { id: number; type: typeof PT_BOOLEAN; value: boolean }
  | { id: number; type: typeof PT_SYSTIME; value: Date }
  | { id: number; type: typeof PT_UNICODE; value: string }
  | { id: number; type: typeof PT_BINARY; value: Buffer };

const hex8 = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

function filetime(date: Date): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE((BigInt(date.getTime()) + 11644473600000n) * 10000n);
  return b;
}

/**
 * Escribe en `dir` el stream __properties_version1.0 (con `header` delante) y
 * un __substg1.0_ por cada propiedad de largo variable.
 */
function writeProps(cfb: CFB.CFB$Container, dir: string, header: Buffer, props: Prop[]): void {
  const entries: Buffer[] = [header];
  for (const p of props) {
    const tag = ((p.id << 16) | p.type) >>> 0;
    const e = Buffer.alloc(16);
    e.writeUInt32LE(tag, 0);
    e.writeUInt32LE(0x00000006, 4); // legible y escribible
    if (p.type === PT_LONG) {
      e.writeInt32LE(p.value | 0, 8);
    } else if (p.type === PT_BOOLEAN) {
      e.writeUInt16LE(p.value ? 1 : 0, 8);
    } else if (p.type === PT_SYSTIME) {
      filetime(p.value).copy(e, 8);
    } else {
      // Largo variable: el valor va en su propio stream; acá, el tamaño.
      const data = p.type === PT_UNICODE ? Buffer.from(p.value, 'utf16le') : p.value;
      // En PT_UNICODE el tamaño incluye el terminador (2 bytes) que el stream no lleva.
      e.writeUInt32LE(data.length + (p.type === PT_UNICODE ? 2 : 0), 8);
      CFB.utils.cfb_add(cfb, `${dir}__substg1.0_${hex8(tag)}`, data);
    }
    entries.push(e);
  }
  CFB.utils.cfb_add(cfb, `${dir}__properties_version1.0`, Buffer.concat(entries));
}

function addressList(list: string[]): string {
  return list.join('; ');
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot) : '';
}

function transportHeaders(m: MsgInput): string {
  const lines = [
    `From: ${m.from}`,
    m.to.length ? `To: ${m.to.join(', ')}` : null,
    m.cc.length ? `Cc: ${m.cc.join(', ')}` : null,
    `Subject: ${m.subject}`,
    `Date: ${m.date.toUTCString()}`,
    m.messageId ? `Message-ID: ${m.messageId}` : null,
    'MIME-Version: 1.0',
  ];
  return lines.filter(Boolean).join('\r\n') + '\r\n';
}

export function buildMsg(m: MsgInput): Buffer {
  const cfb = CFB.utils.cfb_new({ CLSID: MSG_CLSID });
  const root = '/';

  const recipients = [
    ...m.to.map((address) => ({ address, type: 1 })), // MAPI_TO
    ...m.cc.map((address) => ({ address, type: 2 })), // MAPI_CC
  ];

  // Encabezado del mensaje de primer nivel: 8 reservados, próximos ids,
  // cantidades de destinatarios y adjuntos, 8 reservados.
  const header = Buffer.alloc(32);
  header.writeUInt32LE(recipients.length, 8);
  header.writeUInt32LE(m.attachments.length, 12);
  header.writeUInt32LE(recipients.length, 16);
  header.writeUInt32LE(m.attachments.length, 20);

  const props: Prop[] = [
    { id: 0x001a, type: PT_UNICODE, value: 'IPM.Note' }, // PR_MESSAGE_CLASS
    { id: 0x0037, type: PT_UNICODE, value: m.subject }, // PR_SUBJECT
    { id: 0x0e1d, type: PT_UNICODE, value: m.subject }, // PR_NORMALIZED_SUBJECT
    { id: 0x1000, type: PT_UNICODE, value: m.bodyText ?? '' }, // PR_BODY
    { id: 0x0c1a, type: PT_UNICODE, value: m.from }, // PR_SENDER_NAME
    { id: 0x0c1f, type: PT_UNICODE, value: m.from }, // PR_SENDER_EMAIL_ADDRESS
    { id: 0x0c1e, type: PT_UNICODE, value: 'SMTP' }, // PR_SENDER_ADDRTYPE
    { id: 0x5d01, type: PT_UNICODE, value: m.from }, // PR_SENDER_SMTP_ADDRESS
    { id: 0x0042, type: PT_UNICODE, value: m.from }, // PR_SENT_REPRESENTING_NAME
    { id: 0x0065, type: PT_UNICODE, value: m.from }, // PR_SENT_REPRESENTING_EMAIL_ADDRESS
    { id: 0x0064, type: PT_UNICODE, value: 'SMTP' }, // PR_SENT_REPRESENTING_ADDRTYPE
    { id: 0x5d02, type: PT_UNICODE, value: m.from }, // PR_SENT_REPRESENTING_SMTP_ADDRESS
    { id: 0x0e04, type: PT_UNICODE, value: addressList(m.to) }, // PR_DISPLAY_TO
    { id: 0x0e03, type: PT_UNICODE, value: addressList(m.cc) }, // PR_DISPLAY_CC
    { id: 0x0039, type: PT_SYSTIME, value: m.date }, // PR_CLIENT_SUBMIT_TIME
    { id: 0x0e06, type: PT_SYSTIME, value: m.date }, // PR_MESSAGE_DELIVERY_TIME
    { id: 0x0e07, type: PT_LONG, value: 0x1 }, // PR_MESSAGE_FLAGS: leído (no "sin enviar")
    { id: 0x0e1b, type: PT_BOOLEAN, value: m.attachments.length > 0 }, // PR_HASATTACH
    { id: 0x340d, type: PT_LONG, value: 0x00040000 }, // PR_STORE_SUPPORT_MASK: STORE_UNICODE_OK
    { id: 0x3fde, type: PT_LONG, value: 65001 }, // PR_INTERNET_CPID: UTF-8 (para el HTML)
    { id: 0x007d, type: PT_UNICODE, value: transportHeaders(m) }, // PR_TRANSPORT_MESSAGE_HEADERS
  ];
  if (m.messageId) props.push({ id: 0x1035, type: PT_UNICODE, value: m.messageId }); // PR_INTERNET_MESSAGE_ID
  if (m.bodyHtml?.trim()) props.push({ id: 0x1013, type: PT_BINARY, value: Buffer.from(m.bodyHtml, 'utf8') }); // PR_HTML

  writeProps(cfb, root, header, props);

  // Propiedades con nombre: Outlook espera la carpeta aunque esté vacía.
  for (const s of ['00020102', '00030102', '00040102']) {
    CFB.utils.cfb_add(cfb, `/__nameid_version1.0/__substg1.0_${s}`, Buffer.alloc(0));
  }

  recipients.forEach((r, i) => {
    writeProps(cfb, `/__recip_version1.0_#${hex8(i)}/`, Buffer.alloc(8), [
      { id: 0x0c15, type: PT_LONG, value: r.type }, // PR_RECIPIENT_TYPE
      { id: 0x3000, type: PT_LONG, value: i }, // PR_ROWID
      { id: 0x0ffe, type: PT_LONG, value: 6 }, // PR_OBJECT_TYPE: MAPI_MAILUSER
      { id: 0x3900, type: PT_LONG, value: 0 }, // PR_DISPLAY_TYPE: DT_MAILUSER
      { id: 0x3001, type: PT_UNICODE, value: r.address }, // PR_DISPLAY_NAME
      { id: 0x3003, type: PT_UNICODE, value: r.address }, // PR_EMAIL_ADDRESS
      { id: 0x3002, type: PT_UNICODE, value: 'SMTP' }, // PR_ADDRTYPE
      { id: 0x39fe, type: PT_UNICODE, value: r.address }, // PR_SMTP_ADDRESS
    ]);
  });

  m.attachments.forEach((a, i) => {
    writeProps(cfb, `/__attach_version1.0_#${hex8(i)}/`, Buffer.alloc(8), [
      { id: 0x3705, type: PT_LONG, value: 1 }, // PR_ATTACH_METHOD: ATTACH_BY_VALUE
      { id: 0x0e21, type: PT_LONG, value: i }, // PR_ATTACH_NUM
      { id: 0x370b, type: PT_LONG, value: -1 }, // PR_RENDERING_POSITION: no va en el cuerpo
      { id: 0x0ffe, type: PT_LONG, value: 7 }, // PR_OBJECT_TYPE: MAPI_ATTACH
      { id: 0x3001, type: PT_UNICODE, value: a.filename }, // PR_DISPLAY_NAME
      { id: 0x3704, type: PT_UNICODE, value: a.filename }, // PR_ATTACH_FILENAME
      { id: 0x3707, type: PT_UNICODE, value: a.filename }, // PR_ATTACH_LONG_FILENAME
      { id: 0x3703, type: PT_UNICODE, value: extensionOf(a.filename) }, // PR_ATTACH_EXTENSION
      { id: 0x370e, type: PT_UNICODE, value: a.contentType || 'application/octet-stream' }, // PR_ATTACH_MIME_TAG
      { id: 0x0e20, type: PT_LONG, value: a.data.length }, // PR_ATTACH_SIZE
      { id: 0x3701, type: PT_BINARY, value: a.data }, // PR_ATTACH_DATA_BIN
    ]);
  });

  return CFB.write(cfb, { type: 'buffer' }) as Buffer;
}

/** Nombre del archivo: el código del MTO o el asunto, sin caracteres que Windows no acepta. */
export function msgFilename(mailCode: string | null | undefined, subject: string): string {
  const base = (mailCode || subject || 'MTO').replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/\s+/g, ' ').trim();
  return `${base.slice(0, 100) || 'MTO'}.msg`;
}
