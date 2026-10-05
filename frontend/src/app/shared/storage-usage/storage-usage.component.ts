import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { OfficeUsage } from '../../core/services/shared-folders.service';

/** 1,2 GB · 340 MB · 12 KB (1 GB = 1024³, como Google). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('es-AR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

/** Lugar libre de una oficina, en bytes. */
export function freeBytes(u: OfficeUsage): number {
  return Math.max(0, u.quotaBytes - u.usedBytes);
}

/**
 * Barra de espacio de una oficina: usado, disponible y aviso cuando se llena.
 * Verde hasta el 80 %, ámbar hasta el 95 %, rojo después.
 */
@Component({
  selector: 'app-storage-usage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <div>
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-sm font-semibold text-gray-800 dark:text-zinc-200 truncate">{{ usage().label }}</span>
          <span class="text-sm tabular-nums font-semibold whitespace-nowrap" [class]="levelText()">
            {{ full() ? 'Sin espacio' : free() + ' libres' }}
          </span>
        </div>
        <div class="mt-2 h-2.5 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden"
             role="progressbar" [attr.aria-valuenow]="percent()" aria-valuemin="0" aria-valuemax="100"
             [attr.aria-label]="'Espacio usado de ' + usage().label">
          <div class="h-full rounded-full transition-[width] duration-700" [style.width.%]="barWidth()" [style.background]="barColor()"></div>
        </div>
        <div class="mt-1.5 flex justify-between gap-3 text-xs text-gray-500 dark:text-zinc-400 tabular-nums">
          <span>{{ used() }} usados de {{ quota() }}</span>
          <span>{{ percent() }} %</span>
        </div>
        <p class="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500">{{ basis() }}</p>
        @if (full()) {
          <p class="mt-1.5 text-xs text-red-600 dark:text-red-400">Para subir archivos nuevos hay que eliminar otros.</p>
        }
        @if (usage().trashedBytes > 0) {
          <p class="mt-1 text-[11px] text-gray-400 dark:text-zinc-500">
            Incluye {{ trashed() }} en la papelera de Drive: se libera en unos minutos.
          </p>
        }
      </div>
  `,
})
export class StorageUsageComponent {
  readonly usage = input.required<OfficeUsage>();

  readonly percent = computed(() => {
    const u = this.usage();
    return u.quotaBytes > 0 ? Math.min(100, Math.round((u.usedBytes / u.quotaBytes) * 100)) : 0;
  });
  /** Con algo usado la barra nunca queda invisible. */
  readonly barWidth = computed(() => (this.usage().usedBytes > 0 ? Math.max(2, this.percent()) : 0));
  readonly full = computed(() => freeBytes(this.usage()) <= 0);
  readonly level = computed(() => (this.percent() >= 95 ? 'red' : this.percent() >= 80 ? 'amber' : 'ok'));

  readonly barColor = computed(() => {
    switch (this.level()) {
      case 'red': return '#DC2626';
      case 'amber': return '#F59E0B';
      default: return 'linear-gradient(to right, #14B8A5, #22C562)';
    }
  });
  readonly levelText = computed(() => {
    switch (this.level()) {
      case 'red': return 'text-red-600 dark:text-red-400';
      case 'amber': return 'text-amber-600 dark:text-amber-400';
      default: return 'text-teal-700 dark:text-teal-400';
    }
  });

  readonly used = computed(() => formatBytes(this.usage().usedBytes));
  readonly quota = computed(() => formatBytes(this.usage().quotaBytes));
  readonly free = computed(() => formatBytes(freeBytes(this.usage())));
  readonly trashed = computed(() => formatBytes(this.usage().trashedBytes));
  /** De dónde sale el espacio, para que no parezca arbitrario. */
  readonly basis = computed(() => {
    const u = this.usage();
    const n = u.memberCount;
    const people = `${n} ${n === 1 ? 'integrante' : 'integrantes'}`;
    const pending = u.opened ? '' : ' · todavía no la usan';
    switch (u.quotaRule) {
      case 'personal': return 'Espacio personal: no cuenta para el de la oficina';
      case 'manual': return `Espacio asignado por TICOM${pending}`;
      case 'per-member': return `${people} · ${u.gbPerMember} GB por integrante${pending}`;
      case 'maximum': return `${people} · máximo por oficina${pending}`;
      default: return n ? `${people} · mínimo por oficina${pending}` : `Mínimo por oficina${pending}`;
    }
  });
}
