import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  OnChanges,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { ThemeService } from '../../core/services/theme.service';
import { CometSpinnerComponent } from '../comet-spinner/comet-spinner.component';
import { renderExcelWorkbook } from './excel-view';

export interface AttachmentPreviewRequest {
  url: string;
  filename: string;
  downloadUrl?: string;
  /** Aviso opcional que se muestra arriba del documento. */
  note?: string;
  /**
   * Decidir cómo mostrarlo por el tipo que devuelve el servidor y no por la
   * extensión. Archivos compartidos lo usa: entrega Word/Excel ya convertidos
   * a PDF, texto, video, y Docs de Google sin extensión.
   */
  byContentType?: boolean;
  /**
   * Word/Excel de un MTO: endpoint que copia el adjunto al Drive del usuario y
   * devuelve el visor de Google ({ available, url }). Si no hay cuenta
   * @iugna.edu.ar o falla, se usa el visor propio.
   */
  googlePreviewUrl?: string;
}

/** Si el visor de Google no terminó de cargar en este tiempo, se pasa al propio. */
const GOOGLE_TIMEOUT_MS = 20_000;

type PreviewMode = 'pdf' | 'image' | 'docx' | 'xlsx' | 'text' | 'video' | 'audio' | 'unsupported';

/** Tipo de vista según el Content-Type de la respuesta; null si no alcanza para decidir. */
function modeFromType(type: string): PreviewMode | null {
  const t = type.split(';')[0].trim().toLowerCase();
  if (t === 'application/pdf') return 'pdf';
  if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(t)) return 'image';
  if (t.startsWith('text/')) return 'text';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || t === 'application/msword') return 'docx';
  if (t.includes('spreadsheet') || t === 'application/vnd.ms-excel') return 'xlsx';
  return null;
}

