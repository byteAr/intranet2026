import { Component, DestroyRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, catchError, debounceTime, distinctUntilChanged, firstValueFrom, of, switchMap } from 'rxjs';
import { Email } from '../../core/services/mail.service';
import { ChatService, UserSearchResult } from '../../core/services/chat.service';
import { AuthService } from '../../core/services/auth.service';
import { NewBadgeComponent } from '../../shared/new-badge/new-badge.component';

/** WhatsApp corta los enlaces muy largos: el cuerpo va recortado. */
const WHATSAPP_MAX_CHARS = 3500;

/** Enlace que abre un MTO directo en la intranet (MTO's lee ?mto=). */
export function mtoLink(emailId: string): string {
  return `${location.origin}/correo?mto=${encodeURIComponent(emailId)}`;
}

/**
 * Botón "Compartir" del detalle de un MTO: por WhatsApp Web (el texto), por
 * el chat de la intranet (un enlace que abre el MTO) o copiando el enlace.
 */
@Component({
  selector: 'app-mto-share',
  standalone: true,
  imports: [FormsModule, NewBadgeComponent],
  template: `
<div class="relative">
  <button (click)="menuOpen.set(!menuOpen()); $event.stopPropagation()"
    class="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
    title="Compartir el MTO" aria-haspopup="menu" [attr.aria-expanded]="menuOpen()">
    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>
    </svg>
    Compartir
    <app-new-badge feature="compartir-mto" [compact]="true" />
  </button>

  @if (menuOpen()) {
    <div class="absolute right-0 top-full mt-1.5 z-30 w-64 py-1.5 bg-white dark:bg-zinc-800 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-700"
         role="menu" (click)="$event.stopPropagation()">
      <button (click)="shareWhatsApp()" role="menuitem"
        class="w-full flex items-start gap-3 px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-zinc-700">
        <svg class="h-5 w-5 flex-shrink-0 mt-px" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#25D366" d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2z"/>
          <path fill="#fff" d="M16.9 14.3c-.3-.1-1.6-.8-1.8-.9-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 01-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 001.8-1.3c.2-.5.2-1 .1-1.1l-.5-.2z"/>
        </svg>
        <span class="min-w-0">
          <span class="block text-sm text-gray-800 dark:text-zinc-100">WhatsApp Web</span>
          <span class="block text-[11px] text-gray-400 dark:text-zinc-500">El texto del MTO, sin los adjuntos</span>
        </span>
      </button>
      <button (click)="openIntranetShare()" role="menuitem"
        class="w-full flex items-start gap-3 px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-zinc-700">
        <svg class="h-5 w-5 flex-shrink-0 mt-px text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12c0 4.4-4 8-9 8a9.9 9.9 0 01-4.3-.9L3 20l1.4-3.7A7.4 7.4 0 013 12c0-4.4 4-8 9-8s9 3.6 9 8z"/>
        </svg>
        <span class="min-w-0">
          <span class="block text-sm text-gray-800 dark:text-zinc-100">Con alguien de la intranet</span>
          <span class="block text-[11px] text-gray-400 dark:text-zinc-500">Le llega por Conversaciones con el enlace</span>
        </span>
      </button>
      <button (click)="copyLink()" role="menuitem"
        class="w-full flex items-start gap-3 px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-zinc-700">
        <svg class="h-5 w-5 flex-shrink-0 mt-px text-gray-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>
        </svg>
        <span class="min-w-0">
          <span class="block text-sm text-gray-800 dark:text-zinc-100">Copiar enlace</span>
          <span class="block text-[11px] text-gray-400 dark:text-zinc-500">Abre este MTO en la intranet</span>
        </span>
      </button>
    </div>
  }

  @if (notice()) {
    <div class="absolute right-0 top-full mt-1.5 z-30 whitespace-nowrap rounded-lg bg-gray-900 text-white text-xs px-3 py-1.5 shadow-lg" role="status">
      {{ notice() }}
    </div>
  }
</div>

<!-- Diálogo: compartir con alguien de la intranet -->
@if (dialogOpen()) {
  <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" (click)="closeDialog()">
    <div class="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-700"
         (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="mto-share-title">
      <div class="px-6 pt-6 pb-4">
        <h2 id="mto-share-title" class="text-base font-semibold text-gray-900 dark:text-zinc-100">Compartir por la intranet</h2>
        <p class="mt-1 text-xs text-gray-500 dark:text-zinc-400 truncate">{{ title() }}</p>

        <!-- Elegidos -->
        @if (selected().length) {
          <div class="mt-4 flex flex-wrap gap-1.5">
            @for (u of selected(); track u.username) {
              <span class="inline-flex items-center gap-1.5 rounded-full bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 pl-2.5 pr-1 py-0.5 text-xs text-teal-800 dark:text-teal-200">
                {{ u.displayName }}
                <button (click)="unselect(u)" class="h-4 w-4 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900 flex items-center justify-center" [attr.aria-label]="'Quitar a ' + u.displayName">✕</button>
              </span>
            }
          </div>
        }

        <!-- Buscar -->
        <div class="relative mt-3">
          <input [ngModel]="query()" (ngModelChange)="onQuery($event)" placeholder="Buscar por nombre o usuario…" autocomplete="off"
            aria-label="Buscar usuario de la intranet"
            class="block w-full rounded-lg border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 text-sm focus:border-teal-500 focus:ring-teal-500" />
          @if (results().length) {
            <ul class="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-gray-200 dark:border-zinc-700">
              @for (u of results(); track u.username) {
                <li>
                  <button (click)="select(u)" class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-zinc-700">
                    <span class="h-7 w-7 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {{ initials(u.displayName) }}
                    </span>
                    <span class="min-w-0">
                      <span class="block text-sm text-gray-900 dark:text-zinc-100 truncate">{{ u.displayName }}</span>
                      <span class="block text-xs text-gray-500 dark:text-zinc-400">{{ u.username }}</span>
                    </span>
                  </button>
                </li>
              }
            </ul>
          } @else if (searching()) {
            <p class="mt-1.5 text-xs text-gray-400">Buscando…</p>
          }
        </div>

        <textarea [ngModel]="note()" (ngModelChange)="note.set($event)" rows="2" maxlength="500"
          placeholder="Mensaje (opcional)"
          class="mt-3 block w-full rounded-lg border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 text-sm focus:border-teal-500 focus:ring-teal-500 resize-none"></textarea>

        @if (error()) {
          <p class="mt-2 text-sm text-red-600 dark:text-red-400">{{ error() }}</p>
        }
      </div>

      <div class="px-6 py-4 border-t border-gray-100 dark:border-zinc-800 flex justify-end gap-2">
        <button (click)="closeDialog()" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800">Cancelar</button>
        <button (click)="send()" [disabled]="!selected().length || sending()"
          class="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style="background: linear-gradient(to right, #14B8A5, #22C562)">
          {{ sending() ? 'Enviando…' : selected().length > 1 ? 'Enviar a ' + selected().length + ' personas' : 'Enviar' }}
        </button>
      </div>
    </div>
  </div>
}
  `,
})
export class MtoShareComponent {
  readonly email = input.required<Email>();

