import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

interface Segment {
  text: string;
  /** Enlace; null en el texto común. */
  href: string | null;
  /** Ruta de la intranet (se abre sin recargar), o null si es un sitio externo. */
  internal: string | null;
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
/** Rutas de la intranet que se abren adentro aunque el enlace venga de otra dirección (IP o nombre). */
const INTERNAL_PATH = /^\/(correo|archivos|chat|cuenta|incidencias|reservas|parte-diario)(\/|\?|$)/;

/**
 * Texto de un mensaje con los enlaces clicables. Los de la intranet navegan
 * adentro (sin abrir otra pestaña); el de un MTO se muestra como
 * "Abrir el MTO". Todo se muestra como texto: nunca se interpreta HTML.
 */
@Component({
  selector: 'app-linked-text',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  // En una sola línea y sin espacios entre bloques: el mensaje se muestra con
  // white-space: pre-wrap y cualquier espacio de más se vería.
  template: `@for (s of segments(); track $index) {@if (s.href) {<a [href]="s.href" (click)="open($event, s)" [attr.target]="s.internal ? null : '_blank'" [attr.rel]="s.internal ? null : 'noopener noreferrer'" class="underline underline-offset-2 font-medium break-all hover:opacity-80">{{ s.text }}</a>} @else {<ng-container>{{ s.text }}</ng-container>}}`,
})
export class LinkedTextComponent {
  readonly text = input<string>('');
  private readonly router = inject(Router);

  readonly segments = computed<Segment[]>(() =>
    (this.text() ?? '').split(URL_RE).filter(Boolean).map((part) => {
      if (!/^https?:\/\//.test(part)) return { text: part, href: null, internal: null };
      // Un punto o paréntesis final suele ser del texto, no del enlace.
      const href = part.replace(/[.,;:)]+$/, '');
      const internal = this.internalPath(href);
      const label = internal?.startsWith('/correo?mto=') ? 'Abrir el MTO' : href;
      return { text: label, href, internal };
    }),
  );

  private internalPath(href: string): string | null {
    try {
      const url = new URL(href);
      const path = url.pathname + url.search;
      return url.host === location.host || INTERNAL_PATH.test(path) ? path : null;
    } catch {
      return null;
    }
  }

  open(event: MouseEvent, s: Segment): void {
    if (!s.internal || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void this.router.navigateByUrl(s.internal);
  }
}
