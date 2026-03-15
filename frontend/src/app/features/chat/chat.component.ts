import {
  Component,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChatService, ChatMessage, UserSearchResult } from '../../core/services/chat.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-[calc(100vh-8rem)] bg-white rounded-xl shadow overflow-hidden">

      <!-- Sidebar: conversations -->
      <aside class="w-64 flex-shrink-0 border-r border-gray-200 flex flex-col">
        <div class="px-4 py-3 border-b border-gray-200">
          <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">Conversaciones</h2>
        </div>
        <div class="flex-1 overflow-y-auto py-2">

          <!-- Nueva conversación -->
          <div class="px-3 pt-2 pb-1">
            @if (!newConvOpen()) {
              <button (click)="openNewConv()"
                class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors font-medium">
                <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                Nueva conversación
              </button>
            } @else {
              <div class="space-y-1">
                <div class="flex items-center gap-1">
                  <input #searchInput
                    [(ngModel)]="searchQuery"
                    (ngModelChange)="onSearchChange($event)"
                    type="text"
                    placeholder="Buscar usuario..."
                    class="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                  <button (click)="closeNewConv()" class="p-1.5 text-gray-400 hover:text-gray-600">
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                @if (searchLoading()) {
                  <p class="text-xs text-gray-400 px-2 py-1">Buscando...</p>
                } @else if (searchResults().length > 0) {
                  <div class="rounded-md border border-gray-200 overflow-hidden">
                    @for (user of searchResults(); track user.username) {
                      <button (click)="startNewConv(user)"
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
                } @else if (searchQuery.length >= 2) {
                  <p class="text-xs text-gray-400 px-2 py-1">Sin resultados</p>
                }
              </div>
            }
          </div>

          <!-- All known contacts (online first, then offline) -->
          @if (allContacts().length > 0) {
            <div class="px-4 pt-3 pb-1">
              <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Usuarios</p>
            </div>
            @for (contact of allContacts(); track contact.id) {
              <button
                (click)="selectConversation(contact.id)"
                class="w-full flex items-center px-4 py-2 text-sm transition-colors"
                [class.bg-teal-50]="chatService.activeRecipientId() === contact.id"
                [class.text-teal-700]="chatService.activeRecipientId() === contact.id"
                [class.font-semibold]="chatService.activeRecipientId() === contact.id"
                [class.text-gray-700]="chatService.activeRecipientId() !== contact.id"
                [class.hover:bg-gray-50]="chatService.activeRecipientId() !== contact.id">
                <!-- Avatar or initials -->
                <span class="relative mr-2.5 flex-shrink-0">
                  @if (contact.avatar) {
                    <img [src]="contact.avatar" class="h-8 w-8 rounded-full object-cover" alt="" />
                  } @else {
                    <span class="h-8 w-8 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold">
                      {{ contactInitials(contact.name) }}
                    </span>
                  }
                  <!-- Online/offline dot -->
                  <span class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white"
                    [class.bg-green-500]="contact.isOnline"
                    [class.bg-red-400]="!contact.isOnline"></span>
                </span>
                <!-- Name + status label -->
                <span class="flex-1 text-left min-w-0">
                  <span class="block truncate leading-tight">{{ contact.name }}</span>
                  @if (contact.isOnline) {
                    <span class="block text-xs text-gray-300 leading-tight">En línea</span>
                  }
                </span>
                @if ((chatService.unreadCounts()[contact.id] ?? 0) > 0) {
                  <span class="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none ml-1">
                    {{ chatService.unreadCounts()[contact.id] }}
                  </span>
                }
              </button>
            }
          }
        </div>
      </aside>

      <!-- Chat thread -->
      <div class="flex-1 flex flex-col">

        <!-- Thread header -->
        <div class="px-5 py-3 border-b border-gray-200 flex items-center space-x-2 flex-shrink-0">
          @if (chatService.activeRecipientId() !== null) {
            @if (activeContactAvatar()) {
              <img [src]="activeContactAvatar()" class="h-7 w-7 rounded-full object-cover flex-shrink-0" alt="" />
            } @else {
              <div class="h-7 w-7 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {{ activeContactInitial() }}
              </div>
            }
            <h3 class="text-sm font-semibold text-gray-800">{{ activeContactName() }}</h3>
            @if (isActiveContactOnline()) {
              <span class="h-2 w-2 rounded-full bg-green-500"></span>
            } @else {
              <span class="h-2 w-2 rounded-full bg-red-400"></span>
            }
          } @else {
            <h3 class="text-sm font-semibold text-gray-500">Selecciona un usuario para conversar</h3>
          }
        </div>

        <!-- Messages -->
        <div #messagesEl class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          @for (msg of chatService.messages(); track msg.id) {
            <div class="flex" [class.justify-end]="isOwn(msg)" [class.justify-start]="!isOwn(msg)">
              <div class="max-w-[70%]">
                @if (!isOwn(msg)) {
                  <p class="text-xs text-gray-500 mb-1 ml-1">{{ msg.senderName }}</p>
                }
                <div class="px-4 py-2.5 rounded-2xl text-sm break-words"
                  [class.bg-teal-600]="isOwn(msg)"
                  [class.text-white]="isOwn(msg)"
                  [class.rounded-br-sm]="isOwn(msg)"
                  [class.bg-gray-100]="!isOwn(msg)"
                  [class.text-gray-800]="!isOwn(msg)"
                  [class.rounded-bl-sm]="!isOwn(msg)">
                  {{ msg.content }}
                </div>
                <p class="text-xs text-gray-400 mt-1" [class.text-right]="isOwn(msg)" [class.ml-1]="!isOwn(msg)">
                  {{ formatTime(msg.createdAt) }}
                </p>
              </div>
            </div>
          }
          @if (chatService.activeRecipientId() === null) {
            <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <svg class="h-12 w-12 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p class="text-sm text-gray-400">Selecciona un usuario de la lista para iniciar una conversación.</p>
            </div>
          } @else if (chatService.messages().length === 0) {
            <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <p class="text-sm text-gray-400">No hay mensajes aún. ¡Empieza la conversación!</p>
            </div>
          }
        </div>

        <!-- Input -->
        <div class="px-5 py-3 border-t border-gray-200 flex items-center space-x-3 flex-shrink-0"
             [class.invisible]="chatService.activeRecipientId() === null">
          <input
            [(ngModel)]="newMessage"
            (keydown.enter)="send()"
            type="text"
            [placeholder]="'Escribe un mensaje a ' + activeContactName() + '...'"
            class="flex-1 px-4 py-2.5 rounded-full border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
          <button
            (click)="send()"
            [disabled]="!newMessage.trim()"
            class="h-10 w-10 rounded-full bg-teal-600 flex items-center justify-center text-white transition-colors hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesEl') messagesEl!: ElementRef<HTMLDivElement>;

  readonly chatService = inject(ChatService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  newMessage = '';
  private shouldScroll = false;

  // Nueva conversación
  readonly newConvOpen = signal(false);
  readonly searchResults = signal<UserSearchResult[]>([]);
  readonly searchLoading = signal(false);
  searchQuery = '';
  private readonly searchSubject = new Subject<string>();

  constructor() {
    // Scroll to bottom whenever the messages array changes (new message or history loaded)
    effect(() => {
      this.chatService.messages();
      Promise.resolve().then(() => this.scrollToBottom());
    });

    // Debounced search
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

  /** All known contacts (from userNames cache), online ones first */
  readonly allContacts = computed(() => {
    const currentId = this.authService.currentUser()?.id;
    const onlineIds = new Set(this.chatService.onlineUsers().map((u) => u.id));
    const names = this.chatService.userNames();
    const avatars = this.chatService.userAvatars();
    const conversationIds = this.chatService.conversationContactIds();

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    return Object.entries(names)
      .filter(([id, name]) => id !== currentId && name && !uuidPattern.test(name) && conversationIds.has(id))
      .map(([id, name]) => ({
        id,
        name,
        avatar: avatars[id] ?? null,
        isOnline: onlineIds.has(id),
      }))
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.name.localeCompare(b.name, 'es');
      });
  });

  ngOnInit(): void {
    if (!this.chatService.isConnected()) {
      this.chatService.connect();
    }
    this.chatService.isChatOpen.set(true);
    this.chatService.selectConversation(this.chatService.activeRecipientId());
    this.shouldScroll = true;
  }

  ngOnDestroy(): void {
    this.chatService.isChatOpen.set(false);
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  selectConversation(id: string | null): void {
    this.chatService.selectConversation(id);
    this.shouldScroll = true;
  }

  send(): void {
    const content = this.newMessage.trim();
    if (!content) return;
    this.chatService.sendMessage(content, this.chatService.activeRecipientId() ?? undefined);
    this.newMessage = '';
    this.shouldScroll = true;
  }

  isOwn(msg: ChatMessage): boolean {
    return msg.senderId === this.authService.currentUser()?.id;
  }

  formatTime(iso: string): string {
    const date = new Date(iso);
    const time = date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    const today = new Date();
    const isToday =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();
    if (isToday) return `hoy ${time}`;
    const dateStr = date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${dateStr} ${time}`;
  }

  contactInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] ?? '?').toUpperCase();
  }

  activeContactName(): string {
    const id = this.chatService.activeRecipientId();
    if (!id) return '';
    return this.chatService.userNames()[id] ?? id;
  }

  activeContactInitial(): string {
    return this.contactInitials(this.activeContactName());
  }

  activeContactAvatar(): string | null {
    const id = this.chatService.activeRecipientId();
    if (!id) return null;
    return this.chatService.userAvatars()[id] ?? null;
  }

  isActiveContactOnline(): boolean {
    const id = this.chatService.activeRecipientId();
    if (!id) return false;
    return this.chatService.onlineUsers().some((u) => u.id === id);
  }

  openNewConv(): void {
    this.newConvOpen.set(true);
    this.searchQuery = '';
    this.searchResults.set([]);
  }

  closeNewConv(): void {
    this.newConvOpen.set(false);
    this.searchQuery = '';
    this.searchResults.set([]);
  }

  onSearchChange(q: string): void {
    if (q.length < 2) { this.searchResults.set([]); this.searchLoading.set(false); }
    this.searchSubject.next(q);
  }

  startNewConv(user: UserSearchResult): void {
    if (user.fromLdap && !user.id) {
      // LDAP-only user: create stub in DB first to get an ID
      this.chatService.ensureUser(user).subscribe((resolved) => {
        this._openConvForUser({ ...user, id: resolved.id, displayName: resolved.displayName, avatar: resolved.avatar });
      });
    } else if (user.id) {
      this._openConvForUser(user as UserSearchResult & { id: string });
    }
  }

  private _openConvForUser(user: UserSearchResult & { id: string }): void {
    const names = { ...this.chatService.userNames() };
    names[user.id] = user.displayName;
    this.chatService.userNames.set(names);
    if (user.avatar) {
      const avatars = { ...this.chatService.userAvatars() };
      avatars[user.id] = user.avatar;
      this.chatService.userAvatars.set(avatars);
    }
    this.chatService.conversationContactIds.update((ids) => new Set([...ids, user.id]));
    this.closeNewConv();
    this.selectConversation(user.id);
  }

  private scrollToBottom(): void {
    const el = this.messagesEl?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
