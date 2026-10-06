import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface FileLike {
  name: string;
  mimeType?: string;
  isFolder?: boolean;
}

interface Badge {
  label: string;
  color: string;
}

const WORD = '#2B579A';
const EXCEL = '#1D6F42';
const POWERPOINT = '#C43E1C';
const PDF = '#E5252A';
const IMAGE = '#7C3AED';
const ARCHIVE = '#B45309';
const VIDEO = '#DB2777';
const AUDIO = '#0D9488';
const NEUTRAL = '#6B7280';

const BY_EXTENSION: Record<string, Badge> = {
  pdf: { label: 'PDF', color: PDF },
  doc: { label: 'WORD', color: WORD }, docx: { label: 'WORD', color: WORD },
  odt: { label: 'ODT', color: WORD }, rtf: { label: 'RTF', color: WORD },
  xls: { label: 'EXCEL', color: EXCEL }, xlsx: { label: 'EXCEL', color: EXCEL },
  ods: { label: 'ODS', color: EXCEL }, csv: { label: 'CSV', color: EXCEL },
  ppt: { label: 'PPT', color: POWERPOINT }, pptx: { label: 'PPT', color: POWERPOINT },
  odp: { label: 'ODP', color: POWERPOINT },
  png: { label: 'PNG', color: IMAGE }, jpg: { label: 'JPG', color: IMAGE }, jpeg: { label: 'JPG', color: IMAGE },
  gif: { label: 'GIF', color: IMAGE }, webp: { label: 'WEBP', color: IMAGE }, bmp: { label: 'BMP', color: IMAGE },
  svg: { label: 'SVG', color: IMAGE }, heic: { label: 'HEIC', color: IMAGE }, tif: { label: 'TIFF', color: IMAGE },
  tiff: { label: 'TIFF', color: IMAGE },
  zip: { label: 'ZIP', color: ARCHIVE }, rar: { label: 'RAR', color: ARCHIVE }, '7z': { label: '7Z', color: ARCHIVE },
  msg: { label: 'MSG', color: '#0F6CBD' }, eml: { label: 'EML', color: '#0F6CBD' },
  tar: { label: 'TAR', color: ARCHIVE }, gz: { label: 'GZ', color: ARCHIVE },
  mp4: { label: 'MP4', color: VIDEO }, avi: { label: 'AVI', color: VIDEO }, mov: { label: 'MOV', color: VIDEO },
  mkv: { label: 'MKV', color: VIDEO }, webm: { label: 'WEBM', color: VIDEO },
  mp3: { label: 'MP3', color: AUDIO }, wav: { label: 'WAV', color: AUDIO }, ogg: { label: 'OGG', color: AUDIO },
  m4a: { label: 'M4A', color: AUDIO },
  txt: { label: 'TXT', color: NEUTRAL },
};

/** Archivos nativos de Google (no tienen extensión). */
const BY_GOOGLE_TYPE: Record<string, Badge> = {
  'application/vnd.google-apps.document': { label: 'DOCS', color: '#4285F4' },
  'application/vnd.google-apps.spreadsheet': { label: 'HOJAS', color: '#0F9D58' },
  'application/vnd.google-apps.presentation': { label: 'PRES', color: '#F4B400' },
  'application/vnd.google-apps.form': { label: 'FORM', color: '#7248B9' },
  'application/vnd.google-apps.drawing': { label: 'DIBUJO', color: '#E8453C' },
};

function badgeFor(f: FileLike): Badge | null {
  const mimeType = f.mimeType ?? '';
  const google = BY_GOOGLE_TYPE[mimeType];
  if (google) return google;
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
  if (BY_EXTENSION[ext]) return BY_EXTENSION[ext];
  if (mimeType.startsWith('image/')) return { label: 'IMG', color: IMAGE };
  // Extensión desconocida pero corta: se muestra igual, en gris.
  return /^[a-z0-9]{1,4}$/.test(ext) ? { label: ext.toUpperCase(), color: NEUTRAL } : null;
}

/**
 * Ícono de archivo: una hoja con la esquina doblada y una etiqueta de color
 * con el tipo (WORD, EXCEL, PDF, RAR, PNG…); las carpetas, una carpeta.
 */