@Component({
  selector: 'app-attachment-preview-modal',
  standalone: true,
  imports: [CommonModule, CometSpinnerComponent],
  template: `
    @if (visible()) {
      <div class="fixed inset-0 z-[9999] flex items-center justify-center" (click)="onBackdropClick($event)">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

        <div class="relative z-10 flex flex-col bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden"
             style="width: calc(100vw - 80px); height: calc(100vh - 80px); max-width: 1600px;"
             (dblclick)="downloadFile()">

          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 flex-shrink-0">
            <div class="flex items-center gap-2 min-w-0">
              <svg class="h-4 w-4 text-teal-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              <span class="text-sm font-medium text-gray-700 dark:text-zinc-300 truncate">{{ currentFilename() }}</span>
            </div>
            <div class="flex items-center gap-1">
              @if (currentDownloadUrl()) {
                <button (click)="$event.stopPropagation(); downloadFile()" title="Descargar archivo original"
                  class="flex items-center justify-center h-8 w-8 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-600 transition-colors text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
              }
              <button (click)="close()" title="Cerrar (Esc)"
                class="flex items-center justify-center h-8 w-8 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-600 transition-colors text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          @if (googleSrc()) {
            <!-- Google no deja mostrar su inicio de sesión dentro de otra página: se abre en una ventanita aparte -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2 text-xs text-gray-600 dark:text-zinc-300 bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700 flex-shrink-0">
              <span>Si Google dice que no puede acceder a tu cuenta:</span>
              <button (click)="$event.stopPropagation(); signInGoogle()"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold text-white bg-teal-600 hover:bg-teal-700">
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>
                </svg>
                Iniciar sesión con {{ googleEmail() || 'tu cuenta @iugna.edu.ar' }}
              </button>
              <button (click)="$event.stopPropagation(); useOwnViewer()"
                class="px-2.5 py-1 rounded-md font-medium border border-gray-300 dark:border-zinc-600 hover:bg-gray-100 dark:hover:bg-zinc-700">
                Usar el visor de la intranet
              </button>
              @if (waitingSignIn()) {
                <span class="text-gray-500">Cuando termines, cerrá esa ventana y el documento se vuelve a cargar.</span>
              }
            </div>
          }

          @if (note()) {
            <div class="flex items-center gap-2 px-5 py-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 flex-shrink-0">
              <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="9" /><path stroke-linecap="round" d="M12 8v4m0 4h.01" />
              </svg>
              <span>{{ note() }}</span>
            </div>
          }

          <!-- Content -->
          <div class="flex-1 overflow-hidden relative bg-gray-100 dark:bg-zinc-950">
            @if (loading()) {
              <!-- Pantalla de carga: el cometa gira alrededor del logo -->
              <div class="absolute inset-0 flex flex-col items-center justify-center gap-6">
                <div class="relative h-44 w-44 flex items-center justify-center">
                  <app-comet-spinner class="absolute inset-0" [size]="176" [thickness]="4" />
                  <img [src]="themeService.isDark() ? 'assets/images/diredtosintranetlogodark.png' : 'assets/images/diredtosintranetlogo.png'"
                       class="h-24 object-contain logo-breathe"
                       alt="INTRANET DIREDTOS" />
                </div>
                <p class="text-sm font-medium text-gray-500 dark:text-zinc-400">Generando vista previa</p>
              </div>
            } @else if (error()) {
              <div class="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <svg class="h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p class="text-sm text-gray-400">Vista previa no disponible para este archivo.</p>
                @if (currentDownloadUrl()) {
                  <button (click)="downloadFile()"
                    class="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors">
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Descargar archivo
                  </button>
                }
              </div>
            } @else if (previewMode() === 'pdf') {
              <iframe [src]="iframeSrc()!" class="w-full h-full border-0"></iframe>
            } @else if (previewMode() === 'image') {
              <div class="absolute inset-0 flex items-center justify-center p-4 overflow-auto">
                <img [src]="imageSrc()!" [alt]="currentFilename()"
                     class="max-w-full max-h-full object-contain rounded shadow-lg" />
              </div>
            } @else if (previewMode() === 'text') {
              <pre class="absolute inset-0 m-0 overflow-auto p-6 bg-white dark:bg-zinc-900 text-sm leading-relaxed text-gray-800 dark:text-zinc-200 whitespace-pre-wrap break-words font-mono">{{ textContent() }}</pre>
            } @else if (previewMode() === 'video') {
              <div class="absolute inset-0 flex items-center justify-center p-4 bg-black">
                <video [src]="mediaSrc()!" controls class="max-w-full max-h-full"></video>
              </div>
            } @else if (previewMode() === 'audio') {
              <div class="absolute inset-0 flex items-center justify-center p-4">
                <audio [src]="mediaSrc()!" controls class="w-full max-w-lg"></audio>
              </div>
            }

            <!-- Container para DOCX/XLSX — siempre en el DOM, oculto durante loading -->
            <div #renderContainer
                 class="absolute inset-0 overflow-auto bg-white"
                 [class.hidden]="loading() || error() || (previewMode() !== 'docx' && previewMode() !== 'xlsx')">
            </div>

            <!-- Visor de Google (Word/Excel de un MTO, cuenta @iugna.edu.ar): carga detrás de la animación -->
            @if (googleSrc(); as src) {
              <iframe [src]="src" (load)="onGoogleLoaded()" title="Vista previa en Google"
                class="absolute inset-0 w-full h-full border-0 bg-white" [class.invisible]="loading()"
                allow="fullscreen"></iframe>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* El logo "respira" apenas mientras gira el cometa. */
    .logo-breathe { animation: breathe 2.4s ease-in-out infinite; }
    @keyframes breathe {
      0%, 100% { transform: scale(0.96); opacity: 0.85; }
      50% { transform: scale(1); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) { .logo-breathe { animation: none; } }
    .hidden { display: none !important; }
  `],
})
export class AttachmentPreviewModalComponent implements OnChanges {
  @Input() request: AttachmentPreviewRequest | null = null;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('renderContainer', { static: false }) renderContainer!: ElementRef<HTMLDivElement>;

  private readonly sanitizer = inject(DomSanitizer);
  private readonly http = inject(HttpClient);
  readonly themeService = inject(ThemeService);

