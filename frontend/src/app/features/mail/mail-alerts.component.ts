import { Component, HostListener, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AlertTerm, FollowedMto, MailService } from '../../core/services/mail.service';

/** Megáfono (seguir un MTO / alertas). */
export const MEGAPHONE_PATH = 'M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM16 8a5 5 0 010 8M19 5a9 9 0 010 14';

/**
 * "Mis alertas" (09/10/2026): cada usuario carga términos (DNI, nombre y
 * apellido, código estadístico, expediente, una frase) y le llega un aviso a
 * la campanita cuando entra un MTO que los contiene. En la otra pestaña, los
 * MTO que sigue con el megáfono, para dejar de seguirlos.
 */
@Component({
  selector: 'app-mail-alerts',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" (click)="closed.emit()">
      <div class="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl"
           (click)="$event.stopPropagation()" role="dialog" aria-labelledby="mail-alerts-title">
        <!-- Encabezado -->
        <div class="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-zinc-800">
          <div class="flex items-start gap-3">
            <span class="h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center bg-teal-50 text-teal-700">
              <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="MEGAPHONE_PATH" /></svg>
            </span>
            <div>
              <h3 id="mail-alerts-title" class="text-sm font-semibold text-gray-900">Mis alertas</h3>
              <p class="text-xs text-gray-500 leading-relaxed">Te avisamos en la campanita cuando llega un MTO con lo que cargues acá o relacionado con uno que seguís.</p>
            </div>
          </div>
          <button (click)="closed.emit()" class="text-gray-400 hover:text-gray-700" aria-label="Cerrar">✕</button>
        </div>

        <!-- Pestañas -->
        <div class="flex gap-1 px-5 pt-3" role="tablist">
          <button role="tab" (click)="tab.set('terms')" [attr.aria-selected]="tab() === 'terms'"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            [class.bg-teal-600]="tab() === 'terms'" [class.text-white]="tab() === 'terms'"
            [class.text-gray-600]="tab() !== 'terms'" [class.hover:bg-gray-100]="tab() !== 'terms'">
            Términos{{ terms().length ? ' (' + terms().length + ')' : '' }}
          </button>
          <button role="tab" (click)="openFollows()" [attr.aria-selected]="tab() === 'follows'"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            [class.bg-teal-600]="tab() === 'follows'" [class.text-white]="tab() === 'follows'"
            [class.text-gray-600]="tab() !== 'follows'" [class.hover:bg-gray-100]="tab() !== 'follows'">
            MTO que sigo{{ follows() ? ' (' + follows()!.length + ')' : '' }}
          </button>
        </div>

        @if (error()) {
          <p class="mx-5 mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{{ error() }}</p>
        }

        @if (tab() === 'terms') {
          <!-- Agregar -->
          <form class="px-5 pt-3 pb-3 border-b border-gray-100 dark:border-zinc-800" (ngSubmit)="add()">
            <div class="flex gap-2">
              <input [(ngModel)]="newTerm" name="newTerm" maxlength="200" autocomplete="off"
                placeholder="Ej.: 29465318, Sergio Benitez, expediente 4531/2026…"
                class="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              <button type="submit" [disabled]="busy() || newTerm.trim().length < 3"
                class="px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50">Agregar</button>
            </div>
            <label class="mt-2 flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" [(ngModel)]="newAllWords" name="newAllWords" class="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
              Todas las palabras, en cualquier orden <span class="text-gray-400">(si no, la frase tal cual)</span>
            </label>
            <p class="mt-1.5 text-[11px] text-gray-400 leading-relaxed">
              Se busca en el asunto, el texto y los nombres de los adjuntos. No importan las tildes ni las mayúsculas, y en los números
              tampoco los puntos: 29465318 encuentra 29.465.318.
            </p>
          </form>

          <!-- Lista -->
          <ul class="flex-1 overflow-y-auto py-1">
            @for (t of terms(); track t.id) {
              <li class="flex items-center gap-3 px-5 py-2 hover:bg-gray-50">
                @if (editingId() === t.id) {
                  <div class="flex-1 min-w-0">
                    <input [(ngModel)]="editTerm" [name]="'edit-' + t.id" maxlength="200" (keydown.enter)="saveEdit(t)" (keydown.escape)="editingId.set(null)"
                      class="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                    <label class="mt-1 flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none">
                      <input type="checkbox" [(ngModel)]="editAllWords" [name]="'editall-' + t.id" class="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                      Todas las palabras, en cualquier orden
                    </label>
                  </div>
                  <button (click)="saveEdit(t)" [disabled]="busy() || editTerm.trim().length < 3"
                    class="px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50">Guardar</button>
                  <button (click)="editingId.set(null)" class="text-xs text-gray-500 hover:text-gray-800">Cancelar</button>
                } @else {
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-gray-900">{{ t.term }}</span>
                    <span class="block text-[11px] text-gray-500">{{ t.allWords ? 'Todas las palabras, en cualquier orden' : 'La frase tal cual' }}</span>
                  </span>
                  <button (click)="startEdit(t)" title="Editar" aria-label="Editar"
                    class="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
                  </button>
                  <button (click)="remove(t)" title="Borrar" aria-label="Borrar"
                    class="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                  </button>
                }
              </li>
            } @empty {
              @if (!loading()) {
                <li class="px-5 py-8 text-center text-sm text-gray-500">
                  Todavía no cargaste términos.<br />
                  <span class="text-xs text-gray-400">Por ejemplo: tu DNI, tu nombre y apellido, tu código estadístico o un número de expediente.</span>
                </li>
              }
            }
          </ul>
        } @else {
          <!-- MTO que sigo -->
          <ul class="flex-1 overflow-y-auto py-1 mt-2">
            @for (f of follows() ?? []; track f.emailId) {
              <li class="flex items-center gap-3 px-5 py-2 hover:bg-gray-50">
                <button (click)="open.emit(f.emailId); closed.emit()" class="min-w-0 flex-1 text-left" [title]="'Abrir ' + (f.mailCode ?? f.subject)">
                  <span class="block truncate text-sm font-medium text-gray-900">{{ f.mailCode ?? f.subject }}</span>
                  <span class="block truncate text-[11px] text-gray-500">
                    {{ f.mailCode ? f.subject + ' · ' : '' }}{{ f.manual ? 'lo seguís' : 'citaba a uno que seguís' }}
                  </span>
                </button>
                <button (click)="unfollow(f)" [disabled]="busy()"
                  class="px-2.5 py-1 rounded-lg text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50">Dejar de seguir</button>
              </li>
            } @empty {
              @if (follows() !== null) {
                <li class="px-5 py-8 text-center text-sm text-gray-500">
                  No seguís ningún MTO.<br />
                  <span class="text-xs text-gray-400">Abrí un MTO y tocá «Seguir», al lado de Compartir, para que te avisen cuando llegue uno que lo cite.</span>
                </li>
              }
            }
          </ul>
        }
      </div>
    </div>
  `,
})
export class MailAlertsComponent {
  private readonly mail = inject(MailService);

  readonly closed = output<void>();
  /** Abrir un MTO de la lista de seguidos. */
  readonly open = output<string>();
  /** Se dejó de seguir un MTO (por si es el que está abierto). */
  readonly unfollowed = output<string>();

  readonly MEGAPHONE_PATH = MEGAPHONE_PATH;
  readonly tab = signal<'terms' | 'follows'>('terms');
  readonly terms = signal<AlertTerm[]>([]);
  readonly follows = signal<FollowedMto[] | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);

  newTerm = '';
  newAllWords = false;
  editTerm = '';
  editAllWords = false;

  constructor() {
    this.mail.alertTerms().subscribe({
      next: (list) => { this.terms.set(list); this.loading.set(false); },
      error: (err: HttpErrorResponse) => this.fail(err),
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.editingId()) this.editingId.set(null);
    else this.closed.emit();
  }

  private fail(err: HttpErrorResponse): void {
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(err.error?.message ?? 'No se pudo completar. Probá de nuevo.');
  }

  add(): void {
    const term = this.newTerm.trim();
    if (term.length < 3 || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.mail.addAlertTerm(term, this.newAllWords).subscribe({
      next: (t) => {
        this.terms.update((list) => [...list, t]);
        this.newTerm = '';
        this.newAllWords = false;
        this.busy.set(false);
      },
      error: (err: HttpErrorResponse) => this.fail(err),
    });
  }

  startEdit(t: AlertTerm): void {
    this.editingId.set(t.id);
    this.editTerm = t.term;
    this.editAllWords = t.allWords;
    this.error.set(null);
  }

  saveEdit(t: AlertTerm): void {
    const term = this.editTerm.trim();
    if (term.length < 3 || this.busy()) return;
    this.busy.set(true);
    this.mail.updateAlertTerm(t.id, term, this.editAllWords).subscribe({
      next: (updated) => {
        this.terms.update((list) => list.map((x) => (x.id === t.id ? updated : x)));
        this.editingId.set(null);
        this.busy.set(false);
      },
      error: (err: HttpErrorResponse) => this.fail(err),
    });
  }

  remove(t: AlertTerm): void {
    this.busy.set(true);
    this.mail.removeAlertTerm(t.id).subscribe({
      next: () => {
        this.terms.update((list) => list.filter((x) => x.id !== t.id));
        this.busy.set(false);
      },
      error: (err: HttpErrorResponse) => this.fail(err),
    });
  }

  openFollows(): void {
    this.tab.set('follows');
    this.mail.followedMtos().subscribe({
      next: (list) => this.follows.set(list),
      error: (err: HttpErrorResponse) => this.fail(err),
    });
  }

  unfollow(f: FollowedMto): void {
    this.busy.set(true);
    this.mail.unfollow(f.emailId).subscribe({
      next: () => {
        this.follows.update((list) => (list ?? []).filter((x) => x.emailId !== f.emailId));
        this.unfollowed.emit(f.emailId);
        this.busy.set(false);
      },
      error: (err: HttpErrorResponse) => this.fail(err),
    });
  }
}
