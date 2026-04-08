import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  MailService,
  Email,
  MailFolder,
  SendEmailDto,
  MailRecipient,
  MailUnreadCounts,
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

          @if (isTicom) {
            <button (click)="openCompose()"
              class="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white transition-colors"
              style="background:#0f766e">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Redactar
            </button>
          }
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
        @if (isSearchMode() || isAdvancedMode()) {
          <div class="px-3 py-2 flex items-center justify-between border-b border-gray-100">
            <span class="text-xs text-gray-400">
              @if (isAdvancedMode()) { Búsqueda avanzada } @else { Resultados }
            </span>
            <button (click)="isAdvancedMode() ? clearAdvancedSearch() : clearSearch()"
              class="text-xs text-teal-600 hover:text-teal-800">Limpiar</button>
          </div>
        }

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
          } @else {
            @for (email of mailService.emails(); track email.id) {
              <button
                (click)="selectEmail(email)"
                [attr.data-email-id]="email.id"
                class="w-full text-left px-3 py-3 border-b border-gray-50 transition-all duration-150 hover:bg-gray-50 focus:outline-none"
                [ngClass]="{
                  'bg-teal-50 -translate-y-0.5 shadow-md relative z-10': activeEmail()?.id === email.id,
                  'border-l-2 border-l-teal-500': !isRead(email)
                }">
                <div class="flex items-center justify-between gap-1">
                  <p class="text-xs font-medium text-gray-700 truncate flex-1"
                     [class.font-semibold]="!isRead(email)">
                    {{ email.fromAddress }}
                  </p>
                  <div class="flex items-center gap-1 flex-shrink-0">
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
                <div class="flex items-center justify-end mt-1">
                  <span class="text-xs px-1.5 py-0.5 rounded-full" [ngClass]="folderBadgeClass(email.folder)">
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
                <!-- Para -->
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">Para *</label>
                  <div class="relative">
                    <div class="flex flex-wrap gap-1 min-h-[38px] px-2 py-1.5 border border-gray-300 rounded-md focus-within:ring-2 focus-within:ring-teal-500 cursor-text"
                         (click)="toInputRef.focus()">
                      @for (r of composeToList(); track r.email) {
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-teal-100 text-teal-800 rounded-full shrink-0">
                          {{ r.displayName }}
                          <button type="button" (click)="$event.stopPropagation(); removeToRecipient(r)"
                            class="text-teal-600 hover:text-red-500 font-bold leading-none">&times;</button>
                        </span>
                      }
                      <input #toInputRef
                        [(ngModel)]="toQuery"
                        (input)="onToInput()"
                        (keydown.backspace)="onToBackspace()"
                        (keydown.escape)="toDropdownOpen.set(false)"
                        (blur)="onToBlur()"
                        type="text"
                        [placeholder]="composeToList().length === 0 ? 'Buscar destinatario...' : ''"
                        class="flex-1 min-w-[120px] outline-none text-sm bg-transparent py-0.5" />
                    </div>
                    @if (toDropdownOpen()) {
                      <div class="absolute left-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                        @if (toSearching()) {
                          <div class="px-3 py-2 text-sm text-gray-400">Buscando...</div>
                        } @else if (toSuggestions().length === 0) {
                          <div class="px-3 py-2 text-sm text-gray-400">Sin resultados</div>
                        } @else {
                          @for (s of toSuggestions(); track s.email) {
                            <button type="button" (mousedown)="selectToRecipient(s)"
                              class="w-full text-left px-3 py-2 hover:bg-teal-50 transition-colors border-b border-gray-50 last:border-0">
                              <p class="text-sm font-medium text-gray-800">{{ s.displayName }}</p>
                              <p class="text-xs text-gray-500">{{ s.email }}{{ s.department ? ' — ' + s.department : '' }}</p>
                            </button>
                          }
                        }
                      </div>
                    }
                  </div>
                </div>
                <!-- CC -->
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">CC</label>
                  <div class="relative">
                    <div class="flex flex-wrap gap-1 min-h-[38px] px-2 py-1.5 border border-gray-300 rounded-md focus-within:ring-2 focus-within:ring-teal-500 cursor-text"
                         (click)="ccInputRef.focus()">
                      @for (r of composeCcList(); track r.email) {
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded-full shrink-0">
                          {{ r.displayName }}
                          <button type="button" (click)="$event.stopPropagation(); removeCcRecipient(r)"
                            class="text-gray-500 hover:text-red-500 font-bold leading-none">&times;</button>
                        </span>
                      }
                      <input #ccInputRef
                        [(ngModel)]="ccQuery"
                        (input)="onCcInput()"
                        (keydown.backspace)="onCcBackspace()"
                        (keydown.escape)="ccDropdownOpen.set(false)"
                        (blur)="onCcBlur()"
                        type="text"
                        [placeholder]="composeCcList().length === 0 ? 'Buscar destinatario...' : ''"
                        class="flex-1 min-w-[120px] outline-none text-sm bg-transparent py-0.5" />
                    </div>
                    @if (ccDropdownOpen()) {
                      <div class="absolute left-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                        @if (ccSearching()) {
                          <div class="px-3 py-2 text-sm text-gray-400">Buscando...</div>
                        } @else if (ccSuggestions().length === 0) {
                          <div class="px-3 py-2 text-sm text-gray-400">Sin resultados</div>
                        } @else {
                          @for (s of ccSuggestions(); track s.email) {
                            <button type="button" (mousedown)="selectCcRecipient(s)"
                              class="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                              <p class="text-sm font-medium text-gray-800">{{ s.displayName }}</p>
                              <p class="text-xs text-gray-500">{{ s.email }}{{ s.department ? ' — ' + s.department : '' }}</p>
                            </button>
                          }
                        }
                      </div>
                    }
                  </div>
                </div>
                <!-- CCO -->
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">CCO (copia oculta)</label>
                  <div class="relative">
                    <div class="flex flex-wrap gap-1 min-h-[38px] px-2 py-1.5 border border-gray-300 rounded-md focus-within:ring-2 focus-within:ring-teal-500 cursor-text"
                         (click)="bccInputRef.focus()">
                      @for (r of composeBccList(); track r.email) {
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded-full shrink-0">
                          {{ r.displayName }}
                          <button type="button" (click)="$event.stopPropagation(); removeBccRecipient(r)"
                            class="text-gray-500 hover:text-red-500 font-bold leading-none">&times;</button>
                        </span>
                      }
                      <input #bccInputRef
                        [(ngModel)]="bccQuery"
                        (input)="onBccInput()"
                        (keydown.backspace)="onBccBackspace()"
                        (keydown.escape)="bccDropdownOpen.set(false)"
                        (blur)="onBccBlur()"
                        type="text"
                        [placeholder]="composeBccList().length === 0 ? 'Buscar destinatario...' : ''"
                        class="flex-1 min-w-[120px] outline-none text-sm bg-transparent py-0.5" />
                    </div>
                    @if (bccDropdownOpen()) {
                      <div class="absolute left-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                        @if (bccSearching()) {
                          <div class="px-3 py-2 text-sm text-gray-400">Buscando...</div>
                        } @else if (bccSuggestions().length === 0) {
                          <div class="px-3 py-2 text-sm text-gray-400">Sin resultados</div>
                        } @else {
                          @for (s of bccSuggestions(); track s.email) {
                            <button type="button" (mousedown)="selectBccRecipient(s)"
                              class="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                              <p class="text-sm font-medium text-gray-800">{{ s.displayName }}</p>
                              <p class="text-xs text-gray-500">{{ s.email }}{{ s.department ? ' — ' + s.department : '' }}</p>
                            </button>
                          }
                        }
                      </div>
                    }
                  </div>
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
              <div class="flex items-start justify-between gap-3 mb-2">
                <h1 class="text-base font-semibold text-gray-900 leading-snug" [innerHTML]="highlightText(activeEmail()!.subject)"></h1>
                <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span class="text-xs px-2 py-0.5 rounded-full" [ngClass]="folderBadgeClass(activeEmail()!.folder)">
                    {{ folderLabel(activeEmail()!.folder) }}
                  </span>
                  <button (click)="printEmail()"
                    class="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
                    title="Imprimir email">
                    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"/>
                    </svg>
                    Imprimir
                  </button>
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
                        <span class="text-gray-600 truncate w-full text-center" style="font-size:9px" [innerHTML]="highlightText(att.filename)"></span>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Body — codes highlighted green (exists) / red (not found) -->
            <div (click)="onBodyCodeClick($event)"
                 (mouseup)="onBodyMouseUp($event)"
                 [innerHTML]="highlightedBodyHtml()"></div>

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


  readonly showCompose = signal(false);
  readonly composeSending = signal(false);
  readonly composeSent = signal(false);
  readonly composeError = signal('');
  readonly composeFiles = signal<File[]>([]);
  composeSubject = '';
  composeBody = '';
  searchQuery = '';

  // Recipient pickers
  readonly composeToList = signal<MailRecipient[]>([]);
  readonly composeCcList = signal<MailRecipient[]>([]);
  readonly composeBccList = signal<MailRecipient[]>([]);
  toQuery = '';
  ccQuery = '';
  bccQuery = '';
  readonly toSuggestions = signal<MailRecipient[]>([]);
  readonly ccSuggestions = signal<MailRecipient[]>([]);
  readonly bccSuggestions = signal<MailRecipient[]>([]);
  readonly toDropdownOpen = signal(false);
  readonly ccDropdownOpen = signal(false);
  readonly bccDropdownOpen = signal(false);
  readonly toSearching = signal(false);
  readonly ccSearching = signal(false);
  readonly bccSearching = signal(false);
  private toSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private ccSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private bccSearchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.mailService.totalEmails() / 30))
  );

  readonly copyTooltip = signal<{ x: number; y: number; copied: boolean } | null>(null);
  private suppressTooltip = false;

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

  get isTicom(): boolean {
    return this.mailService.isTicom;
  }

  ngOnInit(): void {
    this.mailService.connect();
    this.mailService.loadEmails();
    this.mailService.loadUnreadCounts();
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (this.showCompose()) return;
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
    this.mailService.loadEmails(undefined, 1, 30, next);
  }

  selectEmail(email: Email): void {
    if (this.activeEmail()?.id === email.id) return;
    this.showCompose.set(false);
    this.navHistory.set([]);
    this.navIndex.set(-1);
    this.activeEmail.set(email);
    this.mailService.getEmail(email.id).subscribe({
      next: (full) => {
        this.activeEmail.set(full);
        this.navHistory.set([full]);
        this.navIndex.set(0);
      },
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
          if (!this.isHistorical()) {
            this.mailService.decrementUnread(email.folder);
          }
        },
      });
    }
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

  openCompose(): void {
    this.showCompose.set(true);
    this.activeEmail.set(null);
    this.composeToList.set([]);
    this.composeCcList.set([]);
    this.composeBccList.set([]);
    this.toQuery = '';
    this.ccQuery = '';
    this.bccQuery = '';
    this.toSuggestions.set([]);
    this.ccSuggestions.set([]);
    this.bccSuggestions.set([]);
    this.toDropdownOpen.set(false);
    this.ccDropdownOpen.set(false);
    this.bccDropdownOpen.set(false);
    this.composeSubject = '';
    this.composeBody = '';
    this.composeError.set('');
    this.composeSent.set(false);
    this.composeFiles.set([]);
  }

  // ── To field ────────────────────────────────────────────
  onToInput(): void {
    if (this.toSearchTimer) clearTimeout(this.toSearchTimer);
    if (this.toQuery.trim().length < 2) {
      this.toSuggestions.set([]);
      this.toDropdownOpen.set(false);
      return;
    }
    this.toDropdownOpen.set(true);
    this.toSearching.set(true);
    this.toSearchTimer = setTimeout(() => {
      this.mailService.searchRecipients(this.toQuery.trim()).subscribe({
        next: (results) => {
          const selected = new Set(this.composeToList().map((r) => r.email));
          this.toSuggestions.set(results.filter((r) => !selected.has(r.email)));
          this.toSearching.set(false);
        },
        error: () => { this.toSearching.set(false); this.toSuggestions.set([]); },
      });
    }, 300);
  }

  selectToRecipient(r: MailRecipient): void {
    this.composeToList.update((list) =>
      list.some((x) => x.email === r.email) ? list : [...list, r],
    );
    this.toQuery = '';
    this.toSuggestions.set([]);
    this.toDropdownOpen.set(false);
  }

  removeToRecipient(r: MailRecipient): void {
    this.composeToList.update((list) => list.filter((x) => x.email !== r.email));
  }

  onToBackspace(): void {
    if (this.toQuery !== '') return;
    this.composeToList.update((list) => list.slice(0, -1));
  }

  onToBlur(): void {
    setTimeout(() => this.toDropdownOpen.set(false), 150);
  }

  // ── CC field ─────────────────────────────────────────────
  onCcInput(): void {
    if (this.ccSearchTimer) clearTimeout(this.ccSearchTimer);
    if (this.ccQuery.trim().length < 2) {
      this.ccSuggestions.set([]);
      this.ccDropdownOpen.set(false);
      return;
    }
    this.ccDropdownOpen.set(true);
    this.ccSearching.set(true);
    this.ccSearchTimer = setTimeout(() => {
      this.mailService.searchRecipients(this.ccQuery.trim()).subscribe({
        next: (results) => {
          const selected = new Set(this.composeCcList().map((r) => r.email));
          this.ccSuggestions.set(results.filter((r) => !selected.has(r.email)));
          this.ccSearching.set(false);
        },
        error: () => { this.ccSearching.set(false); this.ccSuggestions.set([]); },
      });
    }, 300);
  }

  selectCcRecipient(r: MailRecipient): void {
    this.composeCcList.update((list) =>
      list.some((x) => x.email === r.email) ? list : [...list, r],
    );
    this.ccQuery = '';
    this.ccSuggestions.set([]);
    this.ccDropdownOpen.set(false);
  }

  removeCcRecipient(r: MailRecipient): void {
    this.composeCcList.update((list) => list.filter((x) => x.email !== r.email));
  }

  onCcBackspace(): void {
    if (this.ccQuery !== '') return;
    this.composeCcList.update((list) => list.slice(0, -1));
  }

  onCcBlur(): void {
    setTimeout(() => this.ccDropdownOpen.set(false), 150);
  }

  // ── BCC field ─────────────────────────────────────────────
  onBccInput(): void {
    if (this.bccSearchTimer) clearTimeout(this.bccSearchTimer);
    if (this.bccQuery.trim().length < 2) {
      this.bccSuggestions.set([]);
      this.bccDropdownOpen.set(false);
      return;
    }
    this.bccDropdownOpen.set(true);
    this.bccSearching.set(true);
    this.bccSearchTimer = setTimeout(() => {
      this.mailService.searchRecipients(this.bccQuery.trim()).subscribe({
        next: (results) => {
          const selected = new Set(this.composeBccList().map((r) => r.email));
          this.bccSuggestions.set(results.filter((r) => !selected.has(r.email)));
          this.bccSearching.set(false);
        },
        error: () => { this.bccSearching.set(false); this.bccSuggestions.set([]); },
      });
    }, 300);
  }

  selectBccRecipient(r: MailRecipient): void {
    this.composeBccList.update((list) =>
      list.some((x) => x.email === r.email) ? list : [...list, r],
    );
    this.bccQuery = '';
    this.bccSuggestions.set([]);
    this.bccDropdownOpen.set(false);
  }

  removeBccRecipient(r: MailRecipient): void {
    this.composeBccList.update((list) => list.filter((x) => x.email !== r.email));
  }

  onBccBackspace(): void {
    if (this.bccQuery !== '') return;
    this.composeBccList.update((list) => list.slice(0, -1));
  }

  onBccBlur(): void {
    setTimeout(() => this.bccDropdownOpen.set(false), 150);
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
    if (this.toQuery.trim()) { this.composeError.set('Seleccioná un destinatario de la lista o borrá el texto del campo Para.'); return; }
    if (this.ccQuery.trim()) { this.composeError.set('Seleccioná un destinatario de la lista o borrá el texto del campo CC.'); return; }
    if (this.bccQuery.trim()) { this.composeError.set('Seleccioná un destinatario de la lista o borrá el texto del campo CCO.'); return; }
    const to = this.composeToList().map((r) => r.email);
    const cc = this.composeCcList().map((r) => r.email);
    const bcc = this.composeBccList().map((r) => r.email);
    if (!to.length) { this.composeError.set('Ingresá al menos un destinatario.'); return; }
    if (!this.composeSubject.trim()) { this.composeError.set('El asunto es obligatorio.'); return; }
    if (!this.composeBody.trim()) { this.composeError.set('El cuerpo es obligatorio.'); return; }

    this.composeError.set('');
    this.composeSending.set(true);
    this.composeSent.set(false);

    const dto: SendEmailDto = {
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
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
      ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
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

  printEmail(): void {
    const email = this.activeEmail();
    if (!email) return;
    const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const meta = [
      `<tr><th>De</th><td>${escHtml(email.fromAddress)}</td></tr>`,
      `<tr><th>Para</th><td>${escHtml((email.toAddresses ?? []).join(', '))}</td></tr>`,
      email.ccAddresses?.length ? `<tr><th>CC</th><td>${escHtml(email.ccAddresses.join(', '))}</td></tr>` : '',
      `<tr><th>Fecha</th><td>${this.formatFullDate(email.date)}</td></tr>`,
      `<tr><th>Asunto</th><td>${escHtml(email.subject)}</td></tr>`,
      `<tr><th>Tipo</th><td>${this.folderLabel(email.folder)}</td></tr>`,
      email.mailCode ? `<tr><th>Código</th><td>${escHtml(email.mailCode)}</td></tr>` : '',
    ].filter(Boolean).join('');
    const attachList = email.attachments?.length
      ? `<div class="attachments"><strong>Adjuntos:</strong> ${email.attachments.map(a => escHtml(a.filename)).join(', ')}</div>`
      : '';
    const body = email.bodyText
      ? `<pre>${escHtml(email.bodyText)}</pre>`
      : (email.bodyHtml ?? '');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>${escHtml(email.subject)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 20px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
        th { text-align: left; width: 70px; color: #555; font-weight: 600; padding: 2px 8px 2px 0; vertical-align: top; }
        td { padding: 2px 0; }
        hr { border: none; border-top: 1px solid #ccc; margin: 12px 0; }
        pre { white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 12px; margin: 0; }
        .attachments { margin-top: 12px; font-size: 11px; color: #555; }
        @media print { body { margin: 0; } }
      </style>
    </head><body>
      <table>${meta}</table>
      <hr>
      ${attachList}
      ${body}
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  onBodyCodeClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const emailId = target.getAttribute('data-ref-id');
    if (!emailId) return;
    this.mailService.getEmail(emailId).subscribe({
      next: (email) => {
        const truncated = this.navHistory().slice(0, this.navIndex() + 1);
        this.navHistory.set([...truncated, email]);
        this.navIndex.set(truncated.length);
        this.activeEmail.set(email);
      },
    });
  }

  navBack(): void {
    const idx = this.navIndex();
    if (idx <= 0) return;
    this.navIndex.set(idx - 1);
    this.activeEmail.set(this.navHistory()[idx - 1]);
  }

  navForward(): void {
    const idx = this.navIndex();
    const history = this.navHistory();
    if (idx >= history.length - 1) return;
    this.navIndex.set(idx + 1);
    this.activeEmail.set(history[idx + 1]);
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
