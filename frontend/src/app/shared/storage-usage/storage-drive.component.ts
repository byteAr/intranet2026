import { ChangeDetectionStrategy, Component, afterNextRender, signal } from '@angular/core';
import { StorageUsageComponent } from './storage-usage.component';
import { NewBadgeComponent } from '../new-badge/new-badge.component';

/**
 * El espacio de la oficina como un pendrive chico, de trazo fino, que se va
 * llenando (verde, ámbar desde el 80 %, rojo desde el 95 %). Al lado, lo
 * libre y el total.
 */
@Component({
  selector: 'app-storage-drive',
  standalone: true,
  imports: [NewBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-3" [title]="usage().label + ' · ' + basis()">
      <!-- Pendrive -->
      <div class="flex items-center flex-shrink-0" role="progressbar" [attr.aria-valuenow]="percent()"
           aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Espacio usado de ' + usage().label">
        <div class="h-6 w-16 rounded-md border-[1.5px] border-gray-300 dark:border-zinc-600 p-[3px]">
          <div class="drive-fill h-full rounded-[3px]" [style.width.%]="shown() ? barWidth() : 0" [style.background]="barColor()"></div>
        </div>
        <!-- Conector USB -->
        <div class="h-3.5 w-3 rounded-r-[3px] border-[1.5px] border-l-0 border-gray-300 dark:border-zinc-600 flex flex-col justify-center gap-[3px] pl-[3px]">
          <span class="block h-[2px] w-[4px] bg-gray-300 dark:bg-zinc-600"></span>
          <span class="block h-[2px] w-[4px] bg-gray-300 dark:bg-zinc-600"></span>
        </div>
      </div>

      <div class="leading-tight whitespace-nowrap">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-semibold tabular-nums" [class]="levelText()">
            {{ full() ? 'Sin espacio' : free() + ' libres' }}
          </span>
          <app-new-badge feature="espacio-oficinas" [compact]="true" />
        </div>
        <div class="text-xs tabular-nums text-gray-500 dark:text-zinc-400">{{ used() }} de {{ quota() }}</div>
      </div>
    </div>
  `,
  styles: [`
    .drive-fill { transition: width 1s cubic-bezier(.22, 1, .36, 1); }
    @media (prefers-reduced-motion: reduce) { .drive-fill { transition: none; } }
  `],
})
export class StorageDriveComponent extends StorageUsageComponent {
  /** Arranca vacío y se llena al aparecer. */
  readonly shown = signal(false);

  constructor() {
    super();
    afterNextRender(() => requestAnimationFrame(() => this.shown.set(true)));
  }
}
