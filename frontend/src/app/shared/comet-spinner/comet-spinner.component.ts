import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Cuántos tramos forman la cola: más tramos, transición más suave del grosor. */
const SEGMENTS = 64;
/** Cuánto de la circunferencia ocupa el cometa (el resto queda vacío). */
const SWEEP_DEG = 290;
const RADIUS = 40;
const TAIL = [20, 184, 165]; // #14B8A5, el turquesa de la intranet
const HEAD = [34, 197, 98]; // #22C562, el verde

function point(deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [50 + RADIUS * Math.sin(rad), 50 - RADIUS * Math.cos(rad)];
}

const mix = (t: number) => `rgb(${TAIL.map((c, i) => Math.round(c + (HEAD[i] - c) * t)).join(',')})`;

/**
 * Spinner con forma de cometa: un arco que gira y se afina hacia la cola,
 * que además se desvanece. La cabeza es un punto con un leve resplandor.
 */
@Component({
  selector: 'app-comet-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block', role: 'progressbar', 'aria-label': 'Cargando' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 100 100" class="comet" aria-hidden="true">
      @for (s of segments(); track $index) {
        <path [attr.d]="s.d" fill="none" [attr.stroke]="s.color" [attr.stroke-width]="s.width" [attr.stroke-opacity]="s.opacity" />
      }
      <circle [attr.cx]="head().x" [attr.cy]="head().y" [attr.r]="head().r" fill="#22C562" class="comet-head" />
      <circle [attr.cx]="head().x" [attr.cy]="head().y" [attr.r]="head().r * 0.45" fill="#ffffff" opacity=".85" />
    </svg>
  `,
  styles: [`
    :host { line-height: 0; }
    .comet {
      transform-origin: 50% 50%;
      animation: comet-turn 1s linear infinite;
      filter: drop-shadow(0 0 3px rgba(34, 197, 98, 0.35));
    }
    .comet-head { filter: drop-shadow(0 0 4px rgba(34, 197, 98, 0.9)); }
    @keyframes comet-turn { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .comet { animation-duration: 3s; } }
  `],
})
export class CometSpinnerComponent {
  /** Tamaño en px. */
  readonly size = input(48);
  /** Grosor de la cabeza, en unidades de un lienzo de 100. */
  readonly thickness = input(8);

  /** La cola arranca en 0° y la cabeza llega a SWEEP_DEG; al girar, la cabeza va adelante. */
  readonly segments = computed(() => {
    const max = this.thickness();
    const step = SWEEP_DEG / SEGMENTS;
    return Array.from({ length: SEGMENTS }, (_, i) => {
      const t = (i + 1) / SEGMENTS;
      const [x1, y1] = point(i * step);
      // Un poco de solapamiento entre tramos para que no se vean cortes.
      const [x2, y2] = point((i + 1) * step + 0.4);
      return {
        d: `M${x1.toFixed(2)} ${y1.toFixed(2)}A${RADIUS} ${RADIUS} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
        width: (0.4 + Math.pow(t, 1.8) * (max - 0.4)).toFixed(2),
        opacity: (0.04 + Math.pow(t, 1.3) * 0.96).toFixed(3),
        color: mix(t),
      };
    });
  });

  readonly head = computed(() => {
    const [x, y] = point(SWEEP_DEG);
    return { x, y, r: this.thickness() / 2 + 0.6 };
  });
}
