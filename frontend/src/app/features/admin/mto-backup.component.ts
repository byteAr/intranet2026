import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { CometSpinnerComponent } from '../../shared/comet-spinner/comet-spinner.component';

interface BackupStatus {
  enabled: boolean;
  account: string;
  total: number;
  backedUp: number;
  pendingFiles: number;
  running: boolean;
  lastRun: { startedAt: string; finishedAt: string | null; mto: number; files: number; errors: number; stoppedBy: string } | null;
  rootUrl: string | null;
}

/**
 * Administración → Respaldo MTO (TICOM): el respaldo nocturno de los MTO en
 * Google Drive (cuenta de telemático), su avance y una prueba a mano.
 */
@Component({
  selector: 'app-mto-backup',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe, CometSpinnerComponent],
  template: `
    <div class="max-w-3xl">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Respaldo de MTO en Google Drive</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-zinc-400">
        Todas las madrugadas, de 1:00 a 6:30, se suben a la carpeta <strong>Respaldo MTO</strong> los MTO que falten,
        ordenados por año, mes y día, y por Ejecutivos, Informativos, Redgen, Enviados y Encriptados (PON y SIENA).
        Cada MTO va en su carpeta con el <strong>.msg</strong> y sus desencriptados.
      </p>

      @if (loading()) {
        <div class="flex justify-center py-8"><app-comet-spinner [size]="28" /></div>
      } @else if (status(); as s) {
        @if (!s.enabled) {
          <p class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
            El respaldo no está activado en este servidor. Se activa solo en producción (MTO_BACKUP_ENABLED).
          </p>
        }

        <div class="mt-5 rounded-lg border border-gray-200 dark:border-zinc-700 p-4">
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-sm text-gray-700 dark:text-zinc-200">
              <strong>{{ s.backedUp | number }}</strong> de {{ s.total | number }} MTO respaldados
            </p>
            <p class="text-sm font-semibold text-teal-700 dark:text-teal-400">{{ percent() }} %</p>
          </div>
          <div class="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
            <div class="h-full rounded-full bg-teal-600 transition-all" [style.width.%]="percent()"></div>
          </div>
          <ul class="mt-3 space-y-1 text-xs text-gray-500 dark:text-zinc-400">
            <li>Cuenta: <strong class="text-gray-700 dark:text-zinc-200">{{ s.account }}</strong></li>
            @if (s.pendingFiles) {
              <li>Desencriptados por agregar a MTO ya respaldados: {{ s.pendingFiles | number }}</li>
            }
            @if (s.lastRun; as r) {
              <li>
                Última vez: {{ r.startedAt | date: 'dd/MM/yyyy HH:mm' }} —
                {{ r.mto | number }} MTO y {{ r.files | number }} desencriptados
                @if (r.errors) { , <span class="text-red-600">{{ r.errors }} con error</span> }
                ({{ r.stoppedBy }})
              </li>
            } @else {
              <li>Todavía no corrió.</li>
            }
            @if (s.running) {
              <li class="flex items-center gap-1.5 text-teal-700 dark:text-teal-400"><app-comet-spinner [size]="12" [thickness]="2" /> Respaldando ahora…</li>
            }
          </ul>
        </div>

        @if (s.rootUrl) {
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <a [href]="s.rootUrl" target="_blank" rel="noopener"
              class="text-sm text-teal-700 underline underline-offset-2 dark:text-teal-400">Abrir la carpeta en Drive</a>
            <span class="text-xs text-gray-400">(con la cuenta {{ s.account }})</span>
          </div>
        }
      }
      @if (error()) {
        <p class="mt-3 text-sm text-red-600">{{ error() }}</p>
      }
    </div>
  `,
})
export class MtoBackupComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<BackupStatus | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly percent = computed(() => {
    const s = this.status();
    if (!s?.total) return 0;
    return Math.floor((s.backedUp / s.total) * 1000) / 10;
  });

  ngOnInit(): void {
    this.load();
    // Mientras corre, se actualiza solo.
    interval(10_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.status()?.running) this.load();
      });
  }

  private load(): void {
    this.http.get<BackupStatus>('/api/mto-backup/status').subscribe({
      next: (s) => {
        this.status.set(s);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('No se pudo leer el estado del respaldo.');
      },
    });
  }
}
