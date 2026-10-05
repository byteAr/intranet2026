import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NewFeature, isNewFeature } from './new-features';

/**
 * Etiqueta NUEVO para una funcionalidad recién lanzada; se oculta sola a la
 * semana (ver new-features.ts). Con [dot]="true" es un punto, para el menú
 * lateral contraído.
 */
@Component({
  selector: 'app-new-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      @if (dot()) {
        <span class="block h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-900" title="Nuevo"></span>
      } @else if (compact()) {
        <span class="inline-flex items-center rounded-full bg-emerald-500 px-1 py-px text-[8px] font-bold uppercase leading-3 tracking-wide text-white shadow-sm ring-2 ring-white dark:ring-zinc-900"
              title="Funcionalidad nueva">Nuevo</span>
      } @else {
        <span class="inline-flex items-center rounded-full bg-emerald-500 px-1.5 py-px text-[9px] font-bold uppercase leading-4 tracking-wider text-white"
              title="Funcionalidad nueva">Nuevo</span>
      }
    }
  `,
})
export class NewBadgeComponent {
  readonly feature = input.required<NewFeature>();
  readonly dot = input(false);
  /** Más chica, para ubicarla como insignia en una esquina sin tapar texto. */
  readonly compact = input(false);
  readonly visible = computed(() => isNewFeature(this.feature()));
}
