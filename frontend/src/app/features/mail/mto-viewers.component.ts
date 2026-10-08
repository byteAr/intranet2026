import { Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MailService, MtoViewer } from '../../core/services/mail.service';

/** Colores para las iniciales de quien no tiene foto (siempre el mismo por persona). */
const COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5'];
/** Avatares que se ven encimados; el resto queda en el número. */
const SHOWN = 5;

/**
 * "Visto por", debajo del asunto del MTO: las fotos de quienes lo abrieron,
 * encimadas, y cuántos son. Al tocarlo, la lista con la fecha y hora de cada uno.
 */
@Component({
  selector: 'app-mto-viewers',
  standalone: true,
  template: `
    @if (viewers().length) {
      <button type="button" (click)="openList()"
        class="mt-2 inline-flex items-center gap-2 rounded-full pl-1 pr-2.5 py-0.5 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
        [title]="'Lo vieron ' + viewers().length + ' ' + (viewers().length === 1 ? 'persona' : 'personas') + ' — tocá para ver quiénes'">
        <span class="flex -space-x-2">
          @for (v of shown(); track v.userId) {
            <span class="relative inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full ring-2 ring-white dark:ring-zinc-900 text-[9px] font-bold text-white"
                  [style.background]="colorOf(v)">
              @if (v.hasAvatar && !brokenAvatars().has(v.userId)) {
                <img [src]="avatarUrl(v)" alt="" class="h-full w-full object-cover" (error)="markBroken(v)" />
              } @else {
                {{ initials(v) }}
              }
            </span>
          }
          @if (viewers().length > SHOWN) {
            <span class="relative inline-flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-white dark:ring-zinc-900 bg-gray-200 dark:bg-zinc-700 text-[9px] font-bold text-gray-600 dark:text-zinc-300">
              +{{ viewers().length - SHOWN }}
            </span>
          }
        </span>
        <span class="flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          {{ viewers().length }} {{ viewers().length === 1 ? 'visto' : 'vistos' }}
        </span>
      </button>
    }

    @if (listOpen()) {
      <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" (click)="listOpen.set(false)">
        <div class="w-full max-w-sm max-h-[80vh] flex flex-col rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl"
             (click)="$event.stopPropagation()" role="dialog" aria-label="Quiénes vieron el MTO">
          <div class="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-zinc-800">
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Visto por</h3>
              <p class="text-xs text-gray-500 dark:text-zinc-400">{{ viewers().length }} {{ viewers().length === 1 ? 'persona' : 'personas' }}{{ subject() ? ' · ' + subject() : '' }}</p>
            </div>
            <button (click)="listOpen.set(false)" class="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200" aria-label="Cerrar">✕</button>
          </div>
          <ul class="flex-1 overflow-y-auto py-1">
            @for (v of viewersNewestFirst(); track v.userId) {
              <li class="flex items-center gap-3 px-5 py-2">
                <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white"
                      [style.background]="colorOf(v)">
                  @if (v.hasAvatar && !brokenAvatars().has(v.userId)) {
                    <img [src]="avatarUrl(v)" alt="" class="h-full w-full object-cover" (error)="markBroken(v)" />
                  } @else {
                    {{ initials(v) }}
                  }
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{{ v.name }}</span>
                  <span class="block text-xs text-gray-500 dark:text-zinc-400">{{ formatDate(v.readAt) }}</span>
                </span>
              </li>
            }
          </ul>
        </div>
      </div>
    }
  `,
})
export class MtoViewersComponent {
  private readonly mail = inject(MailService);

  readonly emailId = input.required<string>();
  readonly subject = input<string>('');
  /** Se incrementa cuando el usuario registró que lo vio: se vuelve a pedir la lista. */
  readonly version = input(0);

  readonly SHOWN = SHOWN;
  readonly viewers = signal<MtoViewer[]>([]);
  readonly listOpen = signal(false);
  readonly brokenAvatars = signal<ReadonlySet<string>>(new Set());

  /** Los últimos en verlo, encimados (el más reciente adelante). */
  readonly shown = computed(() => this.viewers().slice(-SHOWN).reverse());
  readonly viewersNewestFirst = computed(() => [...this.viewers()].reverse());

  constructor() {
    effect(() => {
      const id = this.emailId();
      this.version();
      untracked(() => this.load(id));
    });
  }

  private load(id: string): void {
    this.mail.getViewers(id).subscribe({
      next: (list) => {
        if (this.emailId() === id) this.viewers.set(list);
      },
      error: () => {
        if (this.emailId() === id) this.viewers.set([]);
      },
    });
  }

  openList(): void {
    this.listOpen.set(true);
    // Al abrirla se actualiza: alguien pudo haberlo visto mientras estaba abierto.
    this.load(this.emailId());
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.listOpen.set(false);
  }

  avatarUrl(v: MtoViewer): string {
    return `/api/users/${v.userId}/avatar`;
  }

  markBroken(v: MtoViewer): void {
    this.brokenAvatars.update((set) => new Set(set).add(v.userId));
  }

  initials(v: MtoViewer): string {
    const parts = v.name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
  }

  colorOf(v: MtoViewer): string {
    let hash = 0;
    for (const c of v.username) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    return COLORS[hash % COLORS.length];
  }

  /** "08/10/2026 11:54", en hora de Argentina. */
  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}
