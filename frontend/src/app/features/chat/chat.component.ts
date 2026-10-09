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
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChatService, ChatMessage, ChatAttachment, UserSearchResult } from '../../core/services/chat.service';
import { FileIconComponent } from '../../shared/file-icon/file-icon.component';
import { NewBadgeComponent } from '../../shared/new-badge/new-badge.component';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AttachmentPreviewModalComponent, AttachmentPreviewRequest } from '../../shared/attachment-preview-modal/attachment-preview-modal.component';
import { LinkedTextComponent } from '../../shared/linked-text/linked-text.component';

/** Clip (adjuntar y "archivos" en la lista de conversaciones). */
const CLIP_ICON =
  'M17.346 15.539q0 2.272-1.565 3.867Q14.216 21 11.96 21q-2.272 0-3.847-1.594t-1.575-3.867V6.808q0-1.587 1.09-2.697Q8.722 3 10.309 3t2.678 1.11t1.091 2.698v8.269q0 .88-.617 1.517q-.618.637-1.499.637t-1.517-.627t-.636-1.527V6.769h1v8.308q0 .479.327.816q.328.338.807.338t.807-.338t.328-.816V6.789q-.006-1.166-.805-1.977T10.308 4t-1.967.821t-.802 1.987v8.73q-.006 1.853 1.282 3.157T11.961 20q1.828 0 3.1-1.305t1.285-3.156v-8.77h1z';
/** Sobres (MTO compartido desde MTO's → Compartir). */
const MTO_ICON =
  'M13.021 11.17q.218.16.479.16t.479-.16L21 5.943q0-.254-.067-.559q-.067-.304-.125-.5L13.5 10.311L6.154 4.923q-.058.196-.106.492Q6 5.71 6 5.945zm-9.405 8.6q-.691 0-1.153-.463T2 18.154v-9q0-.214.143-.357t.357-.143t.357.143t.143.357v9q0 .269.173.442t.443.173h14.269q.213 0 .356.143t.144.357t-.144.357t-.356.143zm3-3q-.691 0-1.153-.463T5 15.154v-9.77q0-.69.463-1.152t1.153-.463h13.769q.69 0 1.153.463T22 5.385v9.769q0 .69-.462 1.153t-1.153.462z';

/**
 * Lo que manda MTO's → Compartir: "[nota\n\n]Te compartí el MTO <título>\n<enlace>".
 * Hasta la 1.7.13 empezaba con el emoji 📨: se reconocen los dos.
 */
const MTO_SHARE_RE = /^(?:([\s\S]*?)\n\n)?(?:📨\s*)?Te compartí el MTO (.+)\n(\S+)\s*$/u;

