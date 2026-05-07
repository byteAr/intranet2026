import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';

export interface AttachmentPreviewRequest {
  url: string;
  filename: string;
}

@Component({
  selector: 'app-attachment-preview-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <!-- Backdrop -->
      <div class="fixed inset-0 z-[9999] flex items-center justify-center" (click)="onBackdropClick($event)">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

        <!-- Modal -->
        <div class="relative z-10 flex flex-col bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden"
             style="width: calc(100vw - 80px); height: calc(100vh - 80px); max-width: 1600px;">

          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 flex-shrink-0">
            <div class="flex items-center gap-2 min-w-0">
              <svg class="h-4 w-4 text-teal-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              <span class="text-sm font-medium text-gray-700 dark:text-zinc-300 truncate">{{ currentFilename() }}</span>
            </div>
            <button (click)="close()"
              class="flex items-center justify-center h-8 w-8 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-600 transition-colors text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
              title="Cerrar">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="flex-1 overflow-hidden relative bg-gray-100 dark:bg-zinc-950">
            @if (loading()) {
              <!-- Branded loading screen -->
              <div class="absolute inset-0 flex flex-col items-center justify-center gap-5">
                <div class="animate-pulse">
                  <img src="assets/images/diredtosintranetlogo.png"
                       class="h-28 object-contain opacity-80"
                       alt="INTRANET DIREDTOS" />
                </div>
                <div class="flex items-center gap-1 text-sm text-gray-500 dark:text-zinc-400 font-medium">
                  <span>Generando previsualización</span>
                  <span class="inline-flex w-6">
                    <span class="animate-dots">...</span>
                  </span>
                </div>
              </div>
            } @else if (error()) {
              <div class="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <svg class="h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p class="text-sm text-gray-400">Vista previa no disponible para este archivo.</p>
              </div>
            } @else if (previewUrl()) {
              <iframe [src]="previewUrl()!" class="w-full h-full border-0"></iframe>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes dots {
      0%, 20% { content: '.'; }
      40% { content: '..'; }
      60%, 100% { content: '...'; }
    }
    .animate-dots {
      display: inline-block;
      overflow: hidden;
      animation: ellipsis 1.4s infinite;
      width: 1.5em;
      text-align: left;
    }
    @keyframes ellipsis {
      0% { width: 0; }
      25% { width: 0.5em; }
      50% { width: 1em; }
      75%, 100% { width: 1.5em; }
    }
  `],
})
export class AttachmentPreviewModalComponent implements OnChanges {
  @Input() request: AttachmentPreviewRequest | null = null;
  @Output() closed = new EventEmitter<void>();

  private readonly sanitizer = inject(DomSanitizer);
  private readonly http = inject(HttpClient);

  private readonly MIN_LOADING_MS = 4000;

  readonly visible = signal(false);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly previewUrl = signal<SafeResourceUrl | null>(null);
  readonly currentFilename = signal('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['request'] && this.request) {
      this.open(this.request);
    }
  }

  private open(req: AttachmentPreviewRequest): void {
    this.currentFilename.set(req.filename);
    this.visible.set(true);
    this.loading.set(true);
    this.error.set(false);
    this.previewUrl.set(null);

    const startTime = Date.now();

    this.http.get(req.url, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl);
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, this.MIN_LOADING_MS - elapsed);

        setTimeout(() => {
          this.previewUrl.set(safeUrl);
          this.loading.set(false);
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

  close(): void {
    this.visible.set(false);
    this.previewUrl.set(null);
    this.loading.set(false);
    this.error.set(false);
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }
}
