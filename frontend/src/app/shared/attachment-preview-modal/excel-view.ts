/*
 * Visor de planillas con el aspecto de Excel (11/10/2026): cuadrícula con letras
 * de columna y números de fila, anchos y altos del archivo, fuentes, colores de
 * relleno, bordes, alineación, celdas combinadas y las pestañas de las hojas
 * abajo. Lee el .xlsx con exceljs (que sí trae los formatos; la versión gratuita
 * de SheetJS solo da los valores). Todo se arma con elementos y textContent:
 * nunca se interpreta HTML del archivo. El .xls viejo no lo lee exceljs: ese
 * sigue con el visor simple (renderXlsx del modal).
 */

/** Tope de lo que se dibuja: más que esto se ve lento; el resto, descargándolo. */
const MAX_ROWS = 3000;
const MAX_COLS = 150;
const EXCEL_GREEN = '#217346';

/** Colores del tema de Office por defecto (índice de theme de exceljs). */
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
/** Algunos colores "indexados" viejos de Excel. */
const INDEXED: Record<number, string> = {
  8: '000000', 9: 'FFFFFF', 10: 'FF0000', 11: '00FF00', 12: '0000FF', 13: 'FFFF00', 14: 'FF00FF', 15: '00FFFF',
  22: 'C0C0C0', 23: '808080', 64: '000000',
};

interface XColor { argb?: string; theme?: number; tint?: number; indexed?: number }

