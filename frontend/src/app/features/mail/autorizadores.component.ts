import {
  Component,
  inject,
  signal,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DraftMailService, DraftMailAuthorizer } from '../../core/services/draft-mail.service';
import { ChatService, UserSearchResult } from '../../core/services/chat.service';

@Component({
  selector: 'app-autorizadores',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="max-w-2xl mx-auto space-y-6">

      <!-- Header -->
      <div class="bg-white rounded-2xl shadow-sm p-6 border border-gray-100">
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded-full flex items-center justify-center"
               style="background: linear-gradient(135deg, #14B8A5, #22C562)">
            <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900">Gestión de autorizadores MTOSAUTORIZADOS</h2>
            <p class="text-sm text-gray-500">Usuarios habilitados para revisar y aprobar borradores de correo</p>
          </div>
        </div>
      </div>

      <!-- Add authorizer -->
      <div class="bg-white rounded-2xl shadow-sm p-6 border border-gray-100 space-y-4">
        <h3 class="text-sm font-semibold text-gray-700">Agregar autorizador</h3>

        <div class="relative">
          <svg class="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearchChange($event)"
            type="text"
            placeholder="Buscar usuario por nombre o legajo..."
            class="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
        </div>

        @if (searchLoading()) {
          <p class="text-xs text-gray-400">Buscando...</p>
        } @else if (searchResults().length > 0) {
          <div class="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
            @for (user of searchResults(); track user.username) {
              <button (click)="addAuthorizer(user)"
                class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-teal-50 transition-colors text-left">
                @if (user.avatar) {
                  <img [src]="user.avatar" class="h-8 w-8 rounded-full object-cover flex-shrink-0" alt="" />
                } @else {
                  <span class="h-8 w-8 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {{ initials(user.displayName) }}
                  </span>
                }
                <div class="flex-1 min-w-0">
                  <p class="font-medium truncate">{{ user.displayName }}</p>
                  <p class="text-xs text-gray-400 truncate">{{ user.username }}</p>
                </div>
                @if (user.fromLdap) {
                  <span class="text-xs bg-blue-100 text-blue-600 rounded px-1.5 py-0.5 flex-shrink-0">AD</span>
                }
                @if (isAlreadyAuthorizer(user.username ?? '')) {
                  <span class="text-xs bg-teal-100 text-teal-700 rounded px-1.5 py-0.5 flex-shrink-0">Ya es autorizador</span>
                }
              </button>
            }
          </div>
        } @else if (searchQuery.length >= 2 && !searchLoading()) {
          <p class="text-xs text-gray-400">Sin resultados para "{{ searchQuery }}"</p>
        }

        @if (addError()) {
          <div class="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {{ addError() }}
          </div>
        }
      </div>

      <!-- Current authorizers list -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div class="px-6 py-4 border-b border-gray-100">
          <h3 class="text-sm font-semibold text-gray-700">
            Autorizadores actuales
            @if (!loading()) {
              <span class="ml-2 text-xs font-normal text-gray-400">({{ authorizers().length }})</span>
            }
          </h3>
        </div>

        @if (loading()) {
          <div class="flex items-center justify-center h-20">
            <span class="text-sm text-gray-400">Cargando...</span>
          </div>
        } @else if (authorizers().length === 0) {
          <div class="flex flex-col items-center justify-center h-24 text-gray-400">
            <p class="text-sm">No hay autorizadores configurados</p>
          </div>
        } @else {
          <div class="divide-y divide-gray-50">
            @for (auth of authorizers(); track auth.id) {
              <div class="flex items-center gap-3 px-6 py-3">
                <span class="h-9 w-9 rounded-full bg-teal-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {{ initials(auth.displayName) }}
                </span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-gray-800 truncate">{{ auth.displayName }}</p>
                  <p class="text-xs text-gray-400 truncate">
                    {{ auth.username }}
                    · Agregado por {{ auth.addedByName }}
                    · {{ auth.createdAt | date:'dd/MM/yy' }}
                  </p>
                </div>
                <button (click)="removeAuthorizer(auth)"
                  [disabled]="removing() === auth.userId"
                  class="flex-shrink-0 p-1.5 rounded-md text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-40">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            }
          </div>
        }
      </div>

    </div>
  `,
})
export class AutorizadoresComponent implements OnInit {
  private readonly draftMailService = inject(DraftMailService);
  private readonly chatService = inject(ChatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly adding = signal(false);
  readonly removing = signal<string | null>(null);
  readonly authorizers = signal<DraftMailAuthorizer[]>([]);

  readonly searchLoading = signal(false);
  readonly searchResults = signal<UserSearchResult[]>([]);
  readonly addError = signal<string | null>(null);
  searchQuery = '';

  private readonly searchSubject = new Subject<string>();

  ngOnInit(): void {
    this.loadAuthorizers();

    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) => {
        if (q.length < 2) { this.searchLoading.set(false); return of([]); }
        this.searchLoading.set(true);
        return this.chatService.searchUsers(q);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (results) => { this.searchResults.set(results); this.searchLoading.set(false); },
      error: () => { this.searchResults.set([]); this.searchLoading.set(false); },
    });
  }

  loadAuthorizers(): void {
    this.loading.set(true);
    this.draftMailService.getAuthorizers().subscribe({
      next: (list) => { this.authorizers.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  onSearchChange(q: string): void {
    if (q.length < 2) { this.searchResults.set([]); this.searchLoading.set(false); }
    this.searchSubject.next(q);
  }

  isAlreadyAuthorizer(username: string): boolean {
    return this.authorizers().some((a) => a.username === username);
  }

  addAuthorizer(user: UserSearchResult): void {
    if (!user.id || this.isAlreadyAuthorizer(user.username ?? '')) return;
    this.addError.set(null);
    this.adding.set(true);
    this.draftMailService.addAuthorizer(user.id, user.username ?? '', user.displayName).subscribe({
      next: (added) => {
        this.adding.set(false);
        this.authorizers.update((list) => [...list, added]);
        this.searchQuery = '';
        this.searchResults.set([]);
      },
      error: (err: { error?: { message?: string } }) => {
        this.adding.set(false);
        this.addError.set(err?.error?.message ?? 'Error al agregar el autorizador');
      },
    });
  }

  removeAuthorizer(auth: DraftMailAuthorizer): void {
    if (!confirm(`¿Quitar a ${auth.displayName} como autorizador?`)) return;
    this.removing.set(auth.userId);
    this.draftMailService.removeAuthorizer(auth.userId).subscribe({
      next: () => {
        this.removing.set(null);
        this.authorizers.update((list) => list.filter((a) => a.userId !== auth.userId));
      },
      error: () => this.removing.set(null),
    });
  }

  initials(name: string): string {
    const parts = (name ?? '').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] ?? '?').toUpperCase();
  }
}