@Component({
  selector: 'app-file-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block flex-shrink-0' },
  template: `
    @if (file().isFolder) {
      <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M4 10a3 3 0 013-3h8.2a2 2 0 011.4.6L19 10h14a3 3 0 013 3v17a3 3 0 01-3 3H7a3 3 0 01-3-3z" fill="#E0A100" />
        <path d="M4 15a3 3 0 013-3h26a3 3 0 013 3v15a3 3 0 01-3 3H7a3 3 0 01-3-3z" fill="#FBBF24" />
        <path d="M4 15a3 3 0 013-3h26a3 3 0 013 3v1H4z" fill="#FCD34D" opacity=".6" />
      </svg>
    } @else {
      <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M10 3.5h14.5L32 11v24a2.5 2.5 0 01-2.5 2.5h-19.5A2.5 2.5 0 017.5 35V6A2.5 2.5 0 0110 3.5z"
              class="fill-gray-50 stroke-gray-400 dark:fill-zinc-700 dark:stroke-zinc-500" stroke-width="1.6" stroke-linejoin="round" />
        <path d="M24.5 3.5V9a2 2 0 002 2H32"
              class="fill-gray-200 stroke-gray-400 dark:fill-zinc-600 dark:stroke-zinc-500" stroke-width="1.6" stroke-linejoin="round" />
        @if (padlock() === 'closed') {
          <!-- Encriptado (MTO .~00): candado en lugar de etiqueta -->
          <path d="M15.6 21.5v-3.2a4.4 4.4 0 018.8 0v3.2" fill="none" stroke="#334155" stroke-width="2.2" stroke-linecap="round" />
          <rect x="12.4" y="20.6" width="15.2" height="12" rx="2.4" fill="#334155" />
          <circle cx="20" cy="25.6" r="1.7" fill="#fff" />
          <rect x="19.3" y="26.2" width="1.4" height="3.4" rx=".7" fill="#fff" />
        } @else if (badge(); as b) {
          <rect x="2" y="19.5" [attr.width]="labelWidth()" height="12" rx="2.5" [attr.fill]="b.color" />
          <text [attr.x]="2 + labelWidth() / 2" y="27.9" text-anchor="middle" fill="#fff"
                [attr.font-size]="fontSize()" font-weight="700" letter-spacing=".2"
                font-family="ui-sans-serif, system-ui, sans-serif">{{ b.label }}</text>
        } @else {
          <path d="M13 19h14M13 23.5h14M13 28h9" class="stroke-gray-300 dark:stroke-zinc-500" stroke-width="1.6" stroke-linecap="round" />
        }
        @if (padlock() === 'open') {
          <!-- Desencriptado (PON / SIENA, subido por TICOM): su tipo, y un candado abierto verde en la esquina -->
          <circle cx="31" cy="9" r="8" fill="#059669" stroke="#fff" stroke-width="1.5" />
          <path d="M28.6 8.6V6.6a2.3 2.3 0 014.5-.7" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" />
          <rect x="27.4" y="8.6" width="7.2" height="5.4" rx="1.1" fill="#fff" />
        } @else if (padlock() === 'siena') {
          <!-- Desencriptado con SIENA (subido por TICOM): su tipo, y "SIENA" en celeste en la esquina -->
          <rect x="16.5" y="1.2" width="22.5" height="10" rx="3" fill="#0EA5E9" stroke="#fff" stroke-width="1.2" />
          <text x="27.75" y="8.6" text-anchor="middle" fill="#fff" font-size="6.2" font-weight="700" letter-spacing=".2"
                font-family="ui-sans-serif, system-ui, sans-serif">SIENA</text>
        }
      </svg>
    }
  `,
})
export class FileIconComponent {
  readonly file = input.required<FileLike>();
  readonly size = input(44);

  readonly badge = computed(() => badgeFor(this.file()));
  /**
   * 'open': desencriptado de PON (su tipo + candado abierto verde en la esquina);
   * 'siena': desencriptado con SIENA (su tipo + "SIENA" celeste); sin indicar, se deduce del nombre.
   */
  readonly lock = input<'open' | 'closed' | 'siena' | null>(null);
  /** Adjuntos encriptados de MTO: .~00 (y extensiones solo numéricas, .001). */
  readonly encrypted = computed(() => /\.~?\d+$/.test(this.file().name));
  readonly padlock = computed(() => this.lock() ?? (this.encrypted() ? 'closed' : null));
  /** Las etiquetas largas (EXCEL, HOJAS) se ensanchan para no achicar tanto la letra. */
  readonly labelWidth = computed(() => ((this.badge()?.label.length ?? 0) >= 5 ? 32 : 26));
  readonly fontSize = computed(() => {
    const n = this.badge()?.label.length ?? 0;
    return n <= 3 ? 7.6 : n === 4 ? 6.8 : n === 5 ? 6 : 5.2;
  });
}
