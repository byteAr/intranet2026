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
import { DraftMailService, DraftMailAuthorizer, DraftMailDirector } from '../../core/services/draft-mail.service';
import { ChatService, UserSearchResult } from '../../core/services/chat.service';
import { AuthService } from '../../core/services/auth.service';

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

      <!-- Sección Director (solo visible para mlopez) -->
      @if (isMlopez()) {
        <div class="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
          <div class="px-6 py-4 border-b border-amber-100 flex items-center gap-2"
               style="background: linear-gradient(135deg, #fffbeb, #fef3c7)">
            <svg class="h-5 w-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            <div>
              <h3 class="text-sm font-bold text-amber-800">Director de Educación e Institutos</h3>
              <p class="text-xs text-amber-600">Usuario con permisos de superAprobador — puede aprobar, delegar y gestionar autorizadores</p>
            </div>
          </div>

          <div class="p-6 space-y-4">
            @if (directorLoading()) {
              <div class="flex items-center justify-center h-12">
                <svg class="h-5 w-5 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                </svg>
              </div>
            } @else if (director()) {
              <!-- Director actual -->
              <div class="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-100">
                <span class="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                      style="background: linear-gradient(135deg, #d97706, #b45309)">
                  {{ initials(director()!.displayName) }}
                </span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-gray-900 truncate">{{ director()!.displayName }}</p>
                  <p class="text-xs text-gray-500 truncate">
                    {{ director()!.username }}
                    · Designado por {{ director()!.setByName }}
                    · {{ director()!.createdAt | date:'dd/MM/yy' }}
                  </p>
                </div>
                <button (click)="removeDirector()"
                  [disabled]="directorRemoving()"
                  title="Quitar director"
                  class="flex-shrink-0 p-1.5 rounded-md text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-40">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p class="text-xs text-gray-400">Para reemplazar al director, primero quitá el actual y luego buscá y designá al nuevo.</p>
            } @else {
              <!-- Sin director designado -->
              <div class="text-sm text-gray-500 mb-3">
                No hay ningún director designado. Buscá un usuario para asignarlo.
              </div>

              <div class="relative">
                <svg class="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  [(ngModel)]="directorSearchQuery"
                  (ngModelChange)="onDirectorSearchChange($event)"
                  type="text"
                  placeholder="Buscar usuario para designar como director..."
                  class="w-full pl-9 pr-3 py-2 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
              </div>

              @if (directorSearchLoading()) {
                <p class="text-xs text-gray-400">Buscando...</p>
              } @else if (directorSearchResults().length > 0) {
                <div class="border border-amber-200 rounded-lg overflow-hidden divide-y divide-amber-100">
                  @for (user of directorSearchResults(); track user.username) {
                    <button (click)="setDirector(user)"
                      [disabled]="directorSaving()"
                      class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-amber-50 transition-colors text-left disabled:opacity-50">
                      @if (user.avatar) {
                        <img [src]="user.avatar" class="h-8 w-8 rounded-full object-cover flex-shrink-0" alt="" />
                      } @else {
                        <span class="h-8 w-8 rounded-full bg-amber-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
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
                    </button>
                  }
                </div>
              } @else if (directorSearchQuery.length >= 2 && !directorSearchLoading()) {
                <p class="text-xs text-gray-400">Sin resultados para "{{ directorSearchQuery }}"</p>
              }

              @if (directorError()) {
                <div class="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {{ directorError() }}
                </div>
              }
            }
          </div>
        </div>
      }

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
            <svg class="h-8 w-8 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" style="color: #0d9488" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="url(#spinner-grad)" stroke-width="3" stroke-linecap="round" />
              <defs><linearGradient id="spinner-grad" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0d9488"/><stop offset="1" stop-color="#166534"/></linearGradient></defs>
            </svg>
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
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // Authorizers state
  readonly loading = signal(false);
  readonly adding = signal(false);
  readonly removing = signal<string | null>(null);
  readonly authorizers = signal<DraftMailAuthorizer[]>([]);
  readonly searchLoading = signal(false);
  readonly searchResults = signal<UserSearchResult[]>([]);
  readonly addError = signal<string | null>(null);
  searchQuery = '';

  // Director state
  readonly director = signal<DraftMailDirector | null>(null);
  readonly directorLoading = signal(false);
  readonly directorSaving = signal(false);
  readonly directorRemoving = signal(false);
  readonly directorSearchLoading = signal(false);
  readonly directorSearchResults = signal<UserSearchResult[]>([]);
  readonly directorError = signal<string | null>(null);
  directorSearchQuery = '';

  private readonly searchSubject = new Subject<string>();
  private readonly directorSearchSubject = new Subject<string>();

  isMlopez(): boolean {
    return this.authService.currentUser()?.username?.toLowerCase() === 'mlopez';
  }

  ngOnInit(): void {
    this.loadAuthorizers();
    if (this.isMlopez()) {
      this.loadDirector();
    }

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

    this.directorSearchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) => {
        if (q.length < 2) { this.directorSearchLoading.set(false); return of([]); }
        this.directorSearchLoading.set(true);
        return this.chatService.searchUsers(q);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (results) => { this.directorSearchResults.set(results); this.directorSearchLoading.set(false); },
      error: () => { this.directorSearchResults.set([]); this.directorSearchLoading.set(false); },
    });
  }

  loadDirector(): void {
    this.directorLoading.set(true);
    this.draftMailService.getDirector().subscribe({
      next: (d) => { this.director.set(d); this.directorLoading.set(false); },
      error: () => this.directorLoading.set(false),
    });
  }

  onDirectorSearchChange(q: string): void {
    if (q.length < 2) { this.directorSearchResults.set([]); this.directorSearchLoading.set(false); }
    this.directorSearchSubject.next(q);
  }

  setDirector(user: UserSearchResult): void {
    if (!user.id) return;
    if (!confirm(`¿Designar a ${user.displayName} como Director de Educación e Institutos?`)) return;
    this.directorError.set(null);
    this.directorSaving.set(true);
    this.draftMailService.setDirector(user.id, user.username ?? '', user.displayName).subscribe({
      next: (d) => {
        this.directorSaving.set(false);
        this.director.set(d);
        this.directorSearchQuery = '';
        this.directorSearchResults.set([]);
      },
      error: (err: { error?: { message?: string } }) => {
        this.directorSaving.set(false);
        this.directorError.set(err?.error?.message ?? 'Error al designar al director');
      },
    });
  }

  removeDirector(): void {
    const d = this.director();
    if (!d) return;
    if (!confirm(`¿Quitar a ${d.displayName} como Director de Educación e Institutos?\n\nEl usuario perderá los permisos de superAprobador.`)) return;
    this.directorRemoving.set(true);
    this.draftMailService.removeDirector().subscribe({
      next: () => { this.directorRemoving.set(false); this.director.set(null); },
      error: () => this.directorRemoving.set(false),
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