  /**
   * Lo mínimo que se ve la animación, para que no parpadee si el archivo llega
   * al instante. Hasta el 11/10/2026 eran 4 s fijos y todo parecía lento.
   */
  private readonly MIN_LOADING_MS = 250;
  private googleTimer: ReturnType<typeof setTimeout> | null = null;
  readonly googleSrc = signal<SafeResourceUrl | null>(null);
  /** Cuenta @iugna.edu.ar del usuario y el enlace del visor (para recargarlo tras iniciar sesión). */
  readonly googleEmail = signal<string | null>(null);
  private googleUrl: string | null = null;
  readonly waitingSignIn = signal(false);
  private signInPoll: ReturnType<typeof setInterval> | null = null;
  /** Blob abierto en el visor, para liberarlo al cerrar. */
  private blobUrl: string | null = null;

  readonly visible = signal(false);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly iframeSrc = signal<SafeResourceUrl | null>(null);
  readonly imageSrc = signal<SafeUrl | null>(null);
  readonly mediaSrc = signal<SafeUrl | null>(null);
  readonly textContent = signal('');
  readonly previewMode = signal<PreviewMode>('unsupported');
  readonly currentFilename = signal('');
  readonly currentDownloadUrl = signal<string | null>(null);
  readonly note = signal<string | null>(null);

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.visible()) this.close();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['request'] && this.request) {
      this.open(this.request);
    }
  }

  private getExtension(filename: string): string {
    return (filename.split('.').pop() ?? '').toLowerCase();
  }

  private detectMode(filename: string): PreviewMode {
    const ext = this.getExtension(filename);
    if (ext === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
    if (['docx', 'doc'].includes(ext)) return 'docx';
    if (['xlsx', 'xls', 'ods'].includes(ext)) return 'xlsx';
    return 'unsupported';
  }

  private open(req: AttachmentPreviewRequest): void {
    this.releaseBlob();
    this.currentFilename.set(req.filename);
    this.currentDownloadUrl.set(req.downloadUrl ?? req.url.replace('/preview', ''));
    this.note.set(req.note ?? null);
    this.visible.set(true);
    this.loading.set(true);
    this.error.set(false);
    this.iframeSrc.set(null);
    this.imageSrc.set(null);
    this.mediaSrc.set(null);
    this.textContent.set('');

    this.clearGoogle();
    const byExtension = this.detectMode(req.filename);
    this.previewMode.set(byExtension);

    // Sin pedir el tipo al servidor, una extensión desconocida no se puede mostrar.
    if (byExtension === 'unsupported' && !req.byContentType) {
      this.loading.set(false);
      this.error.set(true);
      return;
    }

    // Word/Excel de un MTO con cuenta @iugna.edu.ar: el visor de Google. Si no se puede, el propio.
    if (req.googlePreviewUrl && (byExtension === 'docx' || byExtension === 'xlsx')) {
      this.http.get<{ available: boolean; url?: string; email?: string }>(req.googlePreviewUrl).subscribe({
        next: (g) => {
          if (this.request !== req) return;
          if (g.available && g.url && /^https:\/\/drive\.google\.com\//.test(g.url)) {
            this.googleUrl = g.url;
            this.googleEmail.set(g.email ?? null);
            this.googleSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(g.url));
            this.googleTimer = setTimeout(() => this.useOwnViewer(), GOOGLE_TIMEOUT_MS);
          } else {
            this.loadOwn(req, byExtension);
          }
        },
        error: () => { if (this.request === req) this.loadOwn(req, byExtension); },
      });
      return;
    }
    this.loadOwn(req, byExtension);
  }

  /** El visor de Google terminó de cargar. */
  onGoogleLoaded(): void {
    if (this.googleTimer) clearTimeout(this.googleTimer);
    this.googleTimer = null;
    this.loading.set(false);
  }

  /** "¿No se ve?": el mismo archivo con el visor de la intranet. */
  useOwnViewer(): void {
    const req = this.request;
    if (!req) return;
    this.clearGoogle();
    this.loading.set(true);
    this.error.set(false);
    this.loadOwn(req, this.detectMode(req.filename));
  }

  private clearGoogle(): void {
    if (this.googleTimer) clearTimeout(this.googleTimer);
    this.googleTimer = null;
    if (this.signInPoll) clearInterval(this.signInPoll);
    this.signInPoll = null;
    this.waitingSignIn.set(false);
    this.googleSrc.set(null);
    this.googleEmail.set(null);
    this.googleUrl = null;
  }

  /**
   * Google no deja mostrar su inicio de sesión dentro de otra página: se abre
   * en una ventanita con la cuenta @iugna ya escrita. Al cerrarla, se recarga
   * el visor (con la sesión abierta, Google ya muestra el documento).
   */
  signInGoogle(): void {
    const url = this.googleUrl;
    if (!url) return;
    const email = this.googleEmail();
    const signIn =
      'https://accounts.google.com/ServiceLogin?' +
      new URLSearchParams({ ...(email ? { Email: email } : {}), continue: url.replace('/preview', '/view') }).toString();
    const popup = window.open(signIn, 'intranet-google-login', 'width=520,height=680');
    if (!popup) {
      // Bloqueador de ventanas emergentes: en una pestaña nueva
      window.open(signIn, '_blank', 'noopener');
      return;
    }
    this.waitingSignIn.set(true);
    if (this.signInPoll) clearInterval(this.signInPoll);
    this.signInPoll = setInterval(() => {
      if (!popup.closed) return;
      clearInterval(this.signInPoll!);
      this.signInPoll = null;
      this.waitingSignIn.set(false);
      // Mismo visor con un parámetro distinto: el iframe se vuelve a cargar con la sesión nueva.
      const reload = `${url}${url.includes('?') ? '&' : '?'}r=${Date.now()}`;
      this.loading.set(true);
      this.googleSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(reload));
    }, 700);
  }

  /** El archivo con el visor de la intranet (PDF, imagen, Word, Excel, texto…). */
  private loadOwn(req: AttachmentPreviewRequest, byExtension: PreviewMode): void {
    const startTime = Date.now();

    this.http.get(req.url, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, this.MIN_LOADING_MS - elapsed);
        const mode = req.byContentType ? (modeFromType(blob.type) ?? byExtension) : byExtension;
        this.previewMode.set(mode);

        setTimeout(() => {
          this.renderBlob(blob, mode);
        }, remaining);
      },
      error: () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, this.MIN_LOADING_MS - elapsed);
        setTimeout(() => {
          this.error.set(true);
          this.loading.set(false);
        }, remaining);
      },
    });
  }

  private renderBlob(blob: Blob, mode: PreviewMode): void {
    if (mode === 'pdf') {
      this.iframeSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.toBlobUrl(blob)));
      this.loading.set(false);
      return;
    }

    if (mode === 'image') {
      this.imageSrc.set(this.sanitizer.bypassSecurityTrustUrl(this.toBlobUrl(blob)));
      this.loading.set(false);
      return;
    }

    if (mode === 'video' || mode === 'audio') {
      this.mediaSrc.set(this.sanitizer.bypassSecurityTrustUrl(this.toBlobUrl(blob)));
      this.loading.set(false);
      return;
    }

    if (mode === 'text') {
      // Se muestra como texto (interpolado): nunca se interpreta como HTML.
      void blob.text().then((text) => {
        this.textContent.set(text);
        this.loading.set(false);
      });
      return;
    }

    if (mode === 'docx') {
      this.renderDocx(blob);
      return;
    }

    if (mode === 'xlsx') {
      this.renderXlsx(blob);
      return;
    }

    this.error.set(true);
    this.loading.set(false);
  }

  private toBlobUrl(blob: Blob): string {
    this.releaseBlob();
    this.blobUrl = URL.createObjectURL(blob);
    return this.blobUrl;
  }

  private releaseBlob(): void {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
  }

  private async renderDocx(blob: Blob): Promise<void> {
    try {
      const docxPreview = await import('docx-preview');
      const arrayBuffer = await blob.arrayBuffer();

      const container = this.renderContainer?.nativeElement;
      if (!container) {
        this.error.set(true);
        this.loading.set(false);
        return;
      }
      container.innerHTML = '';

      await docxPreview.renderAsync(arrayBuffer, container, undefined, {
        className: 'docx-preview-wrapper',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        experimental: false,
        trimXmlDeclaration: true,
        useBase64URL: true,
      });

      this.loading.set(false);
    } catch (err) {
      console.error('Error renderizando DOCX:', err);
      this.error.set(true);
      this.loading.set(false);
    }
  }

  private async renderXlsx(blob: Blob): Promise<void> {
    const arrayBuffer = await blob.arrayBuffer();
    // .xlsx: con el aspecto de Excel (formatos, anchos, combinadas, pestañas). El .xls
    // viejo (o si exceljs no lo puede leer) sigue con el visor simple de abajo.
    const container = this.renderContainer?.nativeElement;
    if (container && this.getExtension(this.currentFilename()) !== 'xls') {
      try {
        await renderExcelWorkbook(arrayBuffer, container);
        this.loading.set(false);
        return;
      } catch (err) {
        console.warn('Visor tipo Excel: se usa el simple', err);
      }
    }
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      const container = this.renderContainer?.nativeElement;
      if (!container) {
        this.error.set(true);
        this.loading.set(false);
        return;
      }
      container.innerHTML = '';

      // Hoja blanca con texto oscuro también en modo oscuro (las filas pares son casi blancas).
      // background-color, no "background:": las reglas del modo oscuro buscan "background: #ffffff".
      let html = '<div style="padding: 16px; font-family: Calibri, Arial, sans-serif; font-size: 13px; background-color:#ffffff; color:#111827; min-height:100%;">';

      if (workbook.SheetNames.length > 1) {
        html += '<div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">';
        workbook.SheetNames.forEach((name, i) => {
          html += `<button onclick="document.querySelectorAll('.xlsx-sheet').forEach(s=>s.style.display='none');document.getElementById('sheet-${i}').style.display='block';this.parentElement.querySelectorAll('button').forEach(b=>{b.style.background='#f3f4f6';b.style.fontWeight='normal';b.style.color='#374151'});this.style.background='#0d9488';this.style.color='white';this.style.fontWeight='bold'"
            style="padding:6px 14px; border-radius:6px; border:1px solid #e5e7eb; cursor:pointer; font-size:12px; ${i === 0 ? 'background:#0d9488;color:white;font-weight:bold' : 'background:#f3f4f6;color:#374151'}">${name}</button>`;
        });
        html += '</div>';
      }

      workbook.SheetNames.forEach((name, i) => {
        const sheet = workbook.Sheets[name];
        const tableHtml = XLSX.utils.sheet_to_html(sheet, { editable: false });
        html += `<div id="sheet-${i}" class="xlsx-sheet" style="${i > 0 ? 'display:none' : ''}">`;
        html += tableHtml;
        html += '</div>';
      });

      html += '</div>';

      const style = document.createElement('style');
      style.textContent = `
        table { border-collapse: collapse; width: auto; min-width: 100%; }
        td, th { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; white-space: nowrap; min-width: 60px; }
        th { background: #f9fafb; font-weight: 600; position: sticky; top: 0; }
        tr:nth-child(even) { background: #f9fafb; }
        tr:hover { background: #ecfdf5; }
      `;

      container.appendChild(style);
      container.insertAdjacentHTML('beforeend', html);

      this.loading.set(false);
    } catch (err) {
      console.error('Error renderizando XLSX:', err);
      this.error.set(true);
      this.loading.set(false);
    }
  }

  downloadFile(): void {
    const url = this.currentDownloadUrl();
    if (!url) return;
    this.http.get(url, { responseType: 'blob' }).subscribe((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = this.currentFilename();
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    });
  }

  close(): void {
    this.visible.set(false);
    this.clearGoogle();
    this.iframeSrc.set(null);
    this.imageSrc.set(null);
    this.mediaSrc.set(null);
    this.textContent.set('');
    this.previewMode.set('unsupported');
    this.loading.set(false);
    this.error.set(false);
    this.currentDownloadUrl.set(null);
    this.note.set(null);
    this.releaseBlob();
    if (this.renderContainer?.nativeElement) {
      this.renderContainer.nativeElement.innerHTML = '';
    }
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }
}
