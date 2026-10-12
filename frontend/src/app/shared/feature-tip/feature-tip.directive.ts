import { Directive, ElementRef, HostListener, OnDestroy, inject, input } from '@angular/core';
import { FEATURE_TIPS } from './feature-tips';
import { NEW_FEATURES, NewFeature, isNewFeature } from '../new-badge/new-features';

/** Megáfono con brillo (el ícono de la burbuja). */
const SPARK_PATH = 'M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z';
/** Separación entre el botón y la burbuja. */
const GAP = 10;
/** Margen contra los bordes de la pantalla. */
const EDGE = 12;
/** Al salir con el mouse, un instante de gracia (para no parpadear entre botones juntos). */
const HIDE_DELAY_MS = 90;

let nextId = 0;

/** La campanita del encabezado (notification-bell), para "{campana}" en los textos. */
const BELL_PATHS = ['M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 003.4 0'];

/** Texto plano (textContent) con "{campana}" dibujada como el ícono de notificaciones. */
function fillText(target: HTMLElement, value: string): void {
  value.split('{campana}').forEach((part, i) => {
    if (i > 0) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'ft-bell');
      svg.setAttribute('aria-label', 'campanita de notificaciones');
      for (const d of BELL_PATHS) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
      }
      target.appendChild(svg);
    }
    if (part) target.appendChild(document.createTextNode(part));
  });
}

/**
 * Burbuja que explica una funcionalidad apenas se pasa el mouse (o se llega
 * con el teclado), con los colores de la intranet, sombra y una animación
 * suave. Reemplaza al "title" del navegador, que tardaba en aparecer.
 * Uso: <button appFeatureTip="seguir-mto">…</button> (textos en feature-tips.ts).
 * Se dibuja en <body> (position: fixed) para que ningún panel con overflow la
 * corte; estilos en styles.scss (.ft-*). En pantallas táctiles no aparece.
 */
@Directive({
  selector: '[appFeatureTip]',
  standalone: true,
  host: { '[attr.aria-describedby]': 'shown ? id : null' },
})
export class FeatureTipDirective implements OnDestroy {
  readonly appFeatureTip = input.required<string>();
  /** Preferencia: abajo (por defecto) o arriba; si no entra, va del otro lado. */
  readonly tipPlacement = input<'bottom' | 'top'>('bottom');

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private bubble: HTMLElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** Elementos a los que se les sacó el "title" mientras está la burbuja. */
  private mutedTitles: HTMLElement[] = [];
  readonly id = `ft-${++nextId}`;
  shown = false;

  @HostListener('pointerenter', ['$event'])
  onEnter(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    this.show();
  }

  @HostListener('focusin')
  onFocus(): void {
    // Solo con el teclado (al tocar con el mouse ya se mostró por el hover)
    if (this.host.nativeElement.matches(':focus-visible, :has(:focus-visible)')) this.show();
  }

  @HostListener('pointerleave')
  @HostListener('focusout')
  onLeave(): void {
    this.scheduleHide();
  }

  /** Al tocarlo se va: lo que abre el botón (una ventana, un menú) no queda tapado. */
  @HostListener('click')
  onClick(): void {
    this.hide();
  }

  ngOnDestroy(): void {
    this.hide();
  }

  private show(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (this.bubble) return;
    const tip = FEATURE_TIPS[this.appFeatureTip()];
    if (!tip) return;

    const isNew = this.appFeatureTip() in NEW_FEATURES && isNewFeature(this.appFeatureTip() as NewFeature);
    const bubble = document.createElement('div');
    bubble.className = 'ft-bubble';
    bubble.id = this.id;
    bubble.setAttribute('role', 'tooltip');

    const head = document.createElement('div');
    head.className = 'ft-head';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('class', 'ft-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', SPARK_PATH);
    icon.appendChild(path);
    const iconWrap = document.createElement('span');
    iconWrap.className = 'ft-icon-wrap';
    iconWrap.appendChild(icon);
    const title = document.createElement('span');
    title.className = 'ft-title';
    title.textContent = tip.title;
    head.append(iconWrap, title);
    if (isNew) {
      const chip = document.createElement('span');
      chip.className = 'ft-new';
      chip.textContent = 'NUEVO';
      head.appendChild(chip);
    }

    const text = document.createElement('p');
    text.className = 'ft-text';
    fillText(text, tip.text);
    bubble.append(head, text);

    if (tip.points?.length) {
      const list = document.createElement('ul');
      list.className = 'ft-points';
      for (const p of tip.points) {
        const li = document.createElement('li');
        fillText(li, p);
        list.appendChild(li);
      }
      bubble.appendChild(list);
    }

    const arrow = document.createElement('span');
    arrow.className = 'ft-arrow';
    bubble.appendChild(arrow);

    // El "title" del navegador (del botón y de lo que tenga adentro) se guarda y se
    // saca mientras está la burbuja: si no, a los segundos sale también el globo gris.
    const el = this.host.nativeElement;
    for (const node of [el, ...Array.from(el.querySelectorAll<HTMLElement>('[title]'))]) {
      const title = node.getAttribute('title');
      if (title === null) continue;
      node.dataset['ftTitle'] = title;
      node.removeAttribute('title');
      this.mutedTitles.push(node);
    }

    document.body.appendChild(bubble);
    this.bubble = bubble;
    this.shown = true;
    this.position(bubble, arrow);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.onScroll);
    // Un frame después, para que arranque la animación de entrada
    requestAnimationFrame(() => bubble.classList.add('ft-in'));
  }

  private position(bubble: HTMLElement, arrow: HTMLElement): void {
    const r = this.host.nativeElement.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const roomBelow = vh - r.bottom;
    const roomAbove = r.top;
    let below = this.tipPlacement() === 'bottom';
    if (below && roomBelow < b.height + GAP + EDGE && roomAbove > roomBelow) below = false;
    if (!below && roomAbove < b.height + GAP + EDGE && roomBelow > roomAbove) below = true;

    const centerX = r.left + r.width / 2;
    const left = Math.min(Math.max(EDGE, centerX - b.width / 2), vw - b.width - EDGE);
    const top = below ? r.bottom + GAP : r.top - GAP - b.height;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(Math.max(EDGE, top))}px`;
    bubble.classList.add(below ? 'ft-below' : 'ft-above');
    // La flecha apunta al centro del botón aunque la burbuja se haya corrido
    arrow.style.left = `${Math.round(Math.min(Math.max(16, centerX - left), b.width - 16))}px`;
  }

  private readonly onScroll = () => this.hide();

  private scheduleHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY_MS);
  }

  private hide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onScroll);
    for (const node of this.mutedTitles) {
      if (node.dataset['ftTitle'] === undefined) continue;
      // Si Angular lo volvió a poner mientras tanto, gana el valor nuevo
      if (!node.hasAttribute('title')) node.setAttribute('title', node.dataset['ftTitle']!);
      delete node.dataset['ftTitle'];
    }
    this.mutedTitles = [];
    const bubble = this.bubble;
    this.bubble = null;
    this.shown = false;
    if (!bubble) return;
    bubble.classList.remove('ft-in');
    bubble.classList.add('ft-out');
    setTimeout(() => bubble.remove(), 140);
  }
}