function applyTint(hex: string, tint = 0): string {
  if (!tint) return hex;
  const n = parseInt(hex, 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const f = (c: number) => Math.round(tint < 0 ? c * (1 + tint) : c + (255 - c) * tint);
  [r, g, b] = [f(r), f(g), f(b)];
  return ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase();
}

function cssColor(c?: XColor): string | null {
  if (!c) return null;
  let hex: string | undefined;
  if (c.argb) hex = c.argb.length === 8 ? c.argb.slice(2) : c.argb;
  else if (c.theme !== undefined) hex = THEME[c.theme];
  else if (c.indexed !== undefined) hex = INDEXED[c.indexed];
  return hex && /^[0-9A-Fa-f]{6}$/.test(hex) ? `#${applyTint(hex, c.tint)}` : null;
}

function columnLetters(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** "B3" → [3, 2] */
function parseAddress(a: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(a.replace(/\$/g, '').toUpperCase());
  if (!m) return [0, 0];
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]), col];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** El texto como lo muestra Excel (fechas dd/mm/aaaa, %, decimales y miles en castellano). */
function displayText(cell: any): string {
  let v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if ('richText' in v) return (v.richText as { text: string }[]).map((t) => t.text).join('');
    else if ('text' in v) return String(v.text);
    else if ('error' in v) return String(v.error);
    else return cell.text ?? '';
  }
  if (v === null || v === undefined) return '';
  const fmt: string = cell.numFmt ?? '';
  if (v instanceof Date) {
    // exceljs da la fecha en UTC (Excel no guarda zona horaria)
    const date = `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    return /h/i.test(fmt) ? `${date} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` : date;
  }
  if (typeof v === 'number') {
    const decimals = (/0\.(0+)/.exec(fmt)?.[1].length) ?? (Number.isInteger(v) ? 0 : undefined);
    if (fmt.includes('%')) {
      return `${(v * 100).toLocaleString('es-AR', { minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 2 })}%`;
    }
    return v.toLocaleString('es-AR', {
      minimumFractionDigits: decimals ?? 0,
      maximumFractionDigits: decimals ?? 10,
      useGrouping: fmt.includes(','),
    });
  }
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  return String(v);
}

const BORDER_WIDTH: Record<string, string> = {
  thin: '1px solid', hair: '1px solid', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed',
  medium: '2px solid', mediumDashed: '2px dashed', thick: '3px solid', double: '3px double',
};

function styleCell(td: HTMLTableCellElement, cell: any): void {
  const s = td.style;
  const font = cell.font ?? {};
  if (font.bold) s.fontWeight = '700';
  if (font.italic) s.fontStyle = 'italic';
  if (font.underline || font.strike) s.textDecoration = `${font.underline ? 'underline' : ''} ${font.strike ? 'line-through' : ''}`.trim();
  if (font.size) s.fontSize = `${Math.round(font.size * 4 / 3)}px`;
  if (font.name) s.fontFamily = `"${String(font.name).replace(/"/g, '')}", Calibri, Arial, sans-serif`;
  const color = cssColor(font.color);
  if (color) s.color = color;

  const fill = cell.fill;
  if (fill?.type === 'pattern' && fill.pattern && fill.pattern !== 'none') {
    const bg = cssColor(fill.fgColor) ?? cssColor(fill.bgColor);
    if (bg) s.backgroundColor = bg;
  }

  const a = cell.alignment ?? {};
  const isNumber = typeof cell.value === 'number' || cell.value instanceof Date || typeof cell.value?.result === 'number';
  s.textAlign = a.horizontal === 'centerContinuous' ? 'center' : (a.horizontal ?? (isNumber ? 'right' : 'left'));
  s.verticalAlign = a.vertical === 'middle' ? 'middle' : a.vertical === 'top' ? 'top' : 'bottom';
  if (a.wrapText) s.whiteSpace = 'pre-wrap';
  if (a.indent) s.paddingLeft = `${4 + a.indent * 9}px`;

  const border = cell.border ?? {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const b = border[side];
    if (!b?.style) continue;
    const w = BORDER_WIDTH[b.style] ?? '1px solid';
    s.setProperty(`border-${side}`, `${w} ${cssColor(b.color) ?? '#000'}`);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

const HEAD = `background:#f3f3f3;color:#444;font:12px Calibri,Arial,sans-serif;text-align:center;border:1px solid #d4d4d4;position:sticky;z-index:1;`;

/** Una hoja como tabla de Excel. */
function renderSheet(ws: any): HTMLElement {
  // Hasta dónde hay algo (valores o celdas combinadas), dentro de los topes.
  let lastRow = 0;
  let lastCol = 0;
  ws.eachRow({ includeEmpty: false }, (row: any, r: number) => {
    row.eachCell({ includeEmpty: false }, (cell: any, c: number) => {
      if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
        lastRow = Math.max(lastRow, r);
        lastCol = Math.max(lastCol, c);
      }
    });
  });
  const merges: string[] = ws.model?.merges ?? [];
  const covered = new Set<string>();
  const spans = new Map<string, [number, number]>();
  for (const m of merges) {
    const [from, to] = m.split(':');
    const [r1, c1] = parseAddress(from);
    const [r2, c2] = parseAddress(to ?? from);
    if (!r1 || !c1) continue;
    spans.set(`${r1}:${c1}`, [r2 - r1 + 1, c2 - c1 + 1]);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
    lastRow = Math.max(lastRow, r2);
    lastCol = Math.max(lastCol, c2);
  }
  const truncatedRows = lastRow > MAX_ROWS;
  const truncatedCols = lastCol > MAX_COLS;
  lastRow = Math.min(Math.max(lastRow, 20), MAX_ROWS);
  lastCol = Math.min(Math.max(lastCol, 8), MAX_COLS);

  const wrap = el('div', 'flex:1;overflow:auto;background:#fff;');
  const table = el('table', 'border-collapse:collapse;table-layout:fixed;font:15px Calibri,Carlito,Arial,sans-serif;color:#000;');
  const colgroup = el('colgroup', '');
  colgroup.appendChild(el('col', 'width:42px;'));
  const visibleCols: number[] = [];
  for (let c = 1; c <= lastCol; c++) {
    const col = ws.getColumn(c);
    if (col.hidden) continue;
    visibleCols.push(c);
    const px = Math.round((col.width ?? 8.43) * 7 + 5);
    colgroup.appendChild(el('col', `width:${px}px;`));
  }
  table.appendChild(colgroup);

  // Encabezado: letras de columna (fijo arriba)
  const thead = el('thead', '');
  const hr = el('tr', '');
  hr.appendChild(el('th', `${HEAD}top:0;left:0;z-index:3;`));
  for (const c of visibleCols) hr.appendChild(el('th', `${HEAD}top:0;height:20px;font-weight:400;`, columnLetters(c)));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody', '');
  const visible = new Set(visibleCols);
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (row.hidden) continue;
    const tr = el('tr', `height:${row.height ? Math.round(row.height * 4 / 3) : 20}px;`);
    tr.appendChild(el('th', `${HEAD}left:0;font-weight:400;`, String(r)));
    for (const c of visibleCols) {
      if (covered.has(`${r}:${c}`)) continue;
      const cell = row.getCell(c);
      const td = el('td', 'border:1px solid #e1e1e1;padding:1px 4px;overflow:hidden;white-space:nowrap;text-overflow:clip;');
      const span = spans.get(`${r}:${c}`);
      if (span) {
        td.rowSpan = span[0];
        // Solo cuentan las columnas visibles dentro de la combinación
        let cols = 0;
        for (let k = c; k < c + span[1]; k++) if (visible.has(k)) cols++;
        td.colSpan = Math.max(cols, 1);
      }
      td.textContent = displayText(cell);
      styleCell(td, cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  if (truncatedRows || truncatedCols) {
    wrap.appendChild(el('p', 'margin:10px 14px;font:12px Calibri,Arial,sans-serif;color:#7a5b00;',
      `Se muestran las primeras ${MAX_ROWS} filas y ${MAX_COLS} columnas. Descargá el archivo para ver todo.`));
  }
  return wrap;
}

/** Dibuja el libro en `container`: la hoja arriba y las pestañas abajo, como en Excel. */
export async function renderExcelWorkbook(buffer: ArrayBuffer, container: HTMLElement): Promise<void> {
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new (ExcelJS as any).Workbook();
  await wb.xlsx.load(buffer);
  const sheets = (wb.worksheets as any[]).filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden');
  if (!sheets.length) throw new Error('La planilla no tiene hojas visibles');

  container.innerHTML = '';
  const root = el('div', 'display:flex;flex-direction:column;height:100%;background:#fff;');
  const area = el('div', 'flex:1;min-height:0;display:flex;');
  const tabs = el('div', `display:flex;gap:2px;align-items:flex-end;padding:0 8px;background:#f3f3f3;border-top:1px solid #d4d4d4;overflow-x:auto;flex-shrink:0;`);
  const rendered = new Map<number, HTMLElement>();

  const show = (i: number) => {
    let view = rendered.get(i);
    if (!view) {
      view = renderSheet(sheets[i]);
      rendered.set(i, view);
    }
    area.replaceChildren(view);
    tabs.querySelectorAll('button').forEach((b, k) => {
      const on = k === i;
      (b as HTMLButtonElement).style.cssText =
        `padding:5px 14px;font:13px Calibri,Arial,sans-serif;border:none;cursor:pointer;white-space:nowrap;` +
        (on ? `background:#fff;color:${EXCEL_GREEN};font-weight:700;border-bottom:3px solid ${EXCEL_GREEN};` : 'background:transparent;color:#444;border-bottom:3px solid transparent;');
    });
  };

  sheets.forEach((ws, i) => {
    const b = el('button', '', String(ws.name));
    b.type = 'button';
    b.addEventListener('click', () => show(i));
    tabs.appendChild(b);
  });

  root.appendChild(area);
  root.appendChild(tabs);
  container.appendChild(root);
  // Abre en la hoja que estaba activa al guardar el archivo, si se sabe.
  const active = Math.max(0, sheets.findIndex((ws) => ws.views?.[0]?.tabSelected));
  show(active);
}
