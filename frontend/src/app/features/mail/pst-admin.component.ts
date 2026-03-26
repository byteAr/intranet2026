import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { AuthService } from '../../core/services/auth.service';

interface PstFile {
  filename: string;
  size: number;
  modifiedAt: string;
}

interface ImportLog {
  id: string;
  filename: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  totalProcessed: number;
  inserted: number;
  skippedDuplicates: number;
  referencesResolved: number;
  attachmentsSaved: number;
  errorMessage?: string;
  importedBy?: string;
}

interface PstProgress {
  filename: string;
  current: number;
  inserted: number;
  skipped: number;
  elapsedMs: number;
}

interface PstComplete {
  filename: string;
  totalInserted: number;
  totalSkipped: number;
  referencesResolved: number;
  attachmentsSaved: number;
  elapsedMs: number;
}

@Component({
  selector: 'app-pst-admin',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  template: `
    <div class="max-w-4xl space-y-6">

      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold text-gray-800">Panel PST — Importación de correos históricos</h1>
        <span class="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">TICOM</span>
      </div>

      <!-- ── 1. Upload ──────────────────────────────────── -->
      <section class="bg-white rounded-xl border border-gray-200 p-5">
        <h2 class="text-sm font-semibold text-gray-700 mb-3">1. Subir archivo PST</h2>

        <div class="flex items-center gap-3">
          <label class="flex items-center gap-2 px-4 py-2 rounded-md border-2 border-dashed border-gray-300 hover:border-teal-400 cursor-pointer transition-colors text-sm text-gray-500 hover:text-teal-600">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {{ uploadFile ? uploadFile.name : 'Seleccionar archivo .pst' }}
            <input type="file" accept=".pst" class="hidden" (change)="onFileSelected($event)" />
          </label>

          @if (uploadFile) {
            <span class="text-xs text-gray-400">{{ formatSize(uploadFile.size) }}</span>
            <button
              (click)="uploadPst()"
              [disabled]="uploading()"
              class="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 transition-colors"
              style="background:#0f766e">
              {{ uploading() ? 'Subiendo...' : 'Subir' }}
            </button>
          }
        </div>

        @if (uploading()) {
          <div class="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
            <svg class="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p class="text-sm text-amber-700 font-medium">
              No cierre ni recargue esta página mientras se sube el archivo. Si lo hace, la carga se cancelará y deberá empezar de nuevo.
            </p>
          </div>
        }

        @if (uploadProgress() !== null) {
          <div class="mt-3">
            <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div class="h-2 bg-teal-500 rounded-full transition-all duration-300"
                   [style.width.%]="uploadProgress()"></div>
            </div>
            <p class="text-xs text-gray-400 mt-1">{{ uploadProgress() }}%</p>
          </div>
        }

        @if (uploadError()) {
          <p class="mt-2 text-sm text-red-500">{{ uploadError() }}</p>
        }
        @if (uploadSuccess()) {
          <p class="mt-2 text-sm text-teal-600">Archivo subido correctamente.</p>
        }
      </section>

      <!-- ── 2. Archivos disponibles ────────────────────── -->
      <section class="bg-white rounded-xl border border-gray-200 p-5">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-gray-700">2. Archivos en servidor</h2>
          <button (click)="loadFiles()" class="text-xs text-teal-600 hover:text-teal-800">Actualizar</button>
        </div>

        @if (pstFiles().length === 0) {
          <p class="text-sm text-gray-400">Sin archivos PST subidos.</p>
        } @else {
          <div class="space-y-2">
            @for (f of pstFiles(); track f.filename) {
              <div class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 bg-gray-50">
                <svg class="h-5 w-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span class="flex-1 text-sm text-gray-700 truncate">{{ f.filename }}</span>
                <span class="text-xs text-gray-400">{{ formatSize(f.size) }}</span>

                @if (activeImport() === f.filename) {
                  <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 animate-pulse">Importando...</span>
                } @else {
                  <button
                    (click)="startImport(f.filename)"
                    [disabled]="!!activeImport()"
                    class="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-white rounded-md disabled:opacity-40 transition-colors"
                    style="background:#0f766e">
                    Importar
                  </button>
                }
              </div>
            }
          </div>
        }

        @if (importError()) {
          <p class="mt-2 text-sm text-red-500">{{ importError() }}</p>
        }
      </section>

      <!-- ── 2b. Progreso en tiempo real ────────────────── -->
      @if (activeImport()) {
        <section class="bg-white rounded-xl border border-amber-200 p-5">
          <div class="flex items-center gap-2 mb-4">
            <div class="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></div>
            <h2 class="text-sm font-semibold text-gray-700">Importando: <span class="font-mono text-amber-700">{{ activeImport() }}</span></h2>
          </div>

          @if (currentProgress()) {
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
              <div class="bg-gray-50 rounded-lg p-3 text-center">
                <p class="text-2xl font-bold text-gray-800">{{ currentProgress()!.current | number }}</p>
                <p class="text-xs text-gray-400 mt-0.5">Procesados</p>
              </div>
              <div class="bg-teal-50 rounded-lg p-3 text-center">
                <p class="text-2xl font-bold text-teal-700">{{ currentProgress()!.inserted | number }}</p>
                <p class="text-xs text-gray-400 mt-0.5">Insertos</p>
              </div>
              <div class="bg-gray-50 rounded-lg p-3 text-center">
                <p class="text-2xl font-bold text-gray-500">{{ currentProgress()!.skipped | number }}</p>
                <p class="text-xs text-gray-400 mt-0.5">Duplicados</p>
              </div>
              <div class="bg-gray-50 rounded-lg p-3 text-center">
                <p class="text-2xl font-bold text-gray-600">{{ formatElapsed(currentProgress()!.elapsedMs) }}</p>
                <p class="text-xs text-gray-400 mt-0.5">Tiempo</p>
              </div>
            </div>
            <p class="text-xs text-gray-400">
              Velocidad aprox.: {{ speed() }} emails/seg · Actualiza cada 50 emails
            </p>
          } @else {
            <p class="text-sm text-gray-400 animate-pulse">Iniciando lectura del archivo PST...</p>
          }
        </section>
      }

      <!-- ── 3. Historial ───────────────────────────────── -->
      <section class="bg-white rounded-xl border border-gray-200 p-5">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-gray-700">3. Historial de importaciones</h2>
          <button (click)="loadHistory()" class="text-xs text-teal-600 hover:text-teal-800">Actualizar</button>
        </div>

        @if (history().length === 0) {
          <p class="text-sm text-gray-400">Sin importaciones registradas.</p>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th class="pb-2 font-medium">Archivo</th>
                  <th class="pb-2 font-medium">Estado</th>
                  <th class="pb-2 font-medium text-right">Insertos</th>
                  <th class="pb-2 font-medium text-right">Saltados</th>
                  <th class="pb-2 font-medium text-right">Refs</th>
                  <th class="pb-2 font-medium text-right">Adjuntos</th>
                  <th class="pb-2 font-medium">Importado por</th>
                  <th class="pb-2 font-medium">Inicio</th>
                </tr>
              </thead>
              <tbody>
                @for (log of history(); track log.id) {
                  <tr class="border-b border-gray-50 hover:bg-gray-50">
                    <td class="py-2 pr-3 font-mono text-xs text-gray-600 max-w-[200px] truncate">{{ log.filename }}</td>
                    <td class="py-2 pr-3">
                      <span class="px-2 py-0.5 rounded-full text-xs font-medium"
                            [ngClass]="statusBadge(log.status)">
                        {{ statusLabel(log.status) }}
                      </span>
                      @if (log.errorMessage) {
                        <p class="text-xs text-red-400 mt-0.5">{{ log.errorMessage }}</p>
                      }
                    </td>
                    <td class="py-2 pr-3 text-right text-gray-700">{{ log.inserted }}</td>
                    <td class="py-2 pr-3 text-right text-gray-400">{{ log.skippedDuplicates }}</td>
                    <td class="py-2 pr-3 text-right text-gray-400">{{ log.referencesResolved }}</td>
                    <td class="py-2 pr-3 text-right text-gray-400">{{ log.attachmentsSaved }}</td>
                    <td class="py-2 pr-3 text-xs text-gray-700">{{ log.importedBy ?? '—' }}</td>
                    <td class="py-2 text-xs text-gray-400">{{ formatDate(log.startedAt) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
})
export class PstAdminComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private socket: Socket | null = null;

  readonly pstFiles = signal<PstFile[]>([]);
  readonly history = signal<ImportLog[]>([]);
  readonly uploading = signal(false);
  readonly uploadProgress = signal<number | null>(null);
  readonly uploadError = signal('');
  readonly uploadSuccess = signal(false);
  readonly activeImport = signal<string | null>(null);
  readonly currentProgress = signal<PstProgress | null>(null);
  readonly importError = signal('');

  uploadFile: File | null = null;

  private beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    if (this.uploading()) {
      e.preventDefault();
    }
  };

  ngOnInit(): void {
    this.connectWs();
    this.loadFiles();
    this.loadHistory();
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.socket = null;
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
  }

  private connectWs(): void {
    const token = this.authService.getToken();
    if (!token) return;
    this.socket = io('/mail', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('pst_progress', (data: PstProgress) => {
      this.currentProgress.set(data);
    });

    this.socket.on('pst_complete', (data: PstComplete) => {
      this.activeImport.set(null);
      this.currentProgress.set(null);
      this.loadHistory();
      alert(`Importación completada: ${data.totalInserted} insertos, ${data.totalSkipped} saltados.`);
    });

    this.socket.on('pst_error', (data: { filename: string; errorMessage: string }) => {
      this.activeImport.set(null);
      this.currentProgress.set(null);
      this.importError.set(`Error en ${data.filename}: ${data.errorMessage}`);
      this.loadHistory();
    });
  }

  loadFiles(): void {
    this.http.get<{ files: PstFile[] }>('/api/mail/admin/pst/files').subscribe({
      next: (res) => this.pstFiles.set(res.files),
    });
  }

  loadHistory(): void {
    this.http.get<ImportLog[]>('/api/mail/admin/pst/history').subscribe({
      next: (list) => this.history.set(list),
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFile = input.files?.[0] ?? null;
    this.uploadError.set('');
    this.uploadSuccess.set(false);
    this.uploadProgress.set(null);
  }

  uploadPst(): void {
    if (!this.uploadFile) return;
    this.uploading.set(true);
    this.uploadError.set('');
    this.uploadSuccess.set(false);
    this.uploadProgress.set(0);

    const form = new FormData();
    form.append('file', this.uploadFile);

    // Use XHR for progress
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        this.uploadProgress.set(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      this.uploading.set(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        this.uploadSuccess.set(true);
        this.uploadFile = null;
        this.uploadProgress.set(null);
        this.loadFiles();
      } else {
        this.uploadProgress.set(null);
        try {
          const body = JSON.parse(xhr.responseText);
          this.uploadError.set(body?.message ?? 'Error al subir el archivo.');
        } catch {
          this.uploadError.set('Error al subir el archivo.');
        }
      }
    };
    xhr.onerror = () => {
      this.uploading.set(false);
      this.uploadProgress.set(null);
      this.uploadError.set('Error de red al subir el archivo.');
    };

    const token = this.authService.getToken();
    // Bypass Angular dev-server proxy for large file uploads
    const base = window.location.port === '4200' ? 'http://127.0.0.1:3000' : '';
    xhr.open('POST', `${base}/api/mail/admin/pst/upload`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(form);
  }

  startImport(filename: string): void {
    this.importError.set('');
    this.activeImport.set(filename);
    this.currentProgress.set(null);

    this.http.post<{ ok: boolean }>(`/api/mail/admin/pst/import/${encodeURIComponent(filename)}`, {}).subscribe({
      next: () => { /* background job started */ },
      error: (err: any) => {
        this.activeImport.set(null);
        this.importError.set(err?.error?.message ?? 'Error al iniciar la importación.');
      },
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  statusLabel(status: string): string {
    return { running: 'En proceso', completed: 'Completado', failed: 'Fallido' }[status] ?? status;
  }

  statusBadge(status: string): string {
    return {
      running: 'bg-amber-100 text-amber-700',
      completed: 'bg-teal-100 text-teal-700',
      failed: 'bg-red-100 text-red-700',
    }[status] ?? 'bg-gray-100 text-gray-600';
  }

  formatElapsed(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  speed(): string {
    const p = this.currentProgress();
    if (!p || p.elapsedMs < 1000) return '—';
    return (p.current / (p.elapsedMs / 1000)).toFixed(1);
  }
}
