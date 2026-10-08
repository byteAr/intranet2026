import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  HostListener,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  MailService,
  Email,
  MailAttachment,
  DecryptedFile,
  MailFlag,
  MailFolder,
  SienaFile,
  MailUnreadCounts,
} from '../../core/services/mail.service';
import { AttachmentPreviewModalComponent, AttachmentPreviewRequest } from '../../shared/attachment-preview-modal/attachment-preview-modal.component';
import { FileIconComponent } from '../../shared/file-icon/file-icon.component';
import { MtoShareComponent } from './mto-share.component';
import { NewBadgeComponent } from '../../shared/new-badge/new-badge.component';
import { MtoViewersComponent } from './mto-viewers.component';
import { CometSpinnerComponent } from '../../shared/comet-spinner/comet-spinner.component';
import { AppVersionService } from '../../core/services/app-version.service';
import { forkJoin } from 'rxjs';

/** Un lugar donde puede ir un archivo arrastrado sobre el MTO. */
interface DropTarget {
  /** Id del adjunto encriptado, o 'siena'. */
  key: string;
  label: string;
  attachmentId?: string;
  /** Nombre sin extensión, en mayúsculas, para emparejar por nombre (CONTRO~1). */
  base: string | null;
}

/** "CONTRO~1.~00" y "contro~1.doc" → "CONTRO~1". */
function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return (dot > 0 ? filename.slice(0, dot) : filename).trim().toUpperCase();
}

const FOLDER_LABELS: Record<MailFolder, string> = {
  informativos: 'Informativos',
  ejecutivos: 'Ejecutivos',
  redgen: 'Redgen',
  tx: 'Enviados',
};

