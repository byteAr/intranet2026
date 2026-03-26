import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  MailService,
  Email,
  MailFolder,
  SendEmailDto,
} from '../../core/services/mail.service';

const FOLDER_LABELS: Record<MailFolder, string> = {
  informativos: 'Informativos',
  ejecutivos: 'Ejecutivos',
  redgen: 'Redgen',
  tx: 'Enviados',
};

@Component({
  selector: 'app-mail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">

      <!-- ── Folder sidebar ────────────────────────────── -->
      <aside class="w-44 flex-shrink-0 border-r border-gray-100 flex flex-col bg-gray-50">
        <div class="px-3 py-3 border-b border-gray-100">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Carpetas</p>
        </div>

        <button (click)="selectFolder(null)" class="folder-btn" [class.folder-active]="activeFolder() === null">
          <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span class="ml-2 text-sm">Todos</span>
        </button>

        @for (folder of folders; track folder) {
          <button (click)="selectFolder(folder)" class="folder-btn" [class.folder-active]="activeFolder() === folder">
            <span class="h-2 w-2 rounded-full flex-shrink-0" [ngClass]="folderDotClass(folder)"></span>
            <span class="ml-2 text-sm">{{ folderLabel(folder) }}</span>
          </button>
        }

        <div class="flex-1"></div>

        @if (isTicom) {
          <div class="p-2 border-t border-gray-200">
            <button (click)="openCompose()"
              class="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white transition-colors"
              style="background:#0f766e">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Redactar
            </button>
          </div>
        }
      </aside>

      <!-- ── Email list ────────────────────────────────── -->
      <div class="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col">
        <!-- Search bar -->
        <div class="p-2 border-b border-gray-100">
          <div class="relative">
            <svg class="absolute left-2.5 top-2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              [(ngModel)]="searchQuery"
              (ngModelChange)="onSearchChange($event)"
              (keydown.enter)="runSearch()"
              type="text"
              placeholder="Buscar..."
              class="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
        </div>

        <!-- List header -->
        <div class="px-3 py-2 flex items-center justify-between border-b border-gray-100">
          <span class="text-xs text-gray-400">
            {{ mailService.totalEmails() }} correo{{ mailService.totalEmails() !== 1 ? 's' : '' }}
          </span>
          @if (isSearchMode()) {
            <button (click)="clearSearch()" class="text-xs text-teal-600 hover:text-teal-800">Limpiar</button>
          }
        </div>

        <!-- Email rows -->
        <div class="flex-1 overflow-y-auto">
          @if (mailService.loading()) {
            <div class="flex items-center justify-center h-24">
              <span class="text-sm text-gray-400">Cargando...</span>
            </div>
          } @else if (mailService.emails().length === 0) {
            <div class="flex flex-col items-center justify-center h-24 text-gray-400">
              <svg class="h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p class="text-sm">Sin correos</p>
            </div>
          } @else {
            @for (email of mailService.emails(); track email.id) {
              <button
                (click)="selectEmail(email)"
                class="w-full text-left px-3 py-3 border-b border-gray-50 transition-colors hover:bg-gray-50"
                [class.bg-teal-50]="activeEmail()?.id === email.id"
                [class.border-l-2]="!isRead(email)"
                [class.border-l-teal-500]="!isRead(email)">
                <div class="flex items-start justify-between gap-1">
                  <p class="text-xs font-medium text-gray-700 truncate flex-1"
                     [class.font-semibold]="!isRead(email)">
                    {{ email.fromAddress }}
                  </p>
                  <span class="text-xs text-gray-400 flex-shrink-0">{{ formatDate(email.date) }}</span>
                </div>
                <p class="text-sm truncate mt-0.5"
                   [class.font-semibold]="!isRead(email)"
                   [class.text-gray-800]="!isRead(email)"
                   [class.text-gray-600]="isRead(email)">
                  {{ email.subject }}
                </p>
                <div class="flex items-center gap-1.5 mt-1">
                  @if (email.mailCode) {
                    <span class="text-xs font-mono bg-gray-100 text-gray-500 px-1 rounded">{{ email.mailCode }}</span>
                  }
                  <span class="text-xs px-1.5 py-0.5 rounded-full" [ngClass]="folderBadgeClass(email.folder)">
                    {{ folderLabel(email.folder) }}
                  </span>
                  @if (email.attachmentCount) {
                    <svg class="h-3 w-3 text-gray-400 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" title="Tiene adjuntos">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  }
                </div>
              </button>
            }
          }
        </div>

        <!-- Pagination -->
        @if (totalPages() > 1) {
          <div class="flex items-center justify-between px-3 py-2 border-t border-gray-100">
            <button (click)="prevPage()" [disabled]="currentPage() === 1"
              class="text-xs px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
              ← Ant
            </button>
            <span class="text-xs text-gray-400">{{ currentPage() }} / {{ totalPages() }}</span>
            <button (click)="nextPage()" [disabled]="currentPage() >= totalPages()"
              class="text-xs px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
              Sig →
            </button>
          </div>
        }
      </div>

      <!-- ── Detail / Compose ──────────────────────────── -->
      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">

        <!-- COMPOSE -->
        @if (showCompose()) {
          <div class="flex-1 overflow-y-auto p-6">
            <div class="max-w-2xl">
              <div class="flex items-center justify-between mb-5">
                <h2 class="text-base font-semibold text-gray-800">Redactar correo</h2>
                <button (click)="closeCompose()" class="text-gray-400 hover:text-gray-600">
                  <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">Para *</label>
                  <input [(ngModel)]="composeTo" type="text" placeholder="correo1@dom.com, correo2@dom.com"
                    class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">CC</label>
                  <input [(ngModel)]="composeCc" type="text" placeholder="opcional"
                    class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">Asunto *</label>
                  <input [(ngModel)]="composeSubject" type="text"
                    class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">Mensaje *</label>
                  <textarea [(ngModel)]="composeBody" rows="10"
                    class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"></textarea>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">Adjuntos</label>
                  <label class="flex items-center gap-2 px-3 py-2 text-sm border border-dashed border-gray-300 rounded-md cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition-colors">
                    <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <span class="text-gray-500">Seleccionar archivos...</span>
                    <input type="file" multiple class="hidden" (change)="onFilesSelected($event)" />
                  </label>
                  @if (composeFiles().length > 0) {
                    <div class="mt-1.5 flex flex-wrap gap-1.5">
                      @for (f of composeFiles(); track f.name) {
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 rounded-full text-gray-700">
                          {{ f.name }}
                          <button type="button" (click)="removeFile(f)" class="text-gray-400 hover:text-red-500 leading-none">&times;</button>
                        </span>
                      }
                    </div>
                  }
                </div>
              </div>
              @if (composeError()) {
                <p class="mt-2 text-sm text-red-500">{{ composeError() }}</p>
              }
              @if (composeSent()) {
                <p class="mt-2 text-sm text-teal-600">Correo enviado correctamente.</p>
              }
              <div class="flex gap-2 mt-4">
                <button (click)="submitCompose()" [disabled]="composeSending()"
                  class="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 transition-colors"
                  style="background:#0f766e">
                  {{ composeSending() ? 'Enviando...' : 'Enviar' }}
                </button>
                <button (click)="closeCompose()"
                  class="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          </div>

        <!-- DETAIL -->
        } @else if (activeEmail()) {
          <div class="flex-1 overflow-y-auto p-5">
            <!-- Header -->
            <div class="border-b border-gray-100 pb-4 mb-4">
              <div class="flex items-start justify-between gap-3 mb-2">
                <h1 class="text-base font-semibold text-gray-900 leading-snug">{{ activeEmail()!.subject }}</h1>
                <span class="flex-shrink-0 text-xs px-2 py-0.5 rounded-full" [ngClass]="folderBadgeClass(activeEmail()!.folder)">
                  {{ folderLabel(activeEmail()!.folder) }}
                </span>
              </div>
              @if (activeEmail()!.mailCode) {
                <p class="text-xs font-mono text-gray-500 mb-2">{{ activeEmail()!.mailCode }}</p>
              }
              <div class="space-y-0.5 text-xs text-gray-500">
                <p><span class="font-medium text-gray-600">De:</span> {{ activeEmail()!.fromAddress }}</p>
                <p><span class="font-medium text-gray-600">Para:</span> {{ activeEmail()!.toAddresses?.join(', ') }}</p>
                @if (activeEmail()!.ccAddresses?.length) {
                  <p><span class="font-medium text-gray-600">CC:</span> {{ activeEmail()!.ccAddresses.join(', ') }}</p>
                }
                <p><span class="font-medium text-gray-600">Fecha:</span> {{ formatFullDate(activeEmail()!.date) }}</p>
                <p><span class="font-medium text-gray-600">Asunto:</span> {{ activeEmail()!.subject }}</p>
              </div>

              <!-- Attachments — horizontal, below metadata -->
              @if (activeEmail()!.attachments && activeEmail()!.attachments!.length > 0) {
                <div class="mt-3 pt-3 border-t border-gray-100">
                  <div class="flex flex-wrap gap-2">
                    @for (att of activeEmail()!.attachments!; track att.id) {
                      <button
                        (click)="mailService.downloadAttachment(activeEmail()!.id, att.id, att.filename)"
                        class="flex flex-col items-center gap-0.5 p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 transition-colors w-11"
                        [title]="att.filename + ' — ' + formatSize(att.size)">
                        <!-- File type icon -->
                        <div class="w-5 h-5 rounded flex items-center justify-center font-bold leading-none"
                             style="font-size:7px"
                             [style.background]="fileIcon(att.filename).bg"
                             [style.color]="fileIcon(att.filename).fg">
                          {{ fileIcon(att.filename).char }}
                        </div>
                        <span class="text-gray-600 truncate w-full text-center" style="font-size:9px">{{ att.filename }}</span>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Body — codes highlighted green (exists) / red (not found) -->
            <div (click)="onBodyCodeClick($event)"
                 [innerHTML]="highlightedBody(activeEmail()!)"></div>

            <!-- Reference tree -->
          </div>

        <!-- EMPTY STATE -->
        } @else {
          <div class="flex-1 flex flex-col items-center justify-center text-gray-300">
            <svg class="h-16 w-16 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p class="text-sm">Seleccioná un correo</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .folder-btn {
      display: flex; align-items: center;
      width: 100%; padding: 0.5rem 0.75rem;
      font-size: 0.875rem; color: #374151;
      transition: background 0.15s;
    }
    .folder-btn:hover { background: #f3f4f6; }
    .folder-active { background: #f0fdfa !important; color: #0f766e !important; font-weight: 600; }
  `],
})
export class MailComponent implements OnInit {
  readonly mailService = inject(MailService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly folders: MailFolder[] = ['informativos', 'ejecutivos', 'redgen', 'tx'];

  readonly activeFolder = signal<MailFolder | null>(null);
  readonly currentPage = signal(1);
  readonly activeEmail = signal<Email | null>(null);
  readonly detailLoading = signal(false);
  readonly isSearchMode = signal(false);


  readonly showCompose = signal(false);
  readonly composeSending = signal(false);
  readonly composeSent = signal(false);
  readonly composeError = signal('');
  readonly composeFiles = signal<File[]>([]);
  composeTo = '';
  composeCc = '';
  composeSubject = '';
  composeBody = '';
  searchQuery = '';

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.mailService.totalEmails() / 30))
  );

  get isTicom(): boolean {
    return this.mailService.isTicom;
  }

  ngOnInit(): void {
    this.mailService.connect();
    this.mailService.loadEmails();
  }

  selectFolder(folder: MailFolder | null): void {
    this.activeFolder.set(folder);
    this.currentPage.set(1);
    this.activeEmail.set(null);
    this.isSearchMode.set(false);
    this.searchQuery = '';
    this.mailService.loadEmails(folder ?? undefined, 1);
  }

  selectEmail(email: Email): void {
    if (this.activeEmail()?.id === email.id) return;
    this.showCompose.set(false);
    this.activeEmail.set(email);
    this.mailService.getEmail(email.id).subscribe({
      next: (full) => this.activeEmail.set(full),
    });

    // Mark as read
    if (!this.isRead(email)) {
      this.mailService.markRead(email.id).subscribe({
        next: () => {
          this.mailService.emails.update((list) =>
            list.map((e) =>
              e.id === email.id
                ? { ...e, readStatuses: [{ isRead: true, readAt: new Date().toISOString() }] }
                : e,
            ),
          );
          this.mailService.unreadCount.update((n) => Math.max(0, n - 1));
        },
      });
    }
  }

  isRead(email: Email): boolean {
    const rs = email.readStatuses;
    return !!rs && rs.length > 0 && rs[0].isRead;
  }

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  onSearchChange(q: string): void {
    if (!q.trim()) {
      this.clearSearch();
      return;
    }
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.isSearchMode.set(true);
      this.activeEmail.set(null);
      this.mailService.search(q.trim());
    }, 300);
  }

  runSearch(): void {
    const q = this.searchQuery.trim();
    if (!q) return;
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.isSearchMode.set(true);
    this.activeEmail.set(null);
    this.mailService.search(q);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.isSearchMode.set(false);
    this.mailService.loadEmails(this.activeFolder() ?? undefined, this.currentPage());
  }

  prevPage(): void {
    if (this.currentPage() <= 1) return;
    const p = this.currentPage() - 1;
    this.currentPage.set(p);
    this.mailService.loadEmails(this.activeFolder() ?? undefined, p);
  }

  nextPage(): void {
    if (this.currentPage() >= this.totalPages()) return;
    const p = this.currentPage() + 1;
    this.currentPage.set(p);
    this.mailService.loadEmails(this.activeFolder() ?? undefined, p);
  }

  openCompose(): void {
    this.showCompose.set(true);
    this.activeEmail.set(null);
    this.composeTo = '';
    this.composeCc = '';
    this.composeSubject = '';
    this.composeBody = '';
    this.composeError.set('');
    this.composeSent.set(false);
    this.composeFiles.set([]);
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    const incoming = Array.from(input.files);
    this.composeFiles.update((existing) => {
      const names = new Set(existing.map((f) => f.name));
      return [...existing, ...incoming.filter((f) => !names.has(f.name))];
    });
    input.value = '';
  }

  removeFile(file: File): void {
    this.composeFiles.update((list) => list.filter((f) => f !== file));
  }

  closeCompose(): void {
    this.showCompose.set(false);
  }

  submitCompose(): void {
    const to = this.composeTo.split(',').map((s) => s.trim()).filter(Boolean);
    const cc = this.composeCc.split(',').map((s) => s.trim()).filter(Boolean);
    if (!to.length) { this.composeError.set('Ingresá al menos un destinatario.'); return; }
    if (!this.composeSubject.trim()) { this.composeError.set('El asunto es obligatorio.'); return; }
    if (!this.composeBody.trim()) { this.composeError.set('El cuerpo es obligatorio.'); return; }

    this.composeError.set('');
    this.composeSending.set(true);
    this.composeSent.set(false);

    const dto: SendEmailDto = {
      to,
      cc: cc.length ? cc : undefined,
      subject: this.composeSubject.trim(),
      bodyText: this.composeBody.trim(),
    };

    this.mailService.sendEmail(dto, this.composeFiles()).subscribe({
      next: () => {
        this.composeSending.set(false);
        this.composeSent.set(true);
        setTimeout(() => this.closeCompose(), 1500);
      },
      error: (err: any) => {
        this.composeSending.set(false);
        this.composeError.set(err?.error?.message ?? 'Error al enviar.');
      },
    });
  }

  folderLabel(folder: MailFolder): string { return FOLDER_LABELS[folder]; }

  folderDotClass(folder: MailFolder): string {
    const map: Record<MailFolder, string> = {
      informativos: 'bg-blue-400', ejecutivos: 'bg-purple-400',
      redgen: 'bg-amber-400', tx: 'bg-teal-400',
    };
    return map[folder];
  }

  folderBadgeClass(folder: MailFolder): string {
    const map: Record<MailFolder, string> = {
      informativos: 'bg-blue-100 text-blue-700', ejecutivos: 'bg-purple-100 text-purple-700',
      redgen: 'bg-amber-100 text-amber-700', tx: 'bg-teal-100 text-teal-700',
    };
    return map[folder];
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return isToday
      ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  }

  formatFullDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /** Renders body with mail codes highlighted: green=exists, red=not found. */
  highlightedBody(email: Email): SafeHtml {
    const refs = email.outgoingRefs ?? [];
    const refMap = new Map<string, string | null>();
    for (const r of refs) {
      refMap.set(r.referencedCode.toUpperCase(), r.referencedEmailId ?? null);
    }

    if (email.bodyHtml) {
      // HTML email: inject styles into text nodes only via simple regex on visible text
      // For safety, just render HTML as-is (highlighting HTML bodies is complex)
      return this.sanitizer.bypassSecurityTrustHtml(
        `<div class="prose prose-sm max-w-none text-gray-700 text-sm leading-relaxed">${email.bodyHtml}</div>`
      );
    }

    const raw = email.bodyText ?? '';
    // HTML-escape the plain text first to prevent XSS
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const CODE_RE = /\b([A-ZÁÉÍÓÚÑ]{2,5})[ \t]*(\d{1,4})[ \t]*\/[ \t]*(\d{2})\b/g;
    const selfCode = (email.mailCode ?? '').toUpperCase();

    const highlighted = escaped.replace(CODE_RE, (match, p1, p2, p3) => {
      const code = `${p1} ${p2}/${p3}`;
      // Own code identifier: render bold but no link
      if (code.toUpperCase() === selfCode) {
        return `<span class="font-semibold text-gray-800">${match}</span>`;
      }
      const emailId = refMap.get(code.toUpperCase());
      if (emailId) {
        return `<span class="text-green-600 font-medium cursor-pointer hover:underline" data-ref-id="${emailId}" title="Ver ${code}">${match}</span>`;
      }
      return `<span class="text-red-500 font-medium" title="${code} — no encontrado en la base de datos">${match}</span>`;
    });

    return this.sanitizer.bypassSecurityTrustHtml(
      `<pre class="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">${highlighted}</pre>`
    );
  }

  onBodyCodeClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const emailId = target.getAttribute('data-ref-id');
    if (!emailId) return;
    this.mailService.getEmail(emailId).subscribe({
      next: (email) => this.activeEmail.set(email),
    });
  }

  fileIcon(filename: string): { bg: string; fg: string; char: string } {
    const ext = (filename.split('.').pop() ?? '').toLowerCase();
    const map: Record<string, { bg: string; fg: string; char: string }> = {
      pdf:  { bg: '#dc2626', fg: '#fff', char: 'PDF' },
      doc:  { bg: '#2563eb', fg: '#fff', char: 'W' },
      docx: { bg: '#2563eb', fg: '#fff', char: 'W' },
      odt:  { bg: '#2563eb', fg: '#fff', char: 'W' },
      rtf:  { bg: '#2563eb', fg: '#fff', char: 'W' },
      xls:  { bg: '#16a34a', fg: '#fff', char: 'X' },
      xlsx: { bg: '#16a34a', fg: '#fff', char: 'X' },
      csv:  { bg: '#16a34a', fg: '#fff', char: 'X' },
      ods:  { bg: '#16a34a', fg: '#fff', char: 'X' },
      ppt:  { bg: '#ea580c', fg: '#fff', char: 'P' },
      pptx: { bg: '#ea580c', fg: '#fff', char: 'P' },
      jpg:  { bg: '#7c3aed', fg: '#fff', char: 'IMG' },
      jpeg: { bg: '#7c3aed', fg: '#fff', char: 'IMG' },
      png:  { bg: '#7c3aed', fg: '#fff', char: 'IMG' },
      gif:  { bg: '#7c3aed', fg: '#fff', char: 'IMG' },
      bmp:  { bg: '#7c3aed', fg: '#fff', char: 'IMG' },
      webp: { bg: '#7c3aed', fg: '#fff', char: 'IMG' },
      tiff: { bg: '#7c3aed', fg: '#fff', char: 'IMG' },
      svg:  { bg: '#7c3aed', fg: '#fff', char: 'IMG' },
      zip:  { bg: '#92400e', fg: '#fff', char: 'ZIP' },
      rar:  { bg: '#92400e', fg: '#fff', char: 'RAR' },
      '7z': { bg: '#92400e', fg: '#fff', char: '7Z' },
      mp3:  { bg: '#0891b2', fg: '#fff', char: '♪' },
      mp4:  { bg: '#0891b2', fg: '#fff', char: '▶' },
      txt:  { bg: '#6b7280', fg: '#fff', char: 'TXT' },
    };
    // Extensiones numéricas (.00, .001, etc.) → candado
    if (/^\d+$/.test(ext)) return { bg: '#374151', fg: '#fff', char: '🔒' };
    return map[ext] ?? { bg: '#6b7280', fg: '#fff', char: ext.slice(0, 3).toUpperCase() || '?' };
  }
}
