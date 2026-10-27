// Diagnóstico de un PST: corre dentro del backend y no toca la base.
// docker compose … exec -T backend node - <archivo.pst> < scripts/diag-pst.js
// Dice si el archivo se puede abrir, qué carpetas tiene y cuánto tarda en leer
// los primeros mensajes. Si se queda quieto, la última línea dice dónde.
const fs = require('fs');
const path = require('path');
const { PSTFile, PSTMessage } = require('pst-extractor');

const nombre = process.argv[2];
if (!nombre) { console.log('Falta el nombre del archivo'); process.exit(1); }
const archivo = nombre.includes('/') ? nombre : path.join(process.env.MAIL_PST_UPLOAD_PATH || '/app/storage/pst', nombre);
const t0 = Date.now();
const seg = () => `[${((Date.now() - t0) / 1000).toFixed(1)} s]`;

const st = fs.statSync(archivo);
const cab = Buffer.alloc(16);
const fd = fs.openSync(archivo, 'r');
fs.readSync(fd, cab, 0, 16, 0);
fs.closeSync(fd);
console.log(`${archivo}: ${(st.size / 1024 ** 3).toFixed(2)} GB, modificado ${st.mtime.toISOString()}`);
console.log(`Firma: ${cab.subarray(0, 4).toString('latin1')} (tiene que ser !BDN)`);
if (cab.subarray(0, 4).toString('latin1') !== '!BDN') { console.log('NO ES UN PST VÁLIDO (o la subida lo dañó)'); process.exit(1); }

console.log(`${seg()} Abriendo…`);
const pst = new PSTFile(archivo);
const tipos = { 14: 'ANSI (Outlook 97-2002, máx. 2 GB)', 23: 'Unicode', 36: 'Unicode 2013' };
console.log(`${seg()} Abierto. Tipo ${tipos[pst.pstFileType] || pst.pstFileType}, cifrado ${pst.encryptionType}`);
if (pst.pstFileType === 14 && st.size > 2 * 1024 ** 3) console.log('⚠ Un PST ANSI no puede pasar de 2 GB: el archivo está dañado');

let total = 0;
let mayor = null;
function recorrer(carpeta, nivel) {
  const n = carpeta.contentCount;
  total += n;
  console.log(`${seg()} ${'  '.repeat(nivel)}${carpeta.displayName || '(raíz)'}: ${n} elementos`);
  if (!mayor || n > mayor.contentCount) mayor = carpeta;
  if (carpeta.hasSubfolders) for (const hija of carpeta.getSubFolders()) recorrer(hija, nivel + 1);
}
recorrer(pst.getRootFolder(), 0);
console.log(`${seg()} Total: ${total} elementos`);

if (mayor && mayor.contentCount > 0) {
  console.log(`${seg()} Leyendo los primeros 5 de "${mayor.displayName}"…`);
  for (let i = 0; i < 5; i++) {
    const m = mayor.getNextChild();
    if (!m) { console.log(`${seg()} No hay más (getNextChild devolvió null en el ${i + 1})`); break; }
    if (m instanceof PSTMessage) {
      console.log(`${seg()} ${i + 1}. ${m.messageDeliveryTime?.toISOString?.() ?? '?'} ${(m.subject || '').slice(0, 70)} — ${m.numberOfAttachments} adjuntos`);
    } else {
      console.log(`${seg()} ${i + 1}. (no es un mensaje: ${m.constructor.name})`);
    }
  }
}
console.log(`${seg()} Listo: el archivo se puede leer.`);