  private readonly chat = inject(ChatService);
  private readonly auth = inject(AuthService);

  readonly menuOpen = signal(false);
  readonly dialogOpen = signal(false);
  readonly notice = signal<string | null>(null);
  readonly query = signal('');
  readonly results = signal<UserSearchResult[]>([]);
  readonly searching = signal(false);
  readonly selected = signal<UserSearchResult[]>([]);
  readonly note = signal('');
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);

  /** "DEI 1805/21 — MTO DEI 1805/21.-" o solo el asunto. */
  readonly title = computed(() => {
    const e = this.email();
    return e.mailCode && !e.subject.includes(e.mailCode) ? `${e.mailCode} — ${e.subject}` : e.subject;
  });

  private readonly search$ = new Subject<string>();
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.trim().length < 2) {
            this.searching.set(false);
            return of([] as UserSearchResult[]);
          }
          this.searching.set(true);
          return this.chat.searchUsers(q.trim()).pipe(catchError(() => of([] as UserSearchResult[])));
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => {
        this.searching.set(false);
        const me = this.auth.currentUser()?.username?.toLowerCase();
        const chosen = new Set(this.selected().map((u) => u.username.toLowerCase()));
        this.results.set(list.filter((u) => u.username.toLowerCase() !== me && !chosen.has(u.username.toLowerCase())));
      });
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  // ─── WhatsApp ──────────────────────────────────────────────────────────────

  /** Abre WhatsApp Web con el texto del MTO listo para elegir el contacto. */
  shareWhatsApp(): void {
    this.menuOpen.set(false);
    const e = this.email();
    const fecha = new Date(e.date).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    let body = (e.bodyText ?? this.htmlToText(e.bodyHtml ?? '')).trim();
    if (body.length > WHATSAPP_MAX_CHARS) body = `${body.slice(0, WHATSAPP_MAX_CHARS).trimEnd()}…\n(continúa en la intranet)`;
    const adjuntos = e.attachments?.length ? `\nAdjuntos: ${e.attachments.map((a) => a.filename).join(', ')}` : '';
    const text = `*${this.title()}*\nDe: ${e.fromAddress}\nFecha: ${fecha}${adjuntos}\n\n${body}`;
    window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  private htmlToText(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.innerText || div.textContent || '';
  }

  // ─── Copiar enlace ─────────────────────────────────────────────────────────

  async copyLink(): Promise<void> {
    this.menuOpen.set(false);
    try {
      await navigator.clipboard.writeText(mtoLink(this.email().id));
      this.flash('Enlace copiado');
    } catch {
      this.flash('No se pudo copiar el enlace');
    }
  }

  private flash(text: string): void {
    this.notice.set(text);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.set(null), 2500);
  }

  // ─── Por la intranet ───────────────────────────────────────────────────────

  openIntranetShare(): void {
    this.menuOpen.set(false);
    this.selected.set([]);
    this.results.set([]);
    this.query.set('');
    this.note.set('');
    this.error.set(null);
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    if (!this.sending()) this.dialogOpen.set(false);
  }

  onQuery(q: string): void {
    this.query.set(q);
    this.search$.next(q);
  }

  select(u: UserSearchResult): void {
    this.selected.update((list) => [...list, u]);
    this.results.set([]);
    this.query.set('');
    this.search$.next('');
  }

  unselect(u: UserSearchResult): void {
    this.selected.update((list) => list.filter((x) => x.username !== u.username));
  }

  /**
   * Un mensaje por persona en Conversaciones, con el enlace que abre el MTO.
   * A quien nunca entró a la intranet se lo da de alta primero (como el chat).
   */
  async send(): Promise<void> {
    const people = this.selected();
    if (!people.length || this.sending()) return;
    if (!this.chat.isConnected()) {
      this.error.set('El chat no está conectado. Esperá unos segundos y probá de nuevo.');
      return;
    }
    this.sending.set(true);
    this.error.set(null);
    const note = this.note().trim();
    // Conversaciones lo muestra como una tarjeta con el sobre (MTO_SHARE_RE en chat.component.ts): no cambiar el formato.
    const content = `${note ? `${note}\n\n` : ''}Te compartí el MTO ${this.title()}\n${mtoLink(this.email().id)}`;
    const failed: string[] = [];
    for (const u of people) {
      try {
        const id = u.id ?? (await firstValueFrom(this.chat.ensureUser(u))).id;
        this.chat.sendMessage(content, id);
      } catch {
        failed.push(u.displayName);
      }
    }
    this.sending.set(false);
    if (failed.length) {
      this.error.set(`No se pudo enviar a: ${failed.join(', ')}.`);
      this.selected.update((list) => list.filter((u) => failed.includes(u.displayName)));
      return;
    }
    this.dialogOpen.set(false);
    this.flash(people.length === 1 ? `Enviado a ${people[0].displayName}` : `Enviado a ${people.length} personas`);
  }

  initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  }
}
