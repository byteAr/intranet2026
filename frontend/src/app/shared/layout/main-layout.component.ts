import { Component, inject, signal, computed, OnInit, OnDestroy, HostListener, DestroyRef } from '@angular/core';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, filter, Subscription, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/services/auth.service';
import { ChatService, UserSearchResult } from '../../core/services/chat.service';
import { IncidentsService } from '../../core/services/incidents.service';
import { ReservationsService } from '../../core/services/reservations.service';
import { PushNotificationService } from '../../core/services/push.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="flex h-screen bg-gray-100">
      <!-- Sidebar -->
      <aside class="flex flex-col transition-all duration-300"
             [class.w-64]="!collapsed()"
             [class.w-16]="collapsed()"
             style="background: white; border-right: 1px solid #e5e7eb">

        <!-- Logo -->
        <div class="relative flex items-center justify-center px-4 py-3 flex-shrink-0"
             style="background: white; border-bottom: 1px solid #e5e7eb; min-height: 5rem">
          @if (!collapsed()) {
            <img src="assets/images/diredtosintranet.png" class="h-24 object-contain" alt="Diredtos" />
          }
          <button (click)="collapsed.set(!collapsed())"
            class="absolute right-3 p-1.5 rounded-md transition-colors flex-shrink-0 text-gray-500 hover:bg-gray-100"
            [attr.aria-label]="collapsed() ? 'Expandir menú' : 'Contraer menú'">
            <svg class="h-5 w-5 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              @if (collapsed()) {
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              } @else {
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
              }
            </svg>
          </button>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 px-2 py-4 space-y-1 overflow-y-auto">

          <!-- Cuenta -->
          <a routerLink="/cuenta" routerLinkActive="active-nav"
            class="nav-item flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors group"
            [title]="collapsed() ? 'Cuenta' : ''">
            <svg class="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            @if (!collapsed()) {
              <span class="ml-3">Cuenta</span>
            }
          </a>

          <!-- Conversaciones -->
          <a routerLink="/chat" routerLinkActive="active-nav"
            class="nav-item flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors group relative"
            [title]="collapsed() ? 'Conversaciones' : ''">
            <svg class="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            @if (!collapsed()) {
              <span class="ml-3 flex-1">Conversaciones</span>
              @if (chatService.unreadCount() > 0 && !isOnChatPage()) {
                <span class="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                  {{ chatService.unreadCount() }}
                </span>
              }
            } @else if (chatService.unreadCount() > 0 && !isOnChatPage()) {
              <span class="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
            }
          </a>

          <!-- Ayuda técnica -->
          <a routerLink="/incidencias" routerLinkActive="active-nav"
            class="nav-item flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors group relative"
            [title]="collapsed() ? 'Ayuda técnica' : ''">
            <svg class="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
            @if (!collapsed()) {
              <span class="ml-3 flex-1">Ayuda técnica</span>
              @if (incidentsService.pendingCount() > 0) {
                <span class="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                  {{ incidentsService.pendingCount() }}
                </span>
              }
            } @else if (incidentsService.pendingCount() > 0) {
              <span class="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
            }
          </a>

          <!-- Reservas -->
          <a routerLink="/reservas" routerLinkActive="active-nav"
            class="nav-item flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors group relative"
            [title]="collapsed() ? 'Reservas' : ''">
            <svg class="h-5 w-5 flex-shrink-0" viewBox="0 0 1024 640" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
              <path d="M896 576h-64q0 26-18.5 45t-45 19t-45.5-19t-19-45H320q0 26-18.5 45t-45 19t-45.5-19t-19-45h-64q-53 0-90.5-37.5T0 448V256q0-53 37.5-90.5T128 128h22q27-58 81.5-93T352 0t120.5 35t81.5 93h342q53 0 90.5 37.5T1024 256v192q0 53-37.5 90.5T896 576M352 64q-66 0-113 47t-47 113t47 113t113 47t113-47t47-113t-47-113t-113-47m384 192q-13 0-22.5 9.5T704 288t9.5 22.5T736 320t22.5-9.5T768 288t-9.5-22.5T736 256m128 0q-13 0-22.5 9.5T832 288t9.5 22.5T864 320t22.5-9.5T896 288t-9.5-22.5T864 256"/>
            </svg>
            @if (!collapsed()) {
              <span class="ml-3 flex-1">Reservas</span>
              @if (reservationsService.pendingCount() > 0) {
                <span class="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                  {{ reservationsService.pendingCount() }}
                </span>
              }
            } @else if (reservationsService.pendingCount() > 0) {
              <span class="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
            }
          </a>

        </nav>

        <!-- User info + logout -->
        <div class="p-4 flex-shrink-0" style="border-top: 1px solid #e5e7eb">
          @if (!collapsed()) {
            <div class="flex items-center space-x-3 mb-3">
              <div class="h-9 w-9 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                   style="background: #22C562">
                @if (authService.currentUser()?.avatar) {
                  <img [src]="authService.currentUser()!.avatar" class="h-full w-full object-cover" alt="" />
                } @else {
                  {{ userInitials() }}
                }
              </div>
              <div class="overflow-hidden">
                <p class="text-sm font-medium truncate text-gray-800">{{ authService.currentUser()?.displayName }}</p>
                <p class="text-xs truncate text-gray-400">{{ authService.currentUser()?.username }}</p>
              </div>
            </div>
          }
          <button (click)="authService.logout()"
            class="flex items-center w-full px-3 py-2 text-sm rounded-md transition-colors"
            style="color: #6b7280"
            onmouseover="this.style.background='#f3f4f6';this.style.color='#111827'"
            onmouseout="this.style.background='';this.style.color='#6b7280'">
            <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            @if (!collapsed()) {
              <span class="ml-2">Cerrar sesión</span>
            }
          </button>
        </div>
      </aside>

      <!-- Main content -->
      <div class="flex flex-col flex-1 overflow-hidden">

        <!-- Page content -->
        <main class="flex-1 overflow-y-auto px-4 pt-20 pb-8">
          <router-outlet />
        </main>
      </div>
    </div>

    <!-- Floating chat button -->
    <div class="fixed bottom-6 right-6 z-50">
      <!-- Popup -->
      @if (chatPopupOpen()) {
        <div class="absolute bottom-16 right-0 w-72 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden mb-2">
          <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between"
               style="background: #0f766e">
            <span class="text-sm font-semibold text-white">Conversaciones</span>
            <span class="text-xs text-teal-200">{{ onlineContacts().length }} en línea</span>
          </div>
          <div class="max-h-60 overflow-y-auto py-1">
            @if (onlineContacts().length === 0) {
              <p class="text-xs text-gray-400 px-4 py-3 text-center">Nadie más en línea</p>
            }
            @for (contact of onlineContacts(); track contact.id) {
              <button
                (click)="openDM(contact.id)"
                class="w-full flex items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <span class="relative mr-2.5 flex-shrink-0">
                  @if (contact.avatar) {
                    <img [src]="contact.avatar" class="h-8 w-8 rounded-full object-cover" alt="" />
                  } @else {
                    <span class="h-8 w-8 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold">
                      {{ contactInitials(contact.displayName) }}
                    </span>
                  }
                  <span class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-white"></span>
                </span>
                <span class="flex-1 text-left">{{ contact.displayName }}</span>
                @if ((chatService.unreadCounts()[contact.id] ?? 0) > 0) {
                  <span class="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none ml-2">
                    {{ chatService.unreadCounts()[contact.id] }}
                  </span>
                }
              </button>
            }
          </div>
          <!-- Nueva conversación desde popup -->
          <div class="border-t border-gray-100 px-3 py-2">
            @if (!popupNewConvOpen()) {
              <button (click)="openPopupNewConv($event)"
                class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors font-medium">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                Nueva conversación
              </button>
            } @else {
              <div class="space-y-1">
                <div class="flex items-center gap-1">
                  <input
                    [(ngModel)]="popupSearchQuery"
                    (ngModelChange)="onPopupSearchChange($event)"
                    (click)="$event.stopPropagation()"
                    type="text"
                    placeholder="Buscar usuario..."
                    class="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                  <button (click)="closePopupNewConv()" class="p-1.5 text-gray-400 hover:text-gray-600">
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                @if (popupSearchLoading()) {
                  <p class="text-xs text-gray-400 px-2 py-1">Buscando...</p>
                } @else if (popupSearchResults().length > 0) {
                  <div class="rounded-md border border-gray-200 overflow-hidden">
                    @for (user of popupSearchResults(); track user.username) {
                      <button (click)="openDMFromSearch(user)"
                        class="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-teal-50 transition-colors">
                        @if (user.avatar) {
                          <img [src]="user.avatar" class="h-7 w-7 rounded-full object-cover flex-shrink-0" alt="" />
                        } @else {
                          <span class="h-7 w-7 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {{ contactInitials(user.displayName) }}
                          </span>
                        }
                        <span class="flex-1 truncate text-left">{{ user.displayName }}</span>
                        @if (user.fromLdap) {
                          <span class="text-xs bg-blue-100 text-blue-600 rounded px-1 leading-none py-0.5 flex-shrink-0">AD</span>
                        }
                      </button>
                    }
                  </div>
                } @else if (popupSearchQuery.length >= 2) {
                  <p class="text-xs text-gray-400 px-2 py-1">Sin resultados</p>
                }
              </div>
            }
          </div>
          <div class="border-t border-gray-100">
            <button
              (click)="openFullChat()"
              class="w-full px-4 py-2.5 text-sm font-medium text-teal-700 hover:bg-teal-50 transition-colors flex items-center justify-center space-x-1">
              <span>Abrir conversaciones</span>
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      }

      <!-- Toggle button -->
      <button
        (click)="toggleChatPopup()"
        class="h-14 w-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-105 relative"
        style="background: #0f766e">
        <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        @if (chatService.unreadCount() > 0 && !isOnChatPage()) {
          <span class="absolute -top-1 -right-1 h-4 w-4 bg-red-500 rounded-full border-2 border-white"></span>
        }
      </button>
    </div>
  `,
  styles: [`
    .nav-item { color: #374151; }
    .nav-item:hover { background: #f3f4f6; color: #111827; }
    .active-nav { background: #0f766e !important; color: white !important; font-weight: 600; }
  `],
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  readonly authService = inject(AuthService);
  readonly chatService = inject(ChatService);
  readonly incidentsService = inject(IncidentsService);
  readonly reservationsService = inject(ReservationsService);
  private readonly pushService = inject(PushNotificationService);
  private readonly router = inject(Router);

  private readonly destroyRef = inject(DestroyRef);

  readonly collapsed = signal(false);
  readonly pageTitle = signal('Mi cuenta');
  readonly chatPopupOpen = signal(false);
  readonly isOnChatPage = signal(false);
  private routerSub?: Subscription;

  // Nueva conversación desde popup
  readonly popupNewConvOpen = signal(false);
  readonly popupSearchResults = signal<UserSearchResult[]>([]);
  readonly popupSearchLoading = signal(false);
  popupSearchQuery = '';
  private readonly popupSearchSubject = new Subject<string>();

  readonly fullName = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return '';
    if (user.firstName || user.lastName) return [user.firstName, user.lastName].filter(Boolean).join(' ');
    return user.displayName;
  });

  readonly onlineContacts = computed(() => {
    const currentId = this.authService.currentUser()?.id;
    return this.chatService.onlineUsers().filter((u) => u.id !== currentId);
  });

  ngOnInit(): void {
    this.chatService.connect();
    void this.pushService.subscribe();
    this.incidentsService.connect();
    this.incidentsService.loadIncidents(this.incidentsService.isTicom ? false : true);
    this.reservationsService.connect();
    this.reservationsService.loadReservations(this.reservationsService.hasPrivilegedView ? false : true);
    this.isOnChatPage.set(this.router.url.startsWith('/chat'));
    this.routerSub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.isOnChatPage.set((e as NavigationEnd).urlAfterRedirects.startsWith('/chat'));
      });

    this.popupSearchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) => {
        if (q.length < 2) { this.popupSearchLoading.set(false); return of([]); }
        this.popupSearchLoading.set(true);
        return this.chatService.searchUsers(q);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (results) => { this.popupSearchResults.set(results); this.popupSearchLoading.set(false); },
      error: () => { this.popupSearchResults.set([]); this.popupSearchLoading.set(false); },
    });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
  }

  toggleChatPopup(): void {
    this.chatPopupOpen.update((v) => !v);
  }

  openDM(userId: string): void {
    this.chatPopupOpen.set(false);
    this.chatService.selectConversation(userId);
    void this.router.navigate(['/chat']);
  }

  openFullChat(): void {
    this.chatPopupOpen.set(false);
    void this.router.navigate(['/chat']);
  }

  openPopupNewConv(event: MouseEvent): void {
    event.stopPropagation();
    this.popupNewConvOpen.set(true);
    this.popupSearchQuery = '';
    this.popupSearchResults.set([]);
  }

  closePopupNewConv(): void {
    this.popupNewConvOpen.set(false);
    this.popupSearchQuery = '';
    this.popupSearchResults.set([]);
  }

  onPopupSearchChange(q: string): void {
    if (q.length < 2) { this.popupSearchResults.set([]); this.popupSearchLoading.set(false); }
    this.popupSearchSubject.next(q);
  }

  openDMFromSearch(user: UserSearchResult): void {
    if (user.fromLdap && !user.id) {
      this.chatService.ensureUser(user).subscribe((resolved) => {
        this._openDMForUser({ ...user, id: resolved.id, displayName: resolved.displayName, avatar: resolved.avatar });
      });
    } else if (user.id) {
      this._openDMForUser(user as UserSearchResult & { id: string });
    }
  }

  private _openDMForUser(user: UserSearchResult & { id: string }): void {
    const names = { ...this.chatService.userNames() };
    names[user.id] = user.displayName;
    this.chatService.userNames.set(names);
    if (user.avatar) {
      const avatars = { ...this.chatService.userAvatars() };
      avatars[user.id] = user.avatar;
      this.chatService.userAvatars.set(avatars);
    }
    this.chatService.conversationContactIds.update((ids) => new Set([...ids, user.id]));
    this.closePopupNewConv();
    this.openDM(user.id);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.fixed.bottom-6.right-6')) {
      this.chatPopupOpen.set(false);
    }
  }

  contactInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] ?? '?').toUpperCase();
  }

  userInitials(): string {
    const user = this.authService.currentUser();
    if (!user) return '?';
    return (user.displayName ?? user.username)
      .split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  }
}