@Component({
  selector: 'app-mail',
  standalone: true,
  imports: [CommonModule, FormsModule, AttachmentPreviewModalComponent, FileIconComponent, MtoShareComponent, NewBadgeComponent, CometSpinnerComponent, MtoViewersComponent],
  template: `
    <div class="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">

      <!-- ── Folder sidebar ────────────────────────────── -->
      <aside class="w-44 flex-shrink-0 border-r border-gray-100 flex flex-col bg-gray-50">
        <div class="px-3 py-3 border-b border-gray-100">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Carpetas</p>
        </div>

        <button (click)="selectFolder(null)" class="folder-btn" [class.folder-active]="activeFolder() === null && !isHistorical()">
          <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span class="ml-2 text-sm flex-1 text-left">Todos</span>
          @if (!isHistorical() && mailService.unreadCounts().total > 0) {
            <span class="text-xs bg-teal-100 text-teal-700 rounded-full px-1.5 leading-5">{{ mailService.unreadCounts().total }}</span>
          }
        </button>

        @for (folder of folders; track folder) {
          <button (click)="selectFolder(folder)" class="folder-btn" [class.folder-active]="activeFolder() === folder && !isHistorical()">
            <span class="h-2 w-2 rounded-full flex-shrink-0" [ngClass]="folderDotClass(folder)"></span>
            <span class="ml-2 text-sm flex-1 text-left">{{ folderLabel(folder) }}</span>
            @if (!isHistorical() && folderUnreadCount(folder) > 0) {
              <span class="text-xs bg-teal-100 text-teal-700 rounded-full px-1.5 leading-5">{{ folderUnreadCount(folder) }}</span>
            }
          </button>
        }

        <div class="flex-1"></div>

        <div class="p-2 border-t border-gray-200 space-y-1.5">
          <button (click)="markAllRead()"
            [disabled]="markingAllRead() || isHistorical() || mailService.unreadCounts().total === 0"
            class="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-colors border border-teal-200 text-teal-700 bg-white hover:bg-teal-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Pone en cero Ejecutivos, Informativos, Redgen y Enviados (solo para vos)">
            <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12l5 5L18 6M12 17l1.5 1.5L22 10"/>
            </svg>
            {{ markingAllRead() ? 'Marcando…' : 'Marcar todo leído' }}
            <app-new-badge feature="marcar-todo-leido" [compact]="true" />
          </button>
          <button (click)="toggleHistorical()"
            class="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors"
            [class.bg-amber-600]="isHistorical()"
            [class.text-white]="isHistorical()"
            [class.bg-amber-50]="!isHistorical()"
            [class.text-amber-700]="!isHistorical()">
            <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Históricos
          </button>

        </div>
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
          <button (click)="toggleAdvanced()"
            class="mt-1 text-xs font-medium transition-colors flex items-center gap-1"
            [class.text-teal-600]="showAdvanced() || isAdvancedMode()"
            [class.text-gray-400]="!showAdvanced() && !isAdvancedMode()">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Búsqueda avanzada
          </button>
          @if (showAdvanced()) {
            <div class="mt-2 p-2 bg-gray-50 rounded-md border border-gray-200 space-y-2">
              <div class="flex gap-1.5">
                <div class="flex-1">
                  <label class="block text-[10px] font-medium text-gray-500 mb-0.5">Desde</label>
                  <input type="date" [(ngModel)]="advDateFrom"
                    class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white" />
                </div>
                <div class="flex-1">
                  <label class="block text-[10px] font-medium text-gray-500 mb-0.5">Hasta</label>
                  <input type="date" [(ngModel)]="advDateTo"
                    class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white" />
                </div>
              </div>
              <div>
                <label class="block text-[10px] font-medium text-gray-500 mb-0.5">Año exacto</label>
                <input type="number" [(ngModel)]="advYear" placeholder="ej: 2024" min="2000" max="2100"
                  class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white" />
              </div>
              <div>
                <label class="block text-[10px] font-medium text-gray-500 mb-0.5">Tipo</label>
                <div class="flex flex-wrap gap-1">
                  @for (f of folders; track f) {
                    <button (click)="toggleAdvFolder(f)"
                      class="text-xs px-2 py-0.5 rounded-full border transition-colors"
                      [ngClass]="advFolder() === f ? folderBadgeClass(f) : 'border-gray-200 text-gray-500 hover:border-gray-300'">
                      {{ folderLabel(f) }}
                    </button>
                  }
                </div>
              </div>
              <div class="flex gap-1.5 pt-0.5">
                <button (click)="runAdvancedSearch()"
                  class="flex-1 text-xs py-1.5 rounded-md bg-teal-600 text-white hover:bg-teal-700 font-medium">
                  Buscar
                </button>
                <button (click)="clearAdvancedSearch()"
                  class="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100">
                  Limpiar
                </button>
              </div>
            </div>
          }
        </div>

        <!-- List header -->
        <div class="px-3 py-1.5 flex items-center justify-between border-b border-gray-100">
          <span class="text-xs text-gray-400">
            @if (isAdvancedMode()) { Búsqueda avanzada }
            @else if (isSearchMode()) { Resultados }
            @else { &nbsp; }
          </span>
          <div class="flex items-center gap-2">
            @if (isSearchMode() || isAdvancedMode()) {
              <button (click)="isAdvancedMode() ? clearAdvancedSearch() : clearSearch()"
                class="text-xs text-teal-600 hover:text-teal-800">Limpiar</button>
            }
            <!-- Organizar por -->
            <div class="relative">
              <button (click)="showGroupByMenu.set(!showGroupByMenu())"
                class="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                [class.text-teal-700]="groupBy() === 'from'"
                [class.text-gray-500]="groupBy() === 'none'">
                {{ groupBy() === 'from' ? 'Por De' : 'Organizar' }}
                <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              @if (showGroupByMenu()) {
                <div class="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1"
                     (mouseleave)="showGroupByMenu.set(false)">
                  <p class="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Organizar por</p>
                  <button (click)="setGroupBy('none')"
                    class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2"
                    [class.text-teal-700]="groupBy() === 'none'"
                    [class.text-gray-700]="groupBy() !== 'none'">
                    @if (groupBy() === 'none') {
                      <svg class="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                    } @else { <span class="w-3"></span> }
                    Fecha
                  </button>
                  <button (click)="setGroupBy('from')"
                    class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2"
                    [class.text-teal-700]="groupBy() === 'from'"
                    [class.text-gray-700]="groupBy() !== 'from'">
                    @if (groupBy() === 'from') {
                      <svg class="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                    } @else { <span class="w-3"></span> }
                    De (remitente)
                  </button>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- Email rows -->
        <div class="flex-1 overflow-y-auto">
          @if (mailService.loading()) {
            <div class="flex items-center justify-center h-24">
              <svg class="h-8 w-8 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" style="color: #0d9488" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="url(#spinner-grad)" stroke-width="3" stroke-linecap="round" />
                <defs><linearGradient id="spinner-grad" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0d9488"/><stop offset="1" stop-color="#166534"/></linearGradient></defs>
              </svg>
            </div>
          } @else if (mailService.emails().length === 0) {
            <div class="flex flex-col items-center justify-center h-24 text-gray-400">
              <svg class="h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p class="text-sm">Sin correos</p>
            </div>
          } @else if (groupBy() === 'from') {
            <!-- Vista agrupada por remitente -->
            @if (senderGroupsLoading()) {
              <div class="flex items-center justify-center h-24">
                <svg class="h-6 w-6 animate-spin text-teal-600" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                </svg>
              </div>
            } @else {
              @for (group of senderGroups(); track group.sender) {
                <div class="border-b border-gray-200">
                  <button (click)="toggleGroup(group.sender)"
                    class="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors sticky top-0 z-10">
                    <svg class="h-3 w-3 text-gray-400 flex-shrink-0 transition-transform duration-150"
                         [class.-rotate-90]="!expandedGroups().has(group.sender)"
                         fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                    <span class="text-xs font-semibold text-gray-700 truncate flex-1 text-left">{{ group.sender || '(Sin remitente)' }}</span>
                    <span class="text-[10px] bg-gray-200 text-gray-500 rounded-full px-1.5 py-0.5 flex-shrink-0">{{ group.count }}</span>
                  </button>
                  @if (expandedGroups().has(group.sender)) {
                    @let groupState = groupEmailsMap().get(group.sender);
                    @if (groupState?.loading && groupState?.emails?.length === 0) {
                      <div class="flex justify-center py-3">
                        <svg class="h-4 w-4 animate-spin text-teal-500" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                        </svg>
                      </div>
                    } @else {
                      @for (email of groupState?.emails ?? []; track email.id) {
                        <button
                          (click)="selectEmail(email)"
                          [attr.data-email-id]="email.id"
                          class="w-full text-left px-4 py-2.5 border-b border-gray-50 transition-all duration-150 hover:bg-gray-50 focus:outline-none"
                          [ngClass]="{
                            'bg-teal-50 shadow-sm relative z-10': activeEmail()?.id === email.id,
                            'border-l-2 border-l-teal-500': !isRead(email) && email.folder !== 'ejecutivos',
                            'mto-ejecutivo': email.folder === 'ejecutivos',
                            'mto-ejecutivo-bg': email.folder === 'ejecutivos' && activeEmail()?.id !== email.id
                          }">
                          <div class="flex items-center justify-between gap-1">
                            <p class="text-sm truncate flex-1"
                               [class.font-semibold]="!isRead(email)"
                               [class.text-gray-800]="!isRead(email)"
                               [class.text-gray-500]="isRead(email)">
                              {{ email.subject }}
                            </p>
                            <div class="flex items-center gap-1 flex-shrink-0">
                              @if (email.flag) {
                                <svg class="h-3.5 w-3.5 text-red-600" viewBox="0 0 24 24" fill="currentColor" aria-label="Con bandera">
                                  <title>Bandera de {{ email.flag.byName }}</title>
                                  <path d="M5 21V4h11l-1.5 4L16 12H7v9z"/>
                                </svg>
                              }
                              @if (email.attachmentCount) {
                                <svg class="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                </svg>
                              }
                              <span class="text-xs text-gray-400">{{ formatDate(email.date) }}</span>
                            </div>
                          </div>
                          <div class="flex items-center justify-between mt-1">
                            <span class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full" [ngClass]="folderBadgeClass(email.folder)">
                              @if (email.folder === 'ejecutivos') {
                                <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6M12 17h.01"/></svg>
                              }
                              {{ folderLabel(email.folder) }}
                            </span>
                          </div>
                        </button>
                      }
                      @if (groupState && groupState.emails.length < groupState.total) {
                        <button (click)="loadMoreGroupEmails(group.sender)"
                          [disabled]="groupState.loading"
                          class="w-full py-2 text-xs text-teal-600 hover:text-teal-800 hover:bg-teal-50 transition-colors disabled:opacity-50">
                          {{ groupState.loading ? 'Cargando...' : 'Cargar más (' + (groupState.total - groupState.emails.length) + ' restantes)' }}
                        </button>
                      }
                    }
                  }
                </div>
              }
            }
          } @else {
            <!-- Vista plana (por fecha) -->
            @for (email of mailService.emails(); track email.id) {
              <button
                (click)="selectEmail(email)"
                [attr.data-email-id]="email.id"
                class="w-full text-left px-3 py-3 border-b border-gray-50 transition-all duration-150 hover:bg-gray-50 focus:outline-none"
                [ngClass]="{
                  'bg-teal-50 -translate-y-0.5 shadow-md relative z-10': activeEmail()?.id === email.id,
                  'border-l-2 border-l-teal-500': !isRead(email) && email.folder !== 'ejecutivos',
                  'mto-ejecutivo': email.folder === 'ejecutivos',
                  'mto-ejecutivo-bg': email.folder === 'ejecutivos' && activeEmail()?.id !== email.id
                }">
                <div class="flex items-center justify-between gap-1">
                  <p class="text-xs font-medium text-gray-700 truncate flex-1"
                     [class.font-semibold]="!isRead(email)">
                    {{ email.fromAddress }}
                  </p>
                  <div class="flex items-center gap-1 flex-shrink-0">
                    @if (email.flag) {
                      <svg class="h-3.5 w-3.5 text-red-600" viewBox="0 0 24 24" fill="currentColor" aria-label="Con bandera">
                        <title>Bandera de {{ email.flag.byName }}</title>
                        <path d="M5 21V4h11l-1.5 4L16 12H7v9z"/>
                      </svg>
                    }
                    @if (email.attachmentCount) {
                      <svg class="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" title="Tiene adjuntos">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                    }
                    <span class="text-xs text-gray-400">{{ formatDate(email.date) }}</span>
                  </div>
                </div>
                <p class="text-sm truncate mt-0.5"
                   [class.font-semibold]="!isRead(email)"
                   [class.text-gray-800]="!isRead(email)"
                   [class.text-gray-600]="isRead(email)">
                  {{ email.subject }}
                </p>
                @if (email.snippet) {
                  <p class="text-xs text-gray-500 mt-1 line-clamp-2 leading-snug"
                     [innerHTML]="snippetHtml(email.snippet)"></p>
                }
                <div class="flex items-center justify-end mt-1">
                  <span class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full" [ngClass]="folderBadgeClass(email.folder)">
                    @if (email.folder === 'ejecutivos') {
                      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6M12 17h.01"/></svg>
                    }
                    {{ folderLabel(email.folder) }}
                  </span>
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

      <!-- ── Detail ───────────────────────────────────────── -->
      <!-- TICOM arrastra acá los desencriptados / SIENA (solo en MTO encriptados o por SIENA) -->
      <div class="relative flex-1 flex flex-col min-w-0 overflow-hidden"
           (dragenter)="onMtoDragOver($event)"
           (dragover)="onMtoDragOver($event)"
           (dragleave)="onMtoDragLeave($event)"
           (drop)="onMtoDrop($event)">

        @if (activeEmail()) {
          <div class="flex-1 overflow-y-auto p-5">
            <!-- Navigation history arrows -->
            @if (navHistory().length > 1) {
              <div class="flex items-center gap-1 mb-3">
                <button (click)="navBack()" [disabled]="!canGoBack()"
                  class="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md border border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                  </svg>
                  Atrás
                </button>
                <button (click)="navForward()" [disabled]="!canGoForward()"
                  class="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md border border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  Adelante
                  <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <span class="text-xs text-gray-400 ml-1">{{ navIndex() + 1 }} / {{ navHistory().length }}</span>
              </div>
            }
            <!-- Header -->
            <div class="border-b border-gray-100 pb-4 mb-4">
              <!-- Ejecutivo: es para cumplimentar, que se note -->
              @if (activeEmail()!.folder === 'ejecutivos') {
                <div class="mb-3 flex items-center gap-2 rounded-lg border-l-4 border-purple-600 bg-purple-50 px-3 py-2 text-sm text-purple-900">
                  <svg class="h-5 w-5 flex-shrink-0 text-purple-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>
                  </svg>
                  <span><strong>MTO EJECUTIVO</strong> — es para cumplimentar.</span>
                </div>
              }
              <div class="flex items-start justify-between gap-3 mb-2">
                <h1 class="text-base font-semibold text-gray-900 leading-snug" [innerHTML]="highlightText(activeEmail()!.subject)"></h1>
                <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span class="text-xs px-2 py-0.5 rounded-full" [ngClass]="folderBadgeClass(activeEmail()!.folder)">
                    {{ folderLabel(activeEmail()!.folder) }}
                  </span>
                  <div class="flex items-center gap-3">
                    @if (isTicom) {
                      <!-- Banderita (como en Outlook): solo TICOM, compartida entre ellos -->
                      <button (click)="toggleFlag()" [disabled]="flagBusy()"
                        class="flex items-center gap-1 text-xs transition-colors hover:opacity-75 disabled:opacity-50"
                        [class.text-red-600]="!!activeEmail()!.flag"
                        [class.font-semibold]="!!activeEmail()!.flag"
                        [class.text-gray-400]="!activeEmail()!.flag"
                        [title]="activeEmail()!.flag ? 'Quitar la bandera (la puso ' + activeEmail()!.flag!.byName + ')' : 'Marcar con bandera: hasta acá se leyó'">
                        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" [attr.fill]="activeEmail()!.flag ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
                          <path d="M5 21V4h11l-1.5 4L16 12H7v9z"/>
                        </svg>
                        {{ activeEmail()!.flag ? 'Con bandera' : 'Bandera' }}
                        <app-new-badge feature="bandera-mto" [compact]="true" />
                      </button>
                    }
                    <app-mto-share [email]="activeEmail()!" />
                    <button (click)="printEmail()"
                      class="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
                      title="Imprimir (Ctrl+P)">
                      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"/>
                      </svg>
                      Imprimir
                    </button>
                  </div>
                </div>
              </div>
              <div class="space-y-0.5 text-xs text-gray-500">
                <p><span class="font-medium text-gray-600">De:</span> {{ activeEmail()!.fromAddress }}</p>
                <p><span class="font-medium text-gray-600">Para:</span> {{ activeEmail()!.toAddresses?.join(', ') }}</p>
                @if (activeEmail()!.ccAddresses?.length) {
                  <p><span class="font-medium text-gray-600">CC:</span> {{ activeEmail()!.ccAddresses.join(', ') }}</p>
                }
                <p><span class="font-medium text-gray-600">Fecha:</span> {{ formatFullDate(activeEmail()!.date) }}</p>
                <p><span class="font-medium text-gray-600">Asunto:</span> <span [innerHTML]="highlightText(activeEmail()!.subject)"></span></p>
              </div>
              <!-- Quiénes lo abrieron (fotos encimadas + cantidad; al tocar, la lista con fecha y hora) -->
              <div class="flex items-center gap-2 flex-wrap">
                <app-mto-viewers [emailId]="activeEmail()!.id" [subject]="activeEmail()!.mailCode || activeEmail()!.subject" [version]="viewsVersion()" />
                <app-new-badge feature="vistos-mto" [compact]="true" class="mt-2" />
                @if (activeEmail()!.flag; as f) {
                  <span class="mt-2 inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs text-red-700">
                    <svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H7v9z"/></svg>
                    Bandera de {{ f.byName }} · {{ formatUploadDate(f.at) }}
                  </span>
                }
              </div>

              <!-- Attachments — horizontal, below metadata -->
              @if (activeEmail()!.attachments && activeEmail()!.attachments!.length > 0) {
                <div class="mt-3 pt-3 border-t border-gray-100">
                  <div class="flex flex-wrap gap-2">
                    @for (att of activeEmail()!.attachments!; track att.id) {
                      <!-- ENCRIPTADO ve el original cifrado solo mientras TICOM no subió los desencriptados -->
                      @if (showOriginalAttachment(att)) {
                        <div class="flex flex-col items-center gap-1">
                          <button
                            (click)="openPreview(activeEmail()!.id, att.id, att.filename)"
                            class="group flex flex-col items-center gap-1 px-2 pt-2.5 pb-2 rounded-xl border border-gray-200 dark:border-zinc-700 hover:border-teal-300 hover:bg-teal-50/50 dark:hover:bg-zinc-800 transition-colors w-24"
                            [title]="att.filename + ' — ' + formatSize(att.size) + (isEncryptedFile(att.filename) ? ' — encriptado' : '')">
                            <app-file-icon [file]="{ name: att.filename }" [size]="40" class="transition-transform group-hover:-translate-y-0.5" />
                            <span class="w-full text-center text-[11px] leading-tight text-gray-700 dark:text-zinc-300 line-clamp-2 break-all" [innerHTML]="highlightText(att.filename)"></span>
                            <span class="text-[10px] text-gray-400 dark:text-zinc-500">{{ formatSize(att.size) }}</span>
                          </button>

                          <!-- Encriptado (.~NN): TICOM sube uno o varios desencriptados (un .rar trae varios) -->
                          @if (isEncryptedFile(att.filename)) {
                            @if (isTicom) {
                              <label class="cursor-pointer" [title]="att.decryptedFiles?.length ? 'Agregar más desencriptados de este archivo' : 'Subir los desencriptados (se pueden elegir varios)'">
                                <input type="file" class="hidden" multiple
                                       (change)="onDecryptedFileSelected(att, $event)"
                                       [disabled]="uploadingDecryptedId() === att.id" />
                                <span class="text-xs px-1 py-0.5 rounded border leading-none"
                                      [class]="att.decryptedFiles?.length ? 'border-green-400 text-green-700' : 'border-amber-400 text-amber-700'">
                                  {{ uploadingDecryptedId() === att.id ? '...' : (att.decryptedFiles?.length ? '+ agregar' : '↑ subir') }}
                                </span>
                              </label>
                            } @else if (isEncriptado) {
                              <span class="w-24 text-center text-[10px] leading-tight text-amber-600 italic">Todavía no se cargó el desencriptado</span>
                            }
                          }
                        </div>
                      }

                      <!-- Desencriptados (solo TICOM y ENCRIPTADO): candado abierto y quién los subió -->
                      @if (isEncriptado || isTicom) {
                        @for (dec of att.decryptedFiles ?? []; track dec.id) {
                          <div class="relative flex flex-col items-center gap-1">
                            <button (click)="openDecryptedPreview(att, dec)"
                              class="group flex flex-col items-center gap-1 px-2 pt-2.5 pb-2 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:border-emerald-400 hover:bg-emerald-50 transition-colors w-24"
                              [title]="decryptedName(dec) + ' — archivo encriptado (' + att.filename + ') desencriptado y subido por ' + dec.uploadedByName + ' (TICOM) el ' + formatUploadDate(dec.uploadedAt) + (decryptedName(dec) !== dec.filename ? '. Subido como ' + dec.filename : '')">
                              <app-file-icon [file]="{ name: decryptedName(dec) }" lock="open" [size]="40" class="transition-transform group-hover:-translate-y-0.5" />
                              <span class="w-full text-center text-[11px] leading-tight text-gray-700 line-clamp-2 break-all">{{ decryptedName(dec) }}</span>
                              <span class="text-[10px] font-semibold text-emerald-700">Desencriptado</span>
                            </button>
                            <span class="w-24 text-center text-[10px] leading-tight text-gray-400">por {{ dec.uploadedByName }}<br>{{ formatUploadDate(dec.uploadedAt) }}</span>
                            @if (isTicom) {
                              <button (click)="onDecryptedDelete(att, dec)"
                                class="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-gray-200 text-red-500 hover:bg-red-50 text-[10px] leading-none shadow-sm"
                                title="Eliminar (si se subió uno equivocado)">&#x2715;</button>
                            }
                          </div>
                        }
                      }
                    }
                  </div>
                </div>
              }

              @if (canDropFiles()) {
                <p class="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
                  <svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Arrastrá sobre el MTO todos los {{ hasEncryptedAttachments() ? 'desencriptados' : 'archivos SIENA' }} juntos para subirlos de una vez.
                  <app-new-badge feature="arrastrar-desencriptados" [compact]="true" />
                </p>
              }
            </div>

            <!-- Archivos SIENA — solo para TICOM y ENCRIPTADO en emails con SOFTWARE SIENA -->
            @if (activeEmail()!.sienaFiles !== undefined) {
              <div class="mt-3 pt-3 border-t border-gray-100">
                <p class="text-xs font-semibold text-gray-500 mb-2">Archivos SIENA desencriptados</p>

                <!-- Archivos subidos: candado abierto y quién los subió (los ven TICOM y ENCRIPTADO) -->
                @if (activeEmail()!.sienaFiles!.length > 0) {
                  <div class="flex flex-wrap gap-2 mb-2">
                    @for (sf of activeEmail()!.sienaFiles!; track sf.id) {
                      <div class="relative flex flex-col items-center gap-1">
                        <button (click)="openSienaPreview(sf)"
                          class="group flex flex-col items-center gap-1 px-2 pt-2.5 pb-2 rounded-xl border border-sky-200 bg-sky-50/50 hover:border-sky-400 hover:bg-sky-50 transition-colors w-24"
                          [title]="'Archivo SIENA desencriptado y subido por ' + sf.uploadedByName + ' (TICOM) el ' + formatUploadDate(sf.uploadedAt)">
                          <app-file-icon [file]="{ name: sf.filename }" lock="siena" [size]="40" class="transition-transform group-hover:-translate-y-0.5" />
                          <span class="w-full text-center text-[11px] leading-tight text-gray-700 line-clamp-2 break-all">{{ sf.filename }}</span>
                          <span class="text-[10px] font-semibold text-sky-700">SIENA</span>
                        </button>
                        <span class="w-24 text-center text-[10px] leading-tight text-gray-400">por {{ sf.uploadedByName }}<br>{{ formatUploadDate(sf.uploadedAt) }}</span>
                        @if (isTicom) {
                          <button (click)="onSienaFileDelete(sf.id)"
                            class="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-gray-200 text-red-500 hover:bg-red-50 text-[10px] leading-none shadow-sm"
                            title="Eliminar (si se subió uno equivocado)">&#x2715;</button>
                        }
                      </div>
                    }
                  </div>
                } @else {
                  @if (isEncriptado && !isTicom) {
                    <p class="text-xs text-gray-400 italic mb-2">Sin archivos desencriptados aún</p>
                  }
                }

                <!-- Botón subir (solo TICOM) -->
                @if (isTicom) {
                  <label class="cursor-pointer inline-block">
                    <input type="file" class="hidden" multiple
                           (change)="onSienaFileSelected($event)"
                           [disabled]="uploadingSiena()" />
                    <span class="text-xs px-2 py-1 rounded border border-blue-400 text-blue-700"
                          title="Se pueden elegir varios archivos a la vez">
                      {{ uploadingSiena() ? 'Subiendo...' : '+ Subir archivos SIENA' }}
                    </span>
                  </label>
                }
              </div>
            }

            <!-- Body — codes highlighted green (exists) / red (not found) -->
            @if (loadingBody()) {
              <div class="space-y-2 mt-2">
                <div class="h-3 bg-gray-100 rounded animate-pulse w-full"></div>
                <div class="h-3 bg-gray-100 rounded animate-pulse w-5/6"></div>
                <div class="h-3 bg-gray-100 rounded animate-pulse w-full"></div>
                <div class="h-3 bg-gray-100 rounded animate-pulse w-4/6"></div>
                <div class="h-3 bg-gray-100 rounded animate-pulse w-3/4"></div>
              </div>
            } @else if (bodyLoadError()) {
              <p class="text-xs text-red-400 italic mt-2">No se pudo cargar el contenido del correo.</p>
            } @else if (!activeEmail()!.bodyText?.trim() && !activeEmail()!.bodyHtml?.trim()) {
              <p class="text-xs text-gray-400 italic mt-2">Sin contenido.</p>
            } @else {
              <div (click)="onBodyCodeClick($event)"
                   (mouseup)="onBodyMouseUp($event)"
                   [innerHTML]="highlightedBodyHtml()"></div>
            }

            <!-- Copy tooltip -->
            @if (copyTooltip()) {
              <div data-copy-tooltip
                   class="fixed z-50 text-white text-xs px-2.5 py-1.5 rounded shadow-lg cursor-pointer select-none flex items-center gap-1"
                   [class.bg-gray-800]="!copyTooltip()!.copied"
                   [class.bg-green-600]="copyTooltip()!.copied"
                   [style.left.px]="copyTooltip()!.x"
                   [style.top.px]="copyTooltip()!.y - 36"
                   [style.opacity]="copyTooltip()!.copied ? '0' : '1'"
                   [style.transition]="copyTooltip()!.copied ? 'opacity 0.7s ease 0.3s' : 'none'"
                   (mousedown)="$event.preventDefault(); $event.stopPropagation()"
                   (click)="copySelection()">
                @if (copyTooltip()!.copied) {
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                  Copiado
                } @else {
                  Copiar
                }
              </div>
            }

            <!-- Reference tree -->
          </div>

          <!-- Arrastrando archivos encima (solo TICOM, MTO encriptado o por SIENA) -->
          @if (dropActive()) {
            <div class="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-teal-500 bg-teal-50/90 text-teal-800">
              <svg class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <p class="text-sm font-semibold">Soltá los archivos para subirlos a este MTO</p>
              <p class="text-xs text-teal-700">{{ hasEncryptedAttachments() ? 'Como desencriptados' : 'Como archivos SIENA' }} — solo los ven TICOM y ENCRIPTADO</p>
            </div>
          }

          <!-- Subiendo lo arrastrado -->
          @if (dropUploading()) {
            <div class="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 bg-teal-600 px-4 py-2 text-xs font-medium text-white shadow">
              <app-comet-spinner [size]="16" [thickness]="3" />
              {{ dropUploading() }}
            </div>
          }

          <!-- Archivos que no se sabe a qué encriptado corresponden -->
          @if (dropAssign(); as da) {
            <div class="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
              <div class="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-800">
                <h3 class="text-sm font-semibold text-gray-800 dark:text-zinc-100">¿A qué archivo corresponde cada uno?</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  Estos no tienen el mismo nombre que ningún encriptado. Elegí dónde va cada uno.
                </p>
                <div class="mt-3 max-h-72 space-y-2 overflow-y-auto">
                  @for (item of da.pending; track $index) {
                    <div class="flex items-center gap-2">
                      <app-file-icon [file]="{ name: item.file.name }" [size]="28" />
                      <span class="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-zinc-200" [title]="item.file.name">{{ item.file.name }}</span>
                      <select [(ngModel)]="item.targetKey"
                        class="max-w-[45%] rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-white">
                        @for (t of da.targets; track t.key) {
                          <option [value]="t.key">{{ t.label }}</option>
                        }
                      </select>
                    </div>
                  }
                </div>
                <div class="mt-4 flex justify-end gap-2">
                  <button (click)="dropAssign.set(null)"
                    class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700">Cancelar</button>
                  <button (click)="confirmDropAssign()"
                    class="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700">
                    Subir {{ da.pending.length + da.assigned.length }} archivo{{ da.pending.length + da.assigned.length === 1 ? '' : 's' }}
                  </button>
                </div>
              </div>
            </div>
          }

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

    <app-attachment-preview-modal
      [request]="previewRequest()"
      (closed)="previewRequest.set(null)" />
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
    /* Ejecutivos: son para cumplimentar, se destacan en la lista */
    .mto-ejecutivo { border-left: 4px solid #7c3aed; }
    .mto-ejecutivo-bg { background: #faf5ff; }
    .mto-ejecutivo-bg:hover { background: #f3e8ff; }
  `],
})
export class MailComponent implements OnInit {
  readonly mailService = inject(MailService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly folders: MailFolder[] = ['ejecutivos', 'informativos', 'redgen', 'tx'];

  readonly previewRequest = signal<AttachmentPreviewRequest | null>(null);
  readonly activeFolder = signal<MailFolder | null>(null);
  readonly currentPage = signal(1);
  readonly activeEmail = signal<Email | null>(null);
  readonly detailLoading = signal(false);
  readonly isSearchMode = signal(false);
  readonly isHistorical = signal(false);
  readonly activeSearchTerm = signal('');
  readonly showAdvanced = signal(false);
  readonly isAdvancedMode = signal(false);
  advDateFrom = '';
  advDateTo = '';
  advYear = '';
  readonly advFolder = signal<MailFolder | null>(null);

  // Historial de navegación por referencias
  readonly navHistory = signal<Email[]>([]);
  readonly navIndex = signal(-1);
  readonly canGoBack = computed(() => this.navIndex() > 0);
  readonly canGoForward = computed(() => this.navIndex() < this.navHistory().length - 1);


  searchQuery = '';

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.mailService.totalEmails() / 30))
  );

  readonly groupBy = signal<'none' | 'from'>('none');
  readonly showGroupByMenu = signal(false);
  readonly senderGroups = signal<{ sender: string; count: number; lastDate: string }[]>([]);
  readonly senderGroupsLoading = signal(false);
  readonly groupEmailsMap = signal<Map<string, { emails: Email[]; page: number; total: number; loading: boolean }>>(new Map());
  readonly expandedGroups = signal<Set<string>>(new Set());

  setGroupBy(value: 'none' | 'from'): void {
    this.groupBy.set(value);
    this.showGroupByMenu.set(false);
    if (value === 'from') {
      this.senderGroups.set([]);
      this.groupEmailsMap.set(new Map());
      this.expandedGroups.set(new Set());
      this.loadSenderGroups();
    }
  }

  private loadSenderGroups(): void {
    this.senderGroupsLoading.set(true);
    this.mailService.getGroupedBySender(this.activeFolder() ?? undefined, this.isHistorical()).subscribe({
      next: (groups) => { this.senderGroups.set(groups); this.senderGroupsLoading.set(false); },
      error: () => this.senderGroupsLoading.set(false),
    });
  }

  toggleGroup(sender: string): void {
    const expanded = new Set(this.expandedGroups());
    if (expanded.has(sender)) {
      expanded.delete(sender);
      this.expandedGroups.set(expanded);
      return;
    }
    expanded.add(sender);
    this.expandedGroups.set(expanded);
    const map = new Map(this.groupEmailsMap());
    if (!map.has(sender)) {
      map.set(sender, { emails: [], page: 1, total: 0, loading: true });
      this.groupEmailsMap.set(map);
      this.loadGroupEmails(sender, 1);
    }
  }

  loadGroupEmails(sender: string, page: number): void {
    this.mailService.loadEmailsBySender(sender, this.activeFolder() ?? undefined, page, this.isHistorical()).subscribe({
      next: (res) => {
        const map = new Map(this.groupEmailsMap());
        const prev = map.get(sender);
        const existing = page === 1 ? [] : (prev?.emails ?? []);
        map.set(sender, { emails: [...existing, ...res.data], page, total: res.total, loading: false });
        this.groupEmailsMap.set(map);
      },
      error: () => {
        const map = new Map(this.groupEmailsMap());
        const prev = map.get(sender);
        if (prev) { map.set(sender, { ...prev, loading: false }); this.groupEmailsMap.set(map); }
      },
    });
  }

  loadMoreGroupEmails(sender: string): void {
    const state = this.groupEmailsMap().get(sender);
    if (!state || state.loading) return;
    const map = new Map(this.groupEmailsMap());
    map.set(sender, { ...state, loading: true });
    this.groupEmailsMap.set(map);
    this.loadGroupEmails(sender, state.page + 1);
  }

  readonly copyTooltip = signal<{ x: number; y: number; copied: boolean } | null>(null);
  private suppressTooltip = false;

  readonly uploadingDecryptedId = signal<string | null>(null);
  loadingBody = signal(false);
  bodyLoadError = signal(false);
  readonly uploadingSiena = signal(false);

  get isEncriptado(): boolean {
    return this.mailService.isEncriptado;
  }

  get isTicom(): boolean {
    return this.mailService.isTicom;
  }

  isEncryptedFile(filename: string): boolean {
    return !!filename && /\.\~\d{2}$/.test(filename);
  }

  // Computed para evitar re-render del innerHTML en cada CD (perdería la selección de texto)
  readonly highlightedBodyHtml = computed(() => {
    const email = this.activeEmail();
    if (!email) return this.sanitizer.bypassSecurityTrustHtml('');
    return this.buildHighlightedBody(email, this.activeSearchTerm());
  });

  highlightText(text: string): string {
    const term = this.activeSearchTerm();
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!term.trim()) return escaped;
    const termRe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(${termRe})`, 'gi');
    return escaped.replace(re, '<mark style="background:#ffff00;padding:0 1px;border-radius:2px;color:inherit">$1</mark>');
  }

  onSienaFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    const emailId = this.activeEmail()!.id;
    this.uploadingSiena.set(true);
    this.mailService.uploadSienaFiles(emailId, files).subscribe({
      next: (newFiles) => {
        this.uploadingSiena.set(false);
        this.activeEmail.update((e) => e ? { ...e, sienaFiles: [...(e.sienaFiles ?? []), ...newFiles] } : e);
      },
      error: () => this.uploadingSiena.set(false),
    });
    input.value = '';
  }

  onSienaFileDelete(fileId: string): void {
    const emailId = this.activeEmail()!.id;
    this.mailService.deleteSienaFile(emailId, fileId).subscribe({
      next: () => {
        this.activeEmail.update((e) => e ? { ...e, sienaFiles: (e.sienaFiles ?? []).filter((f) => f.id !== fileId) } : e);
      },
      error: () => {},
    });
  }

  /**
   * El original cifrado se muestra siempre, salvo a ENCRIPTADO (sin TICOM) cuando
   * ya están los desencriptados: ahí ve solo esos.
   */
  showOriginalAttachment(att: MailAttachment): boolean {
    if (!this.isEncryptedFile(att.filename) || this.isTicom || !this.isEncriptado) return true;
    return !att.decryptedFiles?.length;
  }

  onDecryptedDelete(att: MailAttachment, dec: DecryptedFile): void {
    if (!confirm(`¿Eliminar el desencriptado "${dec.filename}"? No se puede recuperar.`)) return;
    const emailId = this.activeEmail()!.id;
    this.mailService.deleteDecrypted(emailId, att.id, dec.id).subscribe({
      next: () => {
        this.activeEmail.update((e) => e ? {
          ...e,
          attachments: e.attachments?.map((a) => {
            if (a.id !== att.id) return a;
            const decryptedFiles = (a.decryptedFiles ?? []).filter((d) => d.id !== dec.id);
            return { ...a, decryptedFiles, hasDecrypted: decryptedFiles.length > 0 };
          }),
        } : e);
      },
      error: () => {},
    });
  }

  onDecryptedFileSelected(att: { id: string; filename: string }, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    const emailId = this.activeEmail()!.id;
    this.uploadingDecryptedId.set(att.id);
    this.mailService.uploadDecrypted(emailId, att.id, files).subscribe({
      next: () => {
        this.uploadingDecryptedId.set(null);
        this.mailService.getEmail(emailId).subscribe((full) => this.activeEmail.set(full));
      },
      error: () => {
        this.uploadingDecryptedId.set(null);
      },
    });
    input.value = '';
  }

  // ── Arrastrar desencriptados / SIENA sobre el MTO (solo TICOM) ──────────

  readonly dropActive = signal(false);
  /** Texto de la franja mientras sube lo arrastrado; null si no sube nada. */
  readonly dropUploading = signal<string | null>(null);
  /** Archivos cuyo nombre no coincide con ningún encriptado: TICOM elige a cuál van. */
  readonly dropAssign = signal<{
    targets: DropTarget[];
    assigned: { file: File; targetKey: string }[];
    pending: { file: File; targetKey: string }[];
  } | null>(null);
  private readonly sinRecarga = inject(AppVersionService).holdWhile('desencriptados', () => !!this.dropUploading() || !!this.dropAssign());

  readonly hasEncryptedAttachments = computed(() =>
    !!this.activeEmail()?.attachments?.some((a) => this.isEncryptedFile(a.filename)));

  /** Solo TICOM, y solo en MTO con adjuntos encriptados o por SIENA. */
  readonly canDropFiles = computed(() =>
    this.isTicom && !!this.activeEmail() && (this.hasEncryptedAttachments() || this.activeEmail()!.sienaFiles !== undefined));

  /** A dónde puede ir lo arrastrado: cada adjunto encriptado y, si es por SIENA, los archivos SIENA. */
  private dropTargets(): DropTarget[] {
    const email = this.activeEmail();
    if (!email) return [];
    const targets: DropTarget[] = (email.attachments ?? [])
      .filter((a) => this.isEncryptedFile(a.filename))
      .map((a) => ({ key: a.id, label: `Desencriptado de ${a.filename}`, attachmentId: a.id, base: baseName(a.filename) }));
    if (email.sienaFiles !== undefined) targets.push({ key: 'siena', label: 'Archivos SIENA', base: null });
    return targets;
  }

  onMtoDragOver(event: DragEvent): void {
    if (!this.canDropFiles() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!this.dropUploading() && !this.dropAssign()) this.dropActive.set(true);
  }

  onMtoDragLeave(event: DragEvent): void {
    // Pasar por encima de un hijo también dispara dragleave: solo vale si sale del panel
    const panel = event.currentTarget as HTMLElement;
    if (!panel.contains(event.relatedTarget as Node | null)) this.dropActive.set(false);
  }

  onMtoDrop(event: DragEvent): void {
    if (!this.canDropFiles() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dropActive.set(false);
    if (this.dropUploading() || this.dropAssign()) return;

    // Solo archivos: las carpetas se ignoran
    const items = Array.from(event.dataTransfer.items ?? []);
    const files = items.length
      ? items
          .filter((it) => it.kind === 'file' && (it.webkitGetAsEntry?.()?.isFile ?? true))
          .map((it) => it.getAsFile())
          .filter((f): f is File => !!f)
      : Array.from(event.dataTransfer.files);
    if (!files.length) {
      alert('No se pueden subir carpetas: arrastrá los archivos.');
      return;
    }

    // Cada archivo va al encriptado con el mismo nombre (CONTRO~1.DOC → CONTRO~1.~00);
    // si hay un solo lugar posible, todo va ahí; si no, TICOM elige.
    const targets = this.dropTargets();
    const assigned: { file: File; targetKey: string }[] = [];
    const pending: { file: File; targetKey: string }[] = [];
    for (const file of files) {
      const match = targets.find((t) => t.base && t.base === baseName(file.name));
      if (match) assigned.push({ file, targetKey: match.key });
      else if (targets.length === 1) assigned.push({ file, targetKey: targets[0].key });
      else pending.push({ file, targetKey: (targets.find((t) => t.key === 'siena') ?? targets[0]).key });
    }
    if (pending.length) {
      this.dropAssign.set({ targets, assigned, pending });
      return;
    }
    this.uploadDropped(assigned);
  }

  confirmDropAssign(): void {
    const da = this.dropAssign();
    if (!da) return;
    this.dropAssign.set(null);
    this.uploadDropped([...da.assigned, ...da.pending]);
  }

  /** Sube todo junto: un pedido por adjunto encriptado y otro para SIENA. */
  private uploadDropped(items: { file: File; targetKey: string }[]): void {
    const email = this.activeEmail();
    if (!email || !items.length) return;
    const byTarget = new Map<string, File[]>();
    for (const { file, targetKey } of items) byTarget.set(targetKey, [...(byTarget.get(targetKey) ?? []), file]);

    const requests = [...byTarget.entries()].map(([key, files]) =>
      key === 'siena'
        ? this.mailService.uploadSienaFiles(email.id, files)
        : this.mailService.uploadDecrypted(email.id, key, files));

    this.dropUploading.set(`Subiendo ${items.length} archivo${items.length === 1 ? '' : 's'}…`);
    forkJoin(requests).subscribe({
      next: () => {
        this.dropUploading.set(null);
        this.mailService.getEmail(email.id).subscribe((full) => {
          if (this.activeEmail()?.id === email.id) this.activeEmail.set(full);
        });
      },
      error: (err) => {
        this.dropUploading.set(null);
        alert(err?.error?.message ?? 'No se pudieron subir los archivos. Intentá de nuevo.');
        this.mailService.getEmail(email.id).subscribe((full) => {
          if (this.activeEmail()?.id === email.id) this.activeEmail.set(full);
        });
      },
    });
  }

  ngOnInit(): void {
    this.mailService.connect();
    this.mailService.loadEmails();
    this.mailService.loadUnreadCounts();
    // ?mto=<id>: abrir ese MTO directo (enlaces compartidos por el chat o copiados).
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('mto');
      if (id) this.openSharedMto(id);
    });
  }

  /** Abre un MTO por su id y saca el parámetro de la dirección. */
  private openSharedMto(id: string): void {
    void this.router.navigate([], { queryParams: { mto: null }, queryParamsHandling: 'merge', replaceUrl: true });
    this.mailService.getEmail(id).subscribe({
      next: (email) => this.selectEmail(email),
      error: () => {
        this.loadingBody.set(false);
        this.bodyLoadError.set(true);
      },
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const tag = (event.target as HTMLElement).tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    event.preventDefault();
    const emails = this.mailService.emails();
    if (emails.length === 0) return;

    const currentId = this.activeEmail()?.id;
    const currentIndex = currentId ? emails.findIndex((e) => e.id === currentId) : -1;

    let nextIndex: number;
    if (event.key === 'ArrowDown') {
      nextIndex = currentIndex < emails.length - 1 ? currentIndex + 1 : currentIndex;
      if (currentIndex === -1) nextIndex = 0;
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
    }

    if (nextIndex === currentIndex && currentIndex !== -1) return;
    const email = emails[nextIndex];
    this.selectEmail(email);
    setTimeout(() => {
      document.querySelector(`[data-email-id="${email.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  selectFolder(folder: MailFolder | null): void {
    this.isHistorical.set(false);
    this.activeFolder.set(folder);
    this.currentPage.set(1);
    this.activeEmail.set(null);
    this.isSearchMode.set(false);
    if (this.groupBy() === 'from') { this.senderGroups.set([]); this.groupEmailsMap.set(new Map()); this.expandedGroups.set(new Set()); this.loadSenderGroups(); }
    this.isAdvancedMode.set(false);
    this.showAdvanced.set(false);
    this.searchQuery = '';
    this.mailService.loadEmails(folder ?? undefined, 1);
  }

  toggleHistorical(): void {
    const next = !this.isHistorical();
    this.isHistorical.set(next);
    this.activeFolder.set(null);
    this.currentPage.set(1);
    this.activeEmail.set(null);
    this.isSearchMode.set(false);
    this.isAdvancedMode.set(false);
    this.showAdvanced.set(false);
    this.searchQuery = '';
    if (this.groupBy() === 'from') { this.senderGroups.set([]); this.groupEmailsMap.set(new Map()); this.expandedGroups.set(new Set()); this.loadSenderGroups(); return; }
    this.mailService.loadEmails(undefined, 1, 30, next);
  }

  selectEmail(email: Email): void {
    if (this.activeEmail()?.id === email.id) return;
    this.navHistory.set([]);
    this.navIndex.set(-1);
    this.activeEmail.set(email);
    this.loadingBody.set(true);
    this.bodyLoadError.set(false);
    this.mailService.getEmail(email.id).subscribe({
      next: (full) => {
        this.loadingBody.set(false);
        this.activeEmail.set(full);
        this.navHistory.set([full]);
        this.navIndex.set(0);
      },
      error: (err) => {
        this.loadingBody.set(false);
        this.bodyLoadError.set(true);
        console.error('Error al cargar el cuerpo del correo:', err);
      },
    });

    // Se registra siempre que se abre (aunque ya contara como leído: los
    // anteriores a MAIL_UNREAD_SINCE o los históricos), para "Visto por".
    const wasUnread = !this.isRead(email);
    this.recordView(email.id, () => {
      if (!wasUnread) return;
      this.mailService.emails.update((list) =>
        list.map((e) =>
          e.id === email.id
            ? { ...e, readStatuses: [{ isRead: true, readAt: new Date().toISOString() }] }
            : e,
        ),
      );
      if (!this.isHistorical()) {
        this.mailService.decrementUnread(email.folder);
      }
    });
  }

  /** Cambia cuando el usuario quedó registrado como que vio el MTO: "Visto por" se actualiza. */
  readonly viewsVersion = signal(0);

  // ─── Marcar todo como leído ────────────────────────────────────────────────

  readonly markingAllRead = signal(false);

  /** Las 4 carpetas en cero para este usuario; lo que llegue después aparece como no leído. */
  markAllRead(): void {
    if (!confirm('¿Marcar como leídos todos los MTO? Ejecutivos, Informativos, Redgen y Enviados quedan en cero (solo para vos). Los que lleguen después aparecen como no leídos.')) return;
    this.markingAllRead.set(true);
    this.mailService.markAllRead().subscribe({
      next: () => {
        this.markingAllRead.set(false);
        // Vista agrupada por remitente: se vuelve a cargar con el estado nuevo.
        if (this.groupBy() === 'from') {
          this.senderGroups.set([]);
          this.groupEmailsMap.set(new Map());
          this.expandedGroups.set(new Set());
          this.loadSenderGroups();
        }
      },
      error: () => {
        this.markingAllRead.set(false);
        alert('No se pudo marcar todo como leído. Intentá de nuevo.');
      },
    });
  }

  // ─── Banderita (solo TICOM) ────────────────────────────────────────────────

  readonly flagBusy = signal(false);

  toggleFlag(): void {
    const email = this.activeEmail();
    if (!email || this.flagBusy()) return;
    this.flagBusy.set(true);
    const done = (flag: MailFlag | null) => {
      this.flagBusy.set(false);
      const apply = (e: Email) => (e.id === email.id ? { ...e, flag } : e);
      this.activeEmail.update((e) => (e ? apply(e) : e));
      this.mailService.emails.update((list) => list.map(apply));
      const groups = new Map(this.groupEmailsMap());
      for (const [sender, state] of groups) groups.set(sender, { ...state, emails: state.emails.map(apply) });
      this.groupEmailsMap.set(groups);
    };
    if (email.flag) {
      this.mailService.clearFlag(email.id).subscribe({ next: () => done(null), error: () => this.flagBusy.set(false) });
    } else {
      this.mailService.setFlag(email.id).subscribe({ next: (flag) => done(flag), error: () => this.flagBusy.set(false) });
    }
  }

  /** Ctrl+P con un MTO abierto: lo imprime con el formato de Outlook, como el botón Imprimir. */
  @HostListener('window:keydown', ['$event'])
  onPrintShortcut(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p' && this.activeEmail()) {
      event.preventDefault();
      this.printEmail();
    }
  }

  /** Marca el MTO como visto por el usuario (el backend no duplica) y actualiza "Visto por". */
  private recordView(emailId: string, after?: () => void): void {
    this.mailService.markRead(emailId).subscribe({
      next: () => {
        after?.();
        this.viewsVersion.update((v) => v + 1);
      },
    });
  }

  /**
   * El fragmento es texto del correo: primero se escapa entero, y recién
   * después los marcadores que puso el backend (U+0002 / U+0003) se convierten
   * en <mark>. Así nada del contenido del correo puede inyectarse como HTML.
   */
  snippetHtml(snippet: string): string {
    return snippet
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\u0002/g, '<mark class="bg-amber-200 text-gray-900 rounded-sm px-0.5">')
      .replace(/\u0003/g, '</mark>');
  }

  isRead(email: Email): boolean {
    if (this.isHistorical()) return true;
    const rs = email.readStatuses;
    return !!rs && rs.length > 0 && rs[0].isRead;
  }

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  onSearchChange(q: string): void {
    if (!q.trim()) {
      this.clearSearch();
      return;
    }
    // Show spinner immediately — prevents list from flickering during debounce
    this.mailService.loading.set(true);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.isSearchMode.set(true);
      this.activeEmail.set(null);
      this.activeSearchTerm.set(q.trim());
      this.mailService.search(q.trim());
    }, 500);
  }

  runSearch(): void {
    const q = this.searchQuery.trim();
    if (!q) return;
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.isSearchMode.set(true);
    this.activeEmail.set(null);
    this.activeSearchTerm.set(q);
    this.mailService.search(q);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.isSearchMode.set(false);
    this.activeSearchTerm.set('');
    this.mailService.exitSearch();
    this.mailService.loadEmails(this.activeFolder() ?? undefined, this.currentPage(), 30, this.isHistorical());
  }

  toggleAdvanced(): void {
    this.showAdvanced.update((v) => !v);
  }

  toggleAdvFolder(f: MailFolder): void {
    this.advFolder.update((cur) => cur === f ? null : f);
  }

  runAdvancedSearch(): void {
    const year = this.advYear ? parseInt(this.advYear, 10) : undefined;
    const folder = this.advFolder() ?? undefined;
    this.isAdvancedMode.set(true);
    this.isSearchMode.set(false);
    this.showAdvanced.set(false);
    this.currentPage.set(1);
    this.activeEmail.set(null);
    this.activeSearchTerm.set(this.searchQuery.trim());
    this.mailService.isSearchActive.set(true);
    this.mailService.loadEmails(
      folder,
      1,
      30,
      false,
      {
        q: this.searchQuery.trim() || undefined,
        dateFrom: this.advDateFrom || undefined,
        dateTo: this.advDateTo || undefined,
        year,
      },
    );
  }

  clearAdvancedSearch(): void {
    this.advDateFrom = '';
    this.advDateTo = '';
    this.advYear = '';
    this.advFolder.set(null);
    this.isAdvancedMode.set(false);
    this.showAdvanced.set(false);
    this.activeSearchTerm.set('');
    this.mailService.exitSearch();
    this.mailService.loadEmails(this.activeFolder() ?? undefined, 1, 30, this.isHistorical());
  }

  prevPage(): void {
    if (this.currentPage() <= 1) return;
    const p = this.currentPage() - 1;
    this.currentPage.set(p);
    this.mailService.loadEmails(this.activeFolder() ?? undefined, p, 30, this.isHistorical());
  }

  nextPage(): void {
    if (this.currentPage() >= this.totalPages()) return;
    const p = this.currentPage() + 1;
    this.currentPage.set(p);
    this.mailService.loadEmails(this.activeFolder() ?? undefined, p, 30, this.isHistorical());
  }

  folderLabel(folder: MailFolder): string { return FOLDER_LABELS[folder]; }

  folderUnreadCount(folder: MailFolder): number {
    const c = this.mailService.unreadCounts();
    return c[folder] ?? 0;
  }

  folderDotClass(folder: MailFolder): string {
    const map: Record<MailFolder, string> = {
      informativos: 'bg-blue-400', ejecutivos: 'bg-purple-400',
      redgen: 'bg-amber-400', tx: 'bg-teal-400',
    };
    return map[folder];
  }

  folderBadgeClass(folder: MailFolder): string {
    const map: Record<MailFolder, string> = {
      // Ejecutivos, relleno fuerte: son para cumplimentar
      informativos: 'bg-blue-100 text-blue-700', ejecutivos: 'bg-purple-600 text-white font-semibold',
      redgen: 'bg-amber-100 text-amber-700', tx: 'bg-teal-100 text-teal-700',
    };
    return map[folder];
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return isToday
      ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  }

  formatFullDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  openPreview(emailId: string, attId: string, filename: string): void {
    this.previewRequest.set({
      url: `/api/mail/emails/${emailId}/attachments/${attId}/preview`,
      filename,
      downloadUrl: `/api/mail/emails/${emailId}/attachments/${attId}`,
    });
  }

  /** Un desencriptado de un adjunto .~NN (solo TICOM y ENCRIPTADO; el servidor lo controla). */
  openDecryptedPreview(att: MailAttachment, dec: DecryptedFile): void {
    const url = `/api/mail/emails/${this.activeEmail()!.id}/attachments/${att.id}/decrypted/${dec.id}`;
    this.previewRequest.set({ url, downloadUrl: url, filename: this.decryptedName(dec) });
  }

  /** El nombre real del desencriptado (el del cuerpo del MTO) o, si no se sabe, el subido. */
  decryptedName(dec: DecryptedFile): string {
    return dec.displayName || dec.filename;
  }

  openSienaPreview(sf: SienaFile): void {
    const url = `/api/mail/emails/${this.activeEmail()!.id}/siena-files/${sf.id}`;
    this.previewRequest.set({ url, downloadUrl: url, filename: sf.filename });
  }

  /** "17/04/2026 11:43", en hora de Argentina. */
  formatUploadDate(iso: string): string {
    return new Date(iso).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  onBodyMouseUp(event: MouseEvent): void {
    if (this.suppressTooltip) return;
    const text = window.getSelection()?.toString().trim() ?? '';
    if (text.length > 0) {
      this.copyTooltip.set({ x: event.clientX, y: event.clientY, copied: false });
    }
  }

  copySelection(): void {
    const sel = window.getSelection();
    const text = sel?.toString() ?? '';
    if (!text) return;

    const pos = this.copyTooltip();
    if (!pos) return;

    // Copiar al clipboard (con fallback para HTTP)
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => this.fallbackCopy(text));
    } else {
      this.fallbackCopy(text);
    }

    // Mostrar estado "copiado" → fondo verde, fade out en 1s
    this.copyTooltip.set({ ...pos, copied: true });
    setTimeout(() => {
      sel?.removeAllRanges();
      this.copyTooltip.set(null);
    }, 1000);
  }

  private fallbackCopy(text: string): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    Object.assign(ta.style, { position: 'fixed', opacity: '0', top: '0', left: '0' });
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignorar */ }
    document.body.removeChild(ta);
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-copy-tooltip]')) {
      this.copyTooltip.set(null);
      // Suprimir el próximo onBodyMouseUp para que no re-muestre el tooltip
      // al hacer click para deseleccionar (mousedown siempre precede al mouseup)
      this.suppressTooltip = true;
      setTimeout(() => { this.suppressTooltip = false; }, 0);
    }
  }

  /** Renders body with mail codes highlighted: green=exists, red=not found. */
  private buildHighlightedBody(email: Email, searchTerm = ''): SafeHtml {
    const refs = email.outgoingRefs ?? [];
    const refMap = new Map<string, string | null>();
    for (const r of refs) {
      refMap.set(r.referencedCode.toUpperCase(), r.referencedEmailId ?? null);
    }

    const applySearchHighlight = (html: string): string => {
      if (!searchTerm.trim()) return html;
      const termRe = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const re = new RegExp(`(${termRe})`, 'gi');
      return html.replace(/(<[^>]+>)|([^<]+)/g, (_, tag, text) => {
        if (tag) return tag;
        return text ? text.replace(re, '<mark style="background:#ffff00;padding:0 1px;border-radius:2px;color:inherit">$1</mark>') : '';
      });
    };

    // Prefer bodyText for code highlighting. Fall back to HTML-only render if no plain text.
    if (!email.bodyText?.trim()) {
      const bodyHtml = applySearchHighlight(email.bodyHtml ?? '');
      return this.sanitizer.bypassSecurityTrustHtml(
        `<div class="prose prose-sm max-w-none text-gray-700 text-sm leading-relaxed">${bodyHtml}</div>`
      );
    }
    const raw = email.bodyText;
    // HTML-escape the plain text first to prevent XSS
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const CODE_RE = /\b([A-ZÁÉÍÓÚÑ]{1,4})[ \t]*(\d+)[^\w\/]*\/[^\w]*(\d[^\w\/]*\d)\b/g;
    const EXCLUDED = new Set(['PON']);
    const selfCode = (email.mailCode ?? '').toUpperCase();

    let highlighted = escaped.replace(CODE_RE, (match, p1, p2, p3) => {
      if (EXCLUDED.has(p1.toUpperCase())) return match;
      const code = `${p1} ${p2}/${p3.replace(/\D/g, '')}`;
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

    highlighted = applySearchHighlight(highlighted);

    return this.sanitizer.bypassSecurityTrustHtml(
      `<pre class="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">${highlighted}</pre>`
    );
  }

  /**
   * Impresión como la de Outlook (así se archivaban en papel): la cuenta arriba
   * con una línea gruesa, De / Enviado el / Para / CC / Asunto / Datos adjuntos
   * en negrita, y el cuerpo en Calibri. Sin el encabezado ni el pie del
   * navegador (fecha, about:blank, 1/1): los márgenes los pone la página.
   */
  printEmail(): void {
    const email = this.activeEmail();
    if (!email) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    /** Como los muestra Outlook: el nombre de la casilla (DIREDTOS@MTO.GNA → DIREDTOS). */
    const nameOf = (address: string) => address.split('@')[0].trim();
    const names = (list: string[] | undefined) => (list ?? []).map(nameOf).filter(Boolean).join('; ');

    const zone = 'America/Argentina/Buenos_Aires';
    const when = new Date(email.date);
    // "jueves, 8 de octubre de 2026 12:42", en hora de Argentina
    const sentAt =
      when.toLocaleDateString('es-AR', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
      ' ' +
      when.toLocaleTimeString('es-AR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });

    const rows: [string, string][] = [
      ['De:', `${nameOf(email.fromAddress)} <${email.fromAddress}>`],
      ['Enviado el:', sentAt],
      ['Para:', names(email.toAddresses)],
      ['CC:', names(email.ccAddresses)],
      ['Asunto:', email.subject ?? ''],
    ];
    if (email.attachments?.length) rows.push(['Datos adjuntos:', email.attachments.map((a) => a.filename).join('; ')]);
    const header = rows
      .filter(([label, value]) => label !== 'CC:' || value)
      .map(([label, value]) => `<tr><th>${label}</th><td>${esc(value)}</td></tr>`)
      .join('');
    const body = email.bodyText?.trim()
      ? `<div class="body">${esc(email.bodyText)}</div>`
      : `<div class="body html">${email.bodyHtml ?? ''}</div>`;

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${esc(email.subject ?? '')}</title>
<style>
  /* Sin margen de página: así el navegador no imprime su encabezado ni su pie. */
  @page { margin: 0; }
  html, body { margin: 0; }
  body { padding: 16mm 18mm; color: #000; font-family: Calibri, Carlito, 'Segoe UI', Arial, sans-serif; font-size: 11pt; }
  .account { font-weight: bold; font-size: 13pt; padding-bottom: 2pt; border-bottom: 3px solid #000; margin-bottom: 10pt; }
  table { border-collapse: collapse; margin-bottom: 18pt; }
  th { text-align: left; font-weight: bold; vertical-align: top; padding: 0 22pt 1pt 0; white-space: nowrap; }
  td { vertical-align: top; padding: 0 0 1pt; }
  .body { white-space: pre-wrap; word-wrap: break-word; line-height: 1.25; }
  .body.html { white-space: normal; }
</style>
</head><body>
  <div class="account">DIREDTOS@MTO.GNA</div>
  <table>${header}</table>
  ${body}
</body></html>`;

    // Iframe oculto: no abre otra pestaña ni lo frena el bloqueador de ventanas.
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    }, 200);
  }

  onBodyCodeClick(event: MouseEvent): void {
    const span = (event.target as HTMLElement).closest<HTMLElement>('[data-ref-id]');
    const emailId = span?.getAttribute('data-ref-id');
    if (!emailId) return;
    this.bodyLoadError.set(false);
    this.mailService.getEmail(emailId).subscribe({
      next: (email) => {
        const truncated = this.navHistory().slice(0, this.navIndex() + 1);
        this.navHistory.set([...truncated, email]);
        this.navIndex.set(truncated.length);
        this.activeEmail.set(email);
        this.recordView(email.id);
      },
    });
  }

  navBack(): void {
    const idx = this.navIndex();
    if (idx <= 0) return;
    this.bodyLoadError.set(false);
    this.navIndex.set(idx - 1);
    this.activeEmail.set(this.navHistory()[idx - 1]);
  }

  navForward(): void {
    const idx = this.navIndex();
    const history = this.navHistory();
    if (idx >= history.length - 1) return;
    this.bodyLoadError.set(false);
    this.navIndex.set(idx + 1);
    this.activeEmail.set(history[idx + 1]);
  }
}
