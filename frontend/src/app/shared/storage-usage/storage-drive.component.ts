import { ChangeDetectionStrategy, Component, afterNextRender, computed, signal } from '@angular/core';
import { StorageUsageComponent } from './storage-usage.component';
import { NewBadgeComponent } from '../new-badge/new-badge.component';

/**
 * El espacio de la oficina como un pendrive que se va llenando: cuerpo con
 * el nivel (verde, ámbar desde el 80 %, rojo desde el 95 %), conector
 * metálico y una luz. Al lado, lo libre y lo usado.
 */
@Component({
  selector: 'app-storage-drive',
  standalone: true,
  imports: [NewBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-4" [title]="basis()">
      <div class="text-right leading-tight">
        <div class="flex items-center justify-end gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          <app-new-badge feature="espacio-oficinas" />
          Espacio de {{ usage().groupName }}
        </div>
        <div class="mt-1 text-lg font-bold tabular-nums" [class]="levelText()">
          {{ full() ? 'Sin espacio' : free() + ' libres' }}
        </div>
        <div class="text-xs tabular-nums text-gray-500 dark:text-zinc-400">{{ used() }} usados de {{ quota() }}</div>
        @if (usage().trashedBytes > 0) {
          <div class="text-[11px] text-gray-400 dark:text-zinc-500">{{ trashed() }} en la papelera, se libera en minutos</div>
        }
      </div>

      <!-- Pendrive -->
      <div class="flex items-center flex-shrink-0" role="progressbar" [attr.aria-valuenow]="percent()"
           aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Espacio usado de ' + usage().groupName">
        <div class="drive-body relative h-14 w-40 rounded-2xl overflow-hidden">
          <div class="drive-fill absolute inset-y-0 left-0" [class.drive-busy]="level() !== 'ok'"
               [style.width.%]="shown() ? barWidth() : 0" [style.background]="barColor()"></div>
          <!-- Brillo del plástico -->
          <div class="absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/50 to-white/0 dark:from-white/15 pointer-events-none"></div>
          <!-- Ojal para el llavero -->
          <span class="drive-hole absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full"></span>
          <!-- Luz de actividad -->
          <span class="drive-led absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full" [style.background]="ledColor()"
                [style.--led]="ledColor()"></span>
          <span class="drive-percent absolute inset-0 flex items-center justify-center text-base font-extrabold tabular-nums">
            {{ percent() }}&nbsp;%
          </span>
        </div>
        <!-- Conector USB -->
        <div class="drive-plug h-8 w-7 -ml-px rounded-r-md flex flex-col justify-center gap-1.5 pl-2">
          <span class="h-1.5 w-2.5 rounded-[2px] bg-gray-500/60 dark:bg-zinc-900/70"></span>
          <span class="h-1.5 w-2.5 rounded-[2px] bg-gray-500/60 dark:bg-zinc-900/70"></span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .drive-body {
      background: #f1f5f9;
      border: 2px solid #cbd5e1;
      box-shadow: inset 0 2px 6px rgba(15, 23, 42, .08), 0 4px 14px rgba(15, 23, 42, .08);
    }
    .drive-fill {
      transition: width 1.4s cubic-bezier(.22, 1, .36, 1);
      /* Rayas que avanzan: se está "cargando" */
      background-size: 100% 100%;
    }
    .drive-fill::after {
      content: ''; position: absolute; inset: 0;
      background-image: repeating-linear-gradient(-45deg, rgba(255,255,255,.18) 0 8px, transparent 8px 16px);
      background-size: 22.6px 22.6px;
      animation: drive-stripes 1.2s linear infinite;
    }
    .drive-hole { background: #fff; box-shadow: inset 0 1px 2px rgba(15, 23, 42, .25); border: 2px solid #cbd5e1; }
    .drive-percent { color: #0f172a; text-shadow: 0 1px 0 rgba(255, 255, 255, .7); }
    .drive-plug {
      background: linear-gradient(to bottom, #e2e8f0, #94a3b8 55%, #cbd5e1);
      border: 2px solid #94a3b8; border-left: 0;
    }
    .drive-led { box-shadow: 0 0 0 0 var(--led); animation: drive-led 1.8s ease-in-out infinite; }
    @keyframes drive-stripes { to { background-position: 22.6px 0; } }
    @keyframes drive-led {
      0%, 100% { opacity: 1; box-shadow: 0 0 4px 1px var(--led); }
      50% { opacity: .35; box-shadow: 0 0 0 0 transparent; }
    }

    :host-context(.dark) .drive-body { background: #27272a; border-color: #52525b; box-shadow: inset 0 2px 6px rgba(0,0,0,.4); }
    :host-context(.dark) .drive-hole { background: #18181b; border-color: #52525b; }
    :host-context(.dark) .drive-percent { color: #f4f4f5; text-shadow: 0 1px 2px rgba(0, 0, 0, .6); }
    :host-context(.dark) .drive-plug { background: linear-gradient(to bottom, #71717a, #3f3f46 55%, #52525b); border-color: #52525b; }

    @media (prefers-reduced-motion: reduce) {
      .drive-fill { transition: none; }
      .drive-fill::after, .drive-led { animation: none; }
    }
  `],
})
export class StorageDriveComponent extends StorageUsageComponent {
  /** Arranca vacío y se llena al aparecer. */
  readonly shown = signal(false);
  readonly ledColor = computed(() => {
    switch (this.level()) {
      case 'red': return '#EF4444';
      case 'amber': return '#F59E0B';
      default: return '#22C55E';
    }
  });

  constructor() {
    super();
    afterNextRender(() => requestAnimationFrame(() => this.shown.set(true)));
  }
}
