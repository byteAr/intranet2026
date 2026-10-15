import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import { CometSpinnerComponent } from '../../shared/comet-spinner/comet-spinner.component';

interface Sender {
  username: string;
  displayName: string;
  addedBy: string;
  addedAt: string;
}

interface UserHit {
  username: string;
  displayName: string;
}

/**
 * Administración → Anuncios (solo mlopez): a quién se le permite usar
 * "Enviar anuncio" y "Mensaje a todos". mlopez siempre puede.
 */
@Component({
  selector: 'app-broadcast-senders',
  standalone: true,
  imports: [CommonModule, DatePipe, CometSpinnerComponent],
  template: `
    <div class="max-w-3xl">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Quién puede enviar anuncios y mensajes a todos</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-zinc-400">
        Los usuarios de esta lista ven en el menú <strong>Mensaje a todos</strong> (un mensaje de Conversaciones a cada usuario)
        y <strong>Enviar anuncio</strong> (el cartel naranja y la campanita para todos). Vos siempre podés.
        A quien agregues o quites le aparece o desaparece al recargar la intranet o al volver a entrar.
      </p>

      <!-- Buscar y agregar -->
      <div class="relative mt-5">
        <input type="text" placeholder="Buscar un usuario por nombre, apellido o usuario…"
          (input)="search$.next($any($event.target).value)"
          [value]="query()"
          class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
        @if (searching()) {
          <div class="absolute right-3 top-2.5"><app-comet-spinner [size]="16" [thickness]="3" /></div>
        }
        @if (hits().length) {
          <ul class="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg">
            @for (h of hits(); track h.username) {
              <li>
                <button (click)="add(h)" [disabled]="isListed(h.username)"
                  class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-teal-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:hover:bg-transparent">
                  <span class="min-w-0">
                    <span class="block truncate text-gray-800 dark:text-zinc-100">{{ h.displayName }}</span>
                    <span class="block truncate text-xs text-gray-400 dark:text-zinc-500">{{ h.username }}</span>
                  </span>
                  <span class="flex-shrink-0 text-xs font-medium text-teal-600 dark:text-teal-400">
                    {{ isListed(h.username) ? 'Ya puede' : '+ Permitir' }}
                  </span>
                </button>
              </li>
            }
          </ul>
        }
      </div>
      @if (error()) {
        <p class="mt-2 text-sm text-red-600">{{ error() }}</p>
      }

      <!-- Lista -->
      <div class="mt-6 overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-700">
        <div class="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/60 px-4 py-3 text-sm">
          <span class="font-medium text-gray-800 dark:text-zinc-100">mlopez <span class="text-xs font-normal text-gray-400 dark:text-zinc-500">(vos)</span></span>
          <span class="text-xs text-gray-400 dark:text-zinc-500">Siempre puede</span>
        </div>
        @if (loading()) {
          <div class="flex justify-center py-6"><app-comet-spinner [size]="24" /></div>
        } @else {
          @for (s of senders(); track s.username) {
            <div class="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-zinc-700 last:border-b-0 px-4 py-3 text-sm">
              <div class="min-w-0">
                <p class="truncate font-medium text-gray-800 dark:text-zinc-100">{{ s.displayName }}
                  <span class="text-xs font-normal text-gray-400 dark:text-zinc-500">{{ s.username }}</span></p>
                <p class="text-xs text-gray-400 dark:text-zinc-500">Habilitado por {{ s.addedBy }} el {{ s.addedAt | date: 'dd/MM/yyyy HH:mm' }}</p>
              </div>
              <button (click)="remove(s)"
                class="flex-shrink-0 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20">
                Quitar
              </button>
            </div>
          } @empty {
            <p class="px-4 py-5 text-sm text-gray-400 dark:text-zinc-500">Todavía no habilitaste a nadie más.</p>
          }
        }
      </div>
    </div>
  `,
})
export class BroadcastSendersComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly senders = signal<Sender[]>([]);
  readonly loading = signal(true);
  readonly hits = signal<UserHit[]>([]);
  readonly searching = signal(false);
  readonly query = signal('');
  readonly error = signal<string | null>(null);
  readonly search$ = new Subject<string>();

  ngOnInit(): void {
    this.load();
    this.search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          this.query.set(q);
          if (q.trim().length < 2) {
            this.searching.set(false);
            return of([] as UserHit[]);
          }
          this.searching.set(true);
          return this.http
            .get<UserHit[]>('/api/users/search', { params: { q: q.trim() } })
            .pipe(catchError(() => of([] as UserHit[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((list) => {
        this.searching.set(false);
        this.hits.set(list.filter((h) => h.username.toLowerCase() !== 'mlopez').slice(0, 15));
      });
  }

  isListed(username: string): boolean {
    const u = username.toLowerCase();
    return this.senders().some((s) => s.username === u);
  }

  add(h: UserHit): void {
    if (this.isListed(h.username)) return;
    this.error.set(null);
    this.http.post('/api/broadcast-senders', { username: h.username, displayName: h.displayName }).subscribe({
      next: () => {
        this.hits.set([]);
        this.query.set('');
        this.search$.next(''); // si se vuelve a escribir lo mismo, que busque de nuevo
        this.load();
      },
      error: (err) => this.error.set(err?.error?.message ?? 'No se pudo agregar. Probá de nuevo.'),
    });
  }

  remove(s: Sender): void {
    if (!confirm(`¿Quitarle a ${s.displayName} el permiso para enviar anuncios y mensajes a todos?`)) return;
    this.error.set(null);
    this.http.delete(`/api/broadcast-senders/${encodeURIComponent(s.username)}`).subscribe({
      next: () => this.senders.update((list) => list.filter((x) => x.username !== s.username)),
      error: (err) => this.error.set(err?.error?.message ?? 'No se pudo quitar. Probá de nuevo.'),
    });
  }

  private load(): void {
    this.loading.set(true);
    this.http.get<Sender[]>('/api/broadcast-senders').subscribe({
      next: (list) => {
        this.senders.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('No se pudo cargar la lista.');
      },
    });
  }
}