interface MtoShare {
  note: string;
  title: string;
  link: string;
  /** Ruta de la intranet (/correo?mto=…) para abrirlo sin recargar. */
  path: string | null;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, AttachmentPreviewModalComponent, LinkedTextComponent, FileIconComponent, NewBadgeComponent],
  styles: [`
    /* Miniaturas chicas; en pantallas angostas las columnas se achican (minmax) */
    .chat-thumb { width: 100%; aspect-ratio: 1; }
    .chat-thumb-single { aspect-ratio: 4 / 3; }
    /* En el celular, dos tarjetas de documento juntas no dejan leer el nombre: una por fila */
    @media (max-width: 640px) { .chat-docs { grid-template-columns: minmax(0, 12.5rem) !important; } }
  `],
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
                <!-- Name + last message preview -->
                <span class="flex-1 text-left min-w-0">
                  <span class="block truncate leading-tight">{{ contact.name }}</span>
                  @if (contact.lastMessage) {
                    @let preview = lastMsgPreview(contact);
                    <span class="flex items-center gap-1 text-xs leading-tight min-w-0"
                      [class.text-gray-400]="chatService.activeRecipientId() !== contact.id"
                      [class.text-teal-500]="chatService.activeRecipientId() === contact.id">
                      @if (preview.prefix) {<span class="flex-shrink-0">{{ preview.prefix }}</span>}
                      @if (preview.icon) {
                        <svg class="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path [attr.d]="preview.icon === 'mto' ? mtoIconPath : clipIconPath" />
                        </svg>
                      }
                      <span class="truncate">{{ preview.text }}</span>
                    </span>
                  } @else if (contact.isOnline) {
                    <span class="block text-xs text-gray-400 leading-tight">En línea</span>
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
                <div class="rounded-2xl text-sm overflow-hidden shadow-sm"
                  [class.bg-teal-600]="isOwn(msg)"
                  [class.text-white]="isOwn(msg)"
                  [class.rounded-br-sm]="isOwn(msg)"
                  [class.bg-gray-300]="!isOwn(msg)"
                  [class.text-gray-900]="!isOwn(msg)"
                  [class.rounded-bl-sm]="!isOwn(msg)">
                  <!-- Adjuntos: uno al lado del otro y, si no entran, en otra fila; nunca más
                       anchos que la burbuja (70 %), así se sigue viendo de quién es el mensaje. -->
                  @let atts = attachmentsOf(msg);
                  @let images = imagesOf(atts);
                  @let docs = documentsOf(atts);
                  @if (images.length) {
                    <!-- Hasta 3 por fila: la grilla mide lo que ocupan, así la burbuja no se estira de más -->
                    <div class="grid gap-1.5 p-1.5" [class.justify-end]="isOwn(msg)"
                      [style.grid-template-columns]="gridColumns(images.length, 3, images.length === 1 ? '13rem' : '7.5rem')">
                      @for (att of images; track att.url) {
                        <button type="button" (click)="openChatPreview(att)" [title]="att.name"
                          class="chat-thumb block overflow-hidden rounded-xl hover:opacity-90 transition-opacity"
                          [class.chat-thumb-single]="images.length === 1">
                          <img [src]="att.url" [alt]="att.name" loading="lazy" class="h-full w-full object-cover" />
                        </button>
                      }
                    </div>
                  }
                  @if (docs.length) {
                    <!-- Documentos: tarjetas con el ícono de su tipo, hasta 2 por fila -->
                    <div class="chat-docs grid gap-1.5 p-1.5" [class.pt-0]="images.length" [class.justify-end]="isOwn(msg)"
                      [style.grid-template-columns]="gridColumns(docs.length, 2, '12.5rem')">
                      @for (att of docs; track att.url) {
                        <button type="button" (click)="openChatPreview(att)" [title]="att.name"
                          class="flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:opacity-90 transition-opacity"
                          [class.bg-teal-700]="isOwn(msg)" [class.bg-gray-200]="!isOwn(msg)">
                          <app-file-icon [file]="{ name: att.name, mimeType: att.mimeType }" [size]="34" />
                          <span class="flex min-w-0 flex-1 flex-col">
                            <span class="truncate text-xs font-semibold leading-tight">{{ att.name }}</span>
                            <span class="mt-0.5 text-[11px] leading-tight opacity-70">{{ fileMeta(att) }}</span>
                          </span>
                        </button>
                      }
                    </div>
                  }
                  <!-- MTO compartido desde MTO's → Compartir: tarjeta con el sobre y el botón para abrirlo -->
                  @let share = mtoShareOf(msg);
                  @if (share) {
                    @if (share.note) {
                      <p class="px-4 pt-2.5 pb-1 break-words whitespace-pre-wrap"><app-linked-text [text]="share.note" /></p>
                    }
                    <button type="button" (click)="openMto(share)" [title]="'Abrir ' + share.title"
                      class="m-1.5 flex w-64 max-w-[calc(100%-0.75rem)] items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:opacity-90 transition-opacity"
                      [class.bg-teal-700]="isOwn(msg)" [class.bg-gray-200]="!isOwn(msg)">
                      <span class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-teal-500 text-white">
                        <svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path [attr.d]="mtoIconPath" /></svg>
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block text-[10px] font-semibold uppercase tracking-wider opacity-70">MTO compartido</span>
                        <span class="block text-xs font-semibold leading-snug line-clamp-2">{{ share.title }}</span>
                        <span class="mt-0.5 block text-[11px] font-medium underline underline-offset-2">Abrir el MTO</span>
                      </span>
                    </button>
                  } @else if (msg.content) {
                    <p class="px-4 pb-2.5 break-words whitespace-pre-wrap" [class.pt-2.5]="!atts.length" [class.pt-1]="atts.length"><app-linked-text [text]="msg.content" /></p>
                  }
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
          } @else if (chatService.loadingHistory()) {
            <div class="flex items-center justify-center h-full">
              <svg class="animate-spin h-6 w-6 text-teal-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </div>
          } @else if (chatService.messages().length === 0) {
            <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <p class="text-sm text-gray-400">No hay mensajes aún. ¡Empieza la conversación!</p>
            </div>
          }
        </div>

        <!-- Input -->
        <div class="border-t border-gray-200 flex-shrink-0"
             [class.invisible]="chatService.activeRecipientId() === null">
          <!-- Archivos elegidos (hasta 10 por mensaje) -->
          @if (selectedFiles().length) {
            <div class="px-5 pt-2 pb-1 flex flex-wrap items-center gap-2">
              @for (file of selectedFiles(); track $index) {
                <span class="flex items-center gap-2 px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-full text-xs text-teal-700 max-w-xs">
                  <app-file-icon [file]="{ name: file.name, mimeType: file.type }" [size]="18" />
                  <span class="truncate max-w-[180px]">{{ file.name }}</span>
                  <span class="text-teal-400">{{ formatSize(file.size) }}</span>
                  <button (click)="removeFile($index)" [disabled]="uploading()" class="ml-1 text-teal-400 hover:text-teal-700"
                    title="Quitar este archivo">
                    <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              }
            </div>
          }
          <div class="px-5 py-3 flex items-center space-x-2">
            <!-- Hidden file input -->
            <input #fileInput type="file" multiple
              class="hidden"
              (change)="onFileSelected($event)" />
            <!-- Paperclip button -->
            <button (click)="fileInput.click()" [disabled]="uploading() || selectedFiles().length >= maxFiles"
              title="Adjuntar archivos (hasta 10 por mensaje)"
              class="relative h-9 w-9 rounded-full flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors flex-shrink-0 disabled:opacity-40">
              <app-new-badge feature="chat-varios-adjuntos" [compact]="true" class="absolute -top-2 left-1/2 -translate-x-1/2 pointer-events-none" />
              <svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path [attr.d]="clipIconPath" /></svg>
            </button>
            <input
              [(ngModel)]="newMessage"
              (keydown.enter)="send()"
              type="text"
              [placeholder]="'Escribe un mensaje a ' + activeContactName() + '...'"
              class="flex-1 px-4 py-2.5 rounded-full border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
            <button
              (click)="send()"
              [disabled]="(!newMessage.trim() && !selectedFiles().length) || uploading()"
              class="h-10 w-10 rounded-full bg-teal-600 flex items-center justify-center text-white transition-colors hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
              @if (uploading()) {
                <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              } @else {
                <svg class="h-5 w-5 translate-x-px" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a1 1 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
                </svg>
              }
            </button>
          </div>
        </div>
      </div>
    </div>

    <app-attachment-preview-modal
      [request]="previewRequest()"
      (closed)="previewRequest.set(null)" />
  `,
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesEl') messagesEl!: ElementRef<HTMLDivElement>;

  readonly chatService = inject(ChatService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  newMessage = '';
  private shouldScroll = false;

  /** Archivos elegidos para el próximo mensaje (van todos juntos en uno solo). */
  readonly selectedFiles = signal<File[]>([]);
  readonly maxFiles = 10;
  readonly uploading = signal(false);
  readonly previewRequest = signal<AttachmentPreviewRequest | null>(null);

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

  /** All known contacts sorted by last message time (most recent first) */
  readonly allContacts = computed(() => {
    const currentId = this.authService.currentUser()?.id;
    const onlineIds = new Set(this.chatService.onlineUsers().map((u) => u.id));
    const names = this.chatService.userNames();
    const avatars = this.chatService.userAvatars();
    const conversationIds = this.chatService.conversationContactIds();
    const lastMessages = this.chatService.lastMessages();

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    return Object.entries(names)
      .filter(([id, name]) => id !== currentId && name && !uuidPattern.test(name) && conversationIds.has(id))
      .map(([id, name]) => ({
        id,
        name,
        avatar: avatars[id] ?? null,
        isOnline: onlineIds.has(id),
        lastMessage: lastMessages[id] ?? null,
      }))
      .sort((a, b) => {
        const ta = a.lastMessage?.createdAt ?? '';
        const tb = b.lastMessage?.createdAt ?? '';
        if (ta && tb) return tb.localeCompare(ta);
        if (ta) return -1;
        if (tb) return 1;
        return a.name.localeCompare(b.name, 'es');
      });
  });

  readonly clipIconPath = CLIP_ICON;
  readonly mtoIconPath = MTO_ICON;

  /** Lo que se ve debajo del nombre en la lista: "Tú:", el ícono (clip o sobre de MTO) y el texto. */
  lastMsgPreview(contact: { lastMessage: ChatMessage | null }): { prefix: string; icon: 'clip' | 'mto' | null; text: string } {
    const msg = contact.lastMessage;
    if (!msg) return { prefix: '', icon: null, text: '' };
    const prefix = msg.senderId === this.authService.currentUser()?.id ? 'Tú:' : '';
    if ((msg.attachments?.length ?? 0) > 1) return { prefix, icon: 'clip', text: `${msg.attachments!.length} archivos` };
    if (msg.attachmentName) return { prefix, icon: 'clip', text: msg.attachmentName };
    const share = this.mtoShareOf(msg);
    if (share) return { prefix, icon: 'mto', text: share.title };
    return { prefix, icon: null, text: msg.content };
  }

  /** Mensaje de MTO's → Compartir ("Te compartí el MTO …" + enlace), o null. */
  mtoShareOf(msg: ChatMessage): MtoShare | null {
    const m = MTO_SHARE_RE.exec(msg.content ?? '');
    if (!m) return null;
    let path: string | null = null;
    try {
      const url = new URL(m[3], location.origin);
      path = url.pathname + url.search;
    } catch { /* enlace raro: se abre tal cual */ }
    return { note: (m[1] ?? '').trim(), title: m[2].trim(), link: m[3], path };
  }

  openMto(share: MtoShare): void {
    if (share.path?.startsWith('/correo?')) void this.router.navigateByUrl(share.path);
    else window.open(share.link, '_blank', 'noopener');
  }

  /** "137.6 KB · RAR" */
  fileMeta(att: ChatAttachment): string {
    const ext = /\.([a-z0-9]{1,5})$/i.exec(att.name ?? '')?.[1]?.toUpperCase() ?? '';
    return [this.formatSize(att.size), ext].filter(Boolean).join(' · ');
  }

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
    const files = this.selectedFiles();
    if (!content && !files.length) return;
    if (this.uploading()) return;

    const recipientId = this.chatService.activeRecipientId() ?? undefined;

    if (files.length) {
      // Se suben todos y recién ahí sale un único mensaje con todos los adjuntos.
      this.uploading.set(true);
      forkJoin(files.map((f) => this.chatService.uploadFile(f))).subscribe({
        next: (attachments) => {
          this.chatService.sendMessage(content, recipientId, attachments);
          this.newMessage = '';
          this.selectedFiles.set([]);
          this.uploading.set(false);
          this.shouldScroll = true;
        },
        error: (err) => {
          this.uploading.set(false);
          const msg = err?.error?.message ?? 'Error al subir los archivos. Intentá de nuevo.';
          alert(msg);
        },
      });
    } else {
      this.chatService.sendMessage(content, recipientId);
      this.newMessage = '';
      this.shouldScroll = true;
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (!picked.length) return;
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword','application/vnd.ms-excel'];
    const problems: string[] = [];
    // .txt y .rar por la extensión: Chrome en Windows suele mandar los .rar sin tipo.
    const byExtension = /\.(txt|rar)$/i;
    const ok = picked.filter((file) => {
      if (!allowed.includes(file.type) && !byExtension.test(file.name)) {
        problems.push(`${file.name}: formato no permitido`);
        return false;
      }
      if (file.size > 50 * 1024 * 1024) {
        problems.push(`${file.name}: supera los 50 MB (${this.formatSize(file.size)})`);
        return false;
      }
      return true;
    });
    const current = this.selectedFiles();
    const room = this.maxFiles - current.length;
    if (ok.length > room) problems.push(`Se pueden enviar hasta ${this.maxFiles} archivos por mensaje: quedaron afuera ${ok.length - room}.`);
    this.selectedFiles.set([...current, ...ok.slice(0, Math.max(room, 0))]);
    if (problems.length) {
      alert(`No se adjuntaron algunos archivos:\n\n${problems.join('\n')}\n\nPodés adjuntar imágenes (JPG, PNG, GIF, WebP), PDF, Word, Excel, texto (.txt) o RAR.`);
    }
  }

  removeFile(index: number): void {
    this.selectedFiles.update((files) => files.filter((_, i) => i !== index));
  }

  /** Los adjuntos del mensaje: la lista si son varios; si no, el único (mensajes de antes). */
  attachmentsOf(msg: ChatMessage): ChatAttachment[] {
    if (msg.attachments?.length) return msg.attachments;
    if (!msg.attachmentUrl) return [];
    return [{
      url: msg.attachmentUrl,
      name: msg.attachmentName ?? 'archivo',
      size: msg.attachmentSize ?? 0,
      mimeType: msg.attachmentMimeType ?? '',
    }];
  }

  imagesOf(atts: ChatAttachment[]): ChatAttachment[] {
    return atts.filter((a) => this.isImage(a.mimeType));
  }

  documentsOf(atts: ChatAttachment[]): ChatAttachment[] {
    return atts.filter((a) => !this.isImage(a.mimeType));
  }

  /** Columnas de la grilla de adjuntos: tantas como haya, hasta `max` por fila, cada una de hasta `width`. */
  gridColumns(count: number, max: number, width: string): string {
    return `repeat(${Math.min(count, max)}, minmax(0, ${width}))`;
  }

  openChatPreview(att: ChatAttachment): void {
    const name = att.name ? encodeURIComponent(att.name) : '';
    // Un .rar no se puede ver: se descarga directo, con su nombre.
    if (/\.rar$/i.test(att.name) || att.mimeType?.includes('rar')) {
      const a = document.createElement('a');
      a.href = `${att.url}${name ? '?name=' + name : ''}`;
      a.download = att.name || 'archivo.rar';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const fileKey = att.url.split('/').pop()!;
    const previewUrl = `/api/chat/files/${fileKey}/preview${name ? '?name=' + name : ''}`;
    // Por el tipo que manda el servidor: así un .txt se muestra como texto.
    this.previewRequest.set({ url: previewUrl, filename: att.name || 'archivo', downloadUrl: att.url, byContentType: true });
  }

  isImage(mimeType?: string): boolean {
    return !!mimeType?.startsWith('image/');
  }

  formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
