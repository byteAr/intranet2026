import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import {
  DraftMailService,
  DraftEmail,
  DraftStatus,
} from '../../core/services/draft-mail.service';
import { AuthService } from '../../core/services/auth.service';
import { MailService, MailRecipient } from '../../core/services/mail.service';

const STATUS_LABELS: Record<DraftStatus, string> = {
  draft: 'Borrador',
  pending_review: 'En revisión',
  needs_correction: 'Requiere corrección',
  approved: 'Aprobado',
  sent: 'Enviado',
  cancelled: 'Cancelado',
};

const STATUS_CLASSES: Record<DraftStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_review: 'bg-amber-100 text-amber-700',
  needs_correction: 'bg-rose-100 text-rose-700',
  approved: 'bg-teal-100 text-teal-700',
  sent: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-gray-200 text-gray-500',
};

@Component({
  selector: 'app-draft-mail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">

      <!-- ── Left sidebar: draft list ────────────────────── -->
      <aside class="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col">

        <!-- Header -->
        <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
          <h2 class="text-sm font-semibold text-gray-700">
            @if (isAuthorizer()) { Revisión de borradores } @else { Mis borradores }
          </h2>
          @if (!isAuthorizer()) {
            <button (click)="openNew()"
              class="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-white"
              style="background:#0f766e">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Nuevo
            </button>
          }
        </div>

        <!-- List -->
        <div class="flex-1 overflow-y-auto">
          @if (loading()) {
            <div class="flex items-center justify-center h-20">
              <span class="text-sm text-gray-400">Cargando...</span>
            </div>
          } @else if (drafts().length === 0) {
            <div class="flex flex-col items-center justify-center h-32 text-gray-400 px-4">
              <svg class="h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <p class="text-sm text-center">
                @if (isAuthorizer()) { No hay borradores pendientes de revisión } @else { No tenés borradores }
              </p>
            </div>
          } @else {
            @for (draft of drafts(); track draft.id) {
              <button
                (click)="selectDraft(draft)"
                class="w-full text-left px-3 py-3 border-b border-gray-50 transition-all duration-150 hover:bg-gray-50 focus:outline-none"
                [class.bg-teal-50]="activeDraft()?.id === draft.id">
                <div class="flex items-center justify-between gap-1 mb-1">
                  <p class="text-xs font-semibold text-gray-700 truncate flex-1">{{ draft.subject || '(sin asunto)' }}</p>
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" [ngClass]="statusClass(draft.status)">
                    {{ statusLabel(draft.status) }}
                  </span>
                </div>
                <p class="text-xs text-gray-400 truncate">{{ draft.creatorName }}</p>
                <p class="text-[11px] text-gray-300 mt-0.5">{{ draft.createdAt | date:'dd/MM/yy HH:mm' }}</p>
              </button>
            }
          }
        </div>
      </aside>

      <!-- ── Right panel ─────────────────────────────────── -->
      <div class="flex-1 flex flex-col overflow-hidden">

        @if (showForm()) {
          <!-- ── New / Edit form ───────────────────────────── -->
          <div class="flex-1 overflow-y-auto p-5">
            <div class="max-w-2xl mx-auto space-y-4">

              <div class="flex items-center justify-between">
                <h3 class="text-base font-semibold text-gray-800">
                  {{ editingDraft() ? 'Editar borrador' : 'Nuevo borrador' }}
                </h3>
                <button (click)="closeForm()" class="text-gray-400 hover:text-gray-600">
                  <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <!-- TO (Ejecutivos) -->
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">Ejecutivos (Para)</label>
                <div class="border border-gray-200 rounded-lg p-2 flex flex-wrap gap-1.5 min-h-[2.5rem] bg-white focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-transparent">
                  @for (addr of toAddresses(); track addr) {
                    <span class="flex items-center gap-1 bg-teal-100 text-teal-800 text-xs px-2 py-0.5 rounded-full">
                      {{ addr }}
                      <button (click)="removeAddress('to', addr)" class="hover:text-teal-600 leading-none">×</button>
                    </span>
                  }
                  <div class="relative flex-1 min-w-[12rem]">
                    <input
                      [(ngModel)]="toInput"
                      (ngModelChange)="onRecipientChange($event, 'to')"
                      (keydown.enter)="addManualAddress('to')"
                      (keydown.tab)="addManualAddress('to')"
                      (keydown.comma)="addManualAddress('to')"
                      type="text"
                      placeholder="Escribir destinatario..."
                      class="w-full text-sm outline-none bg-transparent py-0.5" />
                    @if (toSuggestions().length > 0) {
                      <div class="absolute top-full left-0 z-20 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        @for (r of toSuggestions(); track r.email) {
                          <button (click)="selectRecipient('to', r)"
                            class="w-full text-left px-3 py-2 text-sm hover:bg-teal-50 flex flex-col">
                            <span class="font-medium text-gray-800">{{ r.displayName }}</span>
                            <span class="text-xs text-gray-400">{{ r.email }}</span>
                          </button>
                        }
                      </div>
                    }
                  </div>
                </div>
              </div>

              <!-- CC (Informativos) -->
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">Informativos (CC)</label>
                <div class="border border-gray-200 rounded-lg p-2 flex flex-wrap gap-1.5 min-h-[2.5rem] bg-white focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-transparent">
                  @for (addr of ccAddresses(); track addr) {
                    <span class="flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full">
                      {{ addr }}
                      <button (click)="removeAddress('cc', addr)" class="hover:text-gray-500 leading-none">×</button>
                    </span>
                  }
                  <div class="relative flex-1 min-w-[12rem]">
                    <input
                      [(ngModel)]="ccInput"
                      (ngModelChange)="onRecipientChange($event, 'cc')"
                      (keydown.enter)="addManualAddress('cc')"
                      (keydown.tab)="addManualAddress('cc')"
                      (keydown.comma)="addManualAddress('cc')"
                      type="text"
                      placeholder="Escribir CC..."
                      class="w-full text-sm outline-none bg-transparent py-0.5" />
                    @if (ccSuggestions().length > 0) {
                      <div class="absolute top-full left-0 z-20 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        @for (r of ccSuggestions(); track r.email) {
                          <button (click)="selectRecipient('cc', r)"
                            class="w-full text-left px-3 py-2 text-sm hover:bg-teal-50 flex flex-col">
                            <span class="font-medium text-gray-800">{{ r.displayName }}</span>
                            <span class="text-xs text-gray-400">{{ r.email }}</span>
                          </button>
                        }
                      </div>
                    }
                  </div>
                </div>
              </div>

              <!-- Subject -->
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">Asunto</label>
                <input [(ngModel)]="formSubject" type="text" placeholder="Asunto del correo"
                  class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
              </div>

              <!-- Body -->
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">Cuerpo</label>
                <textarea [(ngModel)]="formBody" rows="10" placeholder="Escribí el contenido del correo..."
                  class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none font-mono"></textarea>
              </div>

              <!-- Attachments -->
              @if (!editingDraft()) {
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">Adjuntos</label>
                  <input type="file" multiple (change)="onFilesSelected($event)"
                    class="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100" />
                  @if (selectedFiles().length > 0) {
                    <div class="mt-2 space-y-1">
                      @for (f of selectedFiles(); track f.name) {
                        <div class="flex items-center gap-2 text-xs text-gray-600">
                          <svg class="h-3.5 w-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          {{ f.name }}
                        </div>
                      }
                    </div>
                  }
                </div>
              }

              <!-- Error -->
              @if (formError()) {
                <div class="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {{ formError() }}
                </div>
              }

              <!-- Actions -->
              <div class="flex items-center gap-3">
                <button (click)="saveDraft()" [disabled]="saving()"
                  class="px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                  style="background:#0f766e">
                  {{ saving() ? 'Guardando...' : (editingDraft() ? 'Guardar cambios' : 'Guardar borrador') }}
                </button>
                @if (editingDraft() && editingDraft()!.status === 'needs_correction') {
                  <button (click)="submitDraft(editingDraft()!.id)" [disabled]="saving()"
                    class="px-5 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                    Reenviar a revisión
                  </button>
                }
                <button (click)="closeForm()" class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
                  Cancelar
                </button>
              </div>
            </div>
          </div>

        } @else if (activeDraft()) {
          <!-- ── Draft detail ───────────────────────────────── -->
          <div class="flex-1 overflow-y-auto p-5">
            <div class="max-w-2xl mx-auto space-y-5">

              <!-- Header row -->
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <h3 class="text-lg font-semibold text-gray-900 break-words">
                    {{ activeDraft()!.subject || '(sin asunto)' }}
                  </h3>
                  <p class="text-xs text-gray-400 mt-0.5">
                    Por {{ activeDraft()!.creatorName }} · {{ activeDraft()!.createdAt | date:'dd/MM/yy HH:mm' }}
                  </p>
                </div>
                <span class="text-xs px-2.5 py-1 rounded-full flex-shrink-0 font-medium"
                  [ngClass]="statusClass(activeDraft()!.status)">
                  {{ statusLabel(activeDraft()!.status) }}
                </span>
              </div>

              <!-- Recipients -->
              <div class="grid grid-cols-1 gap-2 text-sm">
                <div class="flex gap-2">
                  <span class="text-xs font-medium text-gray-400 w-20 flex-shrink-0 pt-0.5">Para:</span>
                  <div class="flex flex-wrap gap-1">
                    @for (a of activeDraft()!.toAddresses; track a) {
                      <span class="bg-teal-50 text-teal-700 text-xs px-2 py-0.5 rounded-full">{{ a }}</span>
                    }
                    @if (activeDraft()!.toAddresses.length === 0) {
                      <span class="text-gray-400 text-xs italic">Sin destinatarios</span>
                    }
                  </div>
                </div>
                @if (activeDraft()!.ccAddresses.length > 0) {
                  <div class="flex gap-2">
                    <span class="text-xs font-medium text-gray-400 w-20 flex-shrink-0 pt-0.5">CC:</span>
                    <div class="flex flex-wrap gap-1">
                      @for (a of activeDraft()!.ccAddresses; track a) {
                        <span class="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{{ a }}</span>
                      }
                    </div>
                  </div>
                }
              </div>

              <!-- Body -->
              <div class="bg-gray-50 rounded-lg p-4 text-sm text-gray-800 whitespace-pre-wrap font-mono border border-gray-100">
                {{ activeDraft()!.bodyText || '(sin contenido)' }}
              </div>

              <!-- Attachments -->
              @if (activeDraft()!.attachments.length > 0) {
                <div>
                  <p class="text-xs font-medium text-gray-500 mb-2">Adjuntos:</p>
                  <div class="space-y-1">
                    @for (att of activeDraft()!.attachments; track att.id) {
                      <a [href]="draftMailService.getAttachmentUrl(activeDraft()!.id, att.id)" target="_blank"
                        class="flex items-center gap-2 text-xs text-teal-700 hover:text-teal-900 hover:underline">
                        <svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        {{ att.filename }}
                      </a>
                    }
                  </div>
                </div>
              }

              <!-- Correction notes -->
              @if (activeDraft()!.correctionNotes) {
                <div class="rounded-lg bg-rose-50 border border-rose-200 p-4">
                  <p class="text-xs font-semibold text-rose-700 mb-1">Notas de corrección:</p>
                  <p class="text-sm text-rose-800 whitespace-pre-wrap">{{ activeDraft()!.correctionNotes }}</p>
                </div>
              }

              <!-- Action buttons -->
              <div class="flex flex-wrap gap-2 pt-2">

                <!-- Creator actions: draft or needs_correction -->
                @if (isCreator(activeDraft()!) && (activeDraft()!.status === 'draft' || activeDraft()!.status === 'needs_correction')) {
                  <button (click)="openEdit(activeDraft()!)"
                    class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
                    Editar
                  </button>
                }
                @if (isCreator(activeDraft()!) && activeDraft()!.status === 'draft') {
                  <button (click)="submitDraft(activeDraft()!.id)" [disabled]="saving()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                    Enviar a revisión
                  </button>
                  <button (click)="promptDelete(activeDraft()!.id)" [disabled]="saving()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-rose-600 border border-rose-200 hover:bg-rose-50 disabled:opacity-50">
                    Eliminar
                  </button>
                }
                @if (isCreator(activeDraft()!) && ['draft','pending_review','needs_correction'].includes(activeDraft()!.status)) {
                  @if (activeDraft()!.status !== 'draft') {
                    <button (click)="promptCancel()" class="px-4 py-2 rounded-lg text-sm font-medium text-rose-600 border border-rose-200 hover:bg-rose-50">
                      Cancelar
                    </button>
                  }
                }

                <!-- Creator: print when approved -->
                @if (isCreator(activeDraft()!) && activeDraft()!.status === 'approved' && activeDraft()!.hash) {
                  <button (click)="printDraft(activeDraft()!)"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-teal-700 border border-teal-300 hover:bg-teal-50 flex items-center gap-2">
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Imprimir para firmar
                  </button>
                  <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-50 border border-teal-200 text-sm">
                    <span class="text-xs text-teal-600 font-medium">Hash:</span>
                    <span class="font-mono font-bold text-teal-800 tracking-widest">{{ activeDraft()!.hash }}</span>
                  </div>
                }

                <!-- Authorizer actions: pending_review -->
                @if (isAuthorizer() && activeDraft()!.status === 'pending_review') {
                  <button (click)="approveDraft()" [disabled]="saving()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                    style="background:#0f766e">
                    Aprobar
                  </button>
                  <button (click)="showRejectForm.set(true)"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-amber-700 border border-amber-300 hover:bg-amber-50">
                    Devolver para corrección
                  </button>
                  <button (click)="promptTicomCancel()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-rose-600 border border-rose-200 hover:bg-rose-50">
                    Cancelar
                  </button>
                }
              </div>

              <!-- Reject form -->
              @if (showRejectForm()) {
                <div class="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                  <p class="text-sm font-medium text-amber-800">Notas de corrección para el redactor:</p>
                  <textarea [(ngModel)]="rejectNotes" rows="3"
                    class="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                    placeholder="Indicá qué debe corregir..."></textarea>
                  <div class="flex gap-2">
                    <button (click)="rejectDraft()" [disabled]="saving() || !rejectNotes.trim()"
                      class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                      Confirmar devolución
                    </button>
                    <button (click)="showRejectForm.set(false); rejectNotes = ''"
                      class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-700">
                      Cancelar
                    </button>
                  </div>
                </div>
              }

              <!-- Cancel form -->
              @if (showCancelForm()) {
                <div class="rounded-lg border border-rose-200 bg-rose-50 p-4 space-y-3">
                  <p class="text-sm font-medium text-rose-800">Motivo de cancelación:</p>
                  <textarea [(ngModel)]="cancelNotes" rows="3"
                    class="w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
                    placeholder="Indicá el motivo..."></textarea>
                  <div class="flex gap-2">
                    <button (click)="confirmCancel()" [disabled]="saving() || !cancelNotes.trim()"
                      class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50">
                      Confirmar cancelación
                    </button>
                    <button (click)="showCancelForm.set(false); cancelNotes = ''"
                      class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-700">
                      Cancelar
                    </button>
                  </div>
                </div>
              }

              <!-- History -->
              @if (activeDraft()!.history.length > 0) {
                <div class="border-t border-gray-100 pt-4">
                  <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Historial</p>
                  <div class="space-y-2">
                    @for (entry of activeDraft()!.history; track entry.at) {
                      <div class="flex gap-3 text-sm">
                        <div class="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5"></div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-baseline gap-2">
                            <span class="font-medium text-gray-700">{{ historyLabel(entry.type) }}</span>
                            <span class="text-xs text-gray-400">{{ entry.at | date:'dd/MM/yy HH:mm' }}</span>
                          </div>
                          <p class="text-xs text-gray-500">{{ entry.byName }}</p>
                          @if (entry.detail) {
                            <p class="text-xs text-gray-600 mt-0.5 italic">"{{ entry.detail }}"</p>
                          }
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }

            </div>
          </div>

        } @else {
          <!-- ── Empty state ──────────────────────────────── -->
          <div class="flex-1 flex flex-col items-center justify-center text-gray-300">
            <svg class="h-14 w-14 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <p class="text-sm">Seleccioná un borrador o creá uno nuevo</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .folder-btn { @apply flex items-center w-full px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors; }
  `],
})
export class DraftMailComponent implements OnInit, OnDestroy {
  readonly draftMailService = inject(DraftMailService);
  private readonly authService = inject(AuthService);
  private readonly mailService = inject(MailService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly drafts = signal<DraftEmail[]>([]);
  readonly activeDraft = signal<DraftEmail | null>(null);
  readonly showForm = signal(false);
  readonly editingDraft = signal<DraftEmail | null>(null);

  // Form fields
  readonly toAddresses = signal<string[]>([]);
  readonly ccAddresses = signal<string[]>([]);
  readonly toSuggestions = signal<MailRecipient[]>([]);
  readonly ccSuggestions = signal<MailRecipient[]>([]);
  toInput = '';
  ccInput = '';
  formSubject = '';
  formBody = '';
  readonly selectedFiles = signal<File[]>([]);
  readonly formError = signal<string | null>(null);

  // Review actions
  readonly showRejectForm = signal(false);
  readonly showCancelForm = signal(false);
  rejectNotes = '';
  cancelNotes = '';
  cancelIsTicom = false;

  private readonly toSearchSubject = new Subject<string>();
  private readonly ccSearchSubject = new Subject<string>();

  readonly isAuthorizer = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return false;
    return (
      user.roles?.includes('MTOSAUTORIZADOS') ||
      user.roles?.includes('TICOM') ||
      ['mlopez', 'sbatista'].includes(user.username?.toLowerCase() ?? '')
    );
  });

  ngOnInit(): void {
    this.loadDrafts();

    // React to real-time status changes from other users
    this.draftMailService.draftStatusChanged$.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ id }) => {
      this.draftMailService.getOne(id).subscribe({
        next: (updated) => {
          const inList = this.drafts().some((d) => d.id === id);
          if (inList) {
            this.drafts.update((list) => list.map((d) => d.id === id ? updated : d));
          } else {
            // Draft just became visible (e.g. new submitted draft for authorizer)
            this.drafts.update((list) => [updated, ...list]);
          }
          if (this.activeDraft()?.id === id) {
            this.activeDraft.set(updated);
          }
        },
        error: () => {
          // Draft no longer accessible (e.g. cancelled by authorizer) — remove from list
          this.drafts.update((list) => list.filter((d) => d.id !== id));
          if (this.activeDraft()?.id === id) this.activeDraft.set(null);
        },
      });
    });

    this.toSearchSubject.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) => q.length < 2 ? of([]) : this.mailService.searchRecipients(q)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => this.toSuggestions.set(r));

    this.ccSearchSubject.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) => q.length < 2 ? of([]) : this.mailService.searchRecipients(q)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => this.ccSuggestions.set(r));
  }

  ngOnDestroy(): void {}

  loadDrafts(): void {
    this.loading.set(true);
    this.draftMailService.getAll().subscribe({
      next: (list) => { this.drafts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  selectDraft(draft: DraftEmail): void {
    this.activeDraft.set(draft);
    this.showForm.set(false);
    this.editingDraft.set(null);
    this.showRejectForm.set(false);
    this.showCancelForm.set(false);
  }

  openNew(): void {
    this.editingDraft.set(null);
    this.activeDraft.set(null);
    this.toAddresses.set([]);
    this.ccAddresses.set([]);
    this.formSubject = '';
    this.formBody = '';
    this.selectedFiles.set([]);
    this.formError.set(null);
    this.showForm.set(true);
  }

  openEdit(draft: DraftEmail): void {
    this.editingDraft.set(draft);
    this.toAddresses.set([...draft.toAddresses]);
    this.ccAddresses.set([...draft.ccAddresses]);
    this.formSubject = draft.subject;
    this.formBody = draft.bodyText;
    this.formError.set(null);
    this.showForm.set(true);
  }

  closeForm(): void {
    this.showForm.set(false);
    this.editingDraft.set(null);
    this.formError.set(null);
  }

  onRecipientChange(q: string, field: 'to' | 'cc'): void {
    if (field === 'to') this.toSearchSubject.next(q);
    else this.ccSearchSubject.next(q);
  }

  selectRecipient(field: 'to' | 'cc', r: MailRecipient): void {
    if (field === 'to') {
      if (!this.toAddresses().includes(r.email)) {
        this.toAddresses.update((a) => [...a, r.email]);
      }
      this.toInput = '';
      this.toSuggestions.set([]);
    } else {
      if (!this.ccAddresses().includes(r.email)) {
        this.ccAddresses.update((a) => [...a, r.email]);
      }
      this.ccInput = '';
      this.ccSuggestions.set([]);
    }
  }

  addManualAddress(field: 'to' | 'cc'): void {
    const raw = field === 'to' ? this.toInput.trim().replace(/,$/, '') : this.ccInput.trim().replace(/,$/, '');
    if (!raw || !raw.includes('@')) return;
    if (field === 'to') {
      if (!this.toAddresses().includes(raw)) this.toAddresses.update((a) => [...a, raw]);
      this.toInput = '';
      this.toSuggestions.set([]);
    } else {
      if (!this.ccAddresses().includes(raw)) this.ccAddresses.update((a) => [...a, raw]);
      this.ccInput = '';
      this.ccSuggestions.set([]);
    }
  }

  removeAddress(field: 'to' | 'cc', addr: string): void {
    if (field === 'to') this.toAddresses.update((a) => a.filter((x) => x !== addr));
    else this.ccAddresses.update((a) => a.filter((x) => x !== addr));
  }

  onFilesSelected(event: Event): void {
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    this.selectedFiles.set(files.slice(0, 10));
  }

  saveDraft(): void {
    this.formError.set(null);
    if (this.editingDraft()) {
      this.saving.set(true);
      this.draftMailService.update(this.editingDraft()!.id, {
        subject: this.formSubject,
        bodyText: this.formBody,
        toAddresses: this.toAddresses(),
        ccAddresses: this.ccAddresses(),
      }).subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.drafts.update((list) => list.map((d) => d.id === updated.id ? updated : d));
          this.activeDraft.set(updated);
          this.showForm.set(false);
          this.editingDraft.set(null);
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.formError.set(err?.error?.message ?? 'Error al guardar');
        },
      });
    } else {
      const fd = new FormData();
      fd.append('subject', this.formSubject);
      fd.append('bodyText', this.formBody);
      this.toAddresses().forEach((a) => fd.append('toAddresses[]', a));
      this.ccAddresses().forEach((a) => fd.append('ccAddresses[]', a));
      this.selectedFiles().forEach((f) => fd.append('files', f, f.name));
      this.saving.set(true);
      this.draftMailService.create(fd).subscribe({
        next: (created) => {
          this.saving.set(false);
          this.drafts.update((list) => [created, ...list]);
          this.activeDraft.set(created);
          this.showForm.set(false);
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.formError.set(err?.error?.message ?? 'Error al crear el borrador');
        },
      });
    }
  }

  submitDraft(id: string): void {
    this.saving.set(true);
    this.draftMailService.submit(id).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.drafts.update((list) => list.map((d) => d.id === updated.id ? updated : d));
        this.activeDraft.set(updated);
        this.showForm.set(false);
        this.editingDraft.set(null);
      },
      error: () => this.saving.set(false),
    });
  }

  approveDraft(): void {
    const id = this.activeDraft()?.id;
    if (!id) return;
    this.saving.set(true);
    this.draftMailService.approve(id).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.drafts.update((list) => list.map((d) => d.id === updated.id ? updated : d));
        this.activeDraft.set(updated);
      },
      error: () => this.saving.set(false),
    });
  }

  rejectDraft(): void {
    const id = this.activeDraft()?.id;
    if (!id || !this.rejectNotes.trim()) return;
    this.saving.set(true);
    this.draftMailService.reject(id, this.rejectNotes).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.drafts.update((list) => list.map((d) => d.id === updated.id ? updated : d));
        this.activeDraft.set(updated);
        this.showRejectForm.set(false);
        this.rejectNotes = '';
      },
      error: () => this.saving.set(false),
    });
  }

  promptCancel(): void {
    this.cancelIsTicom = false;
    this.cancelNotes = '';
    this.showCancelForm.set(true);
  }

  promptTicomCancel(): void {
    this.cancelIsTicom = true;
    this.cancelNotes = '';
    this.showCancelForm.set(true);
  }

  confirmCancel(): void {
    const id = this.activeDraft()?.id;
    if (!id || !this.cancelNotes.trim()) return;
    this.saving.set(true);
    const obs = this.cancelIsTicom
      ? this.draftMailService.ticomCancel(id, this.cancelNotes)
      : this.draftMailService.cancel(id, this.cancelNotes);
    obs.subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.drafts.update((list) => list.map((d) => d.id === updated.id ? updated : d));
        this.activeDraft.set(updated);
        this.showCancelForm.set(false);
        this.cancelNotes = '';
      },
      error: () => this.saving.set(false),
    });
  }

  promptDelete(id: string): void {
    if (!confirm('¿Eliminar este borrador?')) return;
    this.draftMailService.delete(id).subscribe({
      next: () => {
        this.drafts.update((list) => list.filter((d) => d.id !== id));
        this.activeDraft.set(null);
      },
      error: () => {},
    });
  }

  isCreator(draft: DraftEmail): boolean {
    return draft.creatorId === this.authService.currentUser()?.id;
  }

  statusLabel(s: DraftStatus): string {
    return STATUS_LABELS[s] ?? s;
  }

  statusClass(s: DraftStatus): string {
    return STATUS_CLASSES[s] ?? 'bg-gray-100 text-gray-500';
  }

  historyLabel(type: string): string {
    const map: Record<string, string> = {
      created: 'Creado',
      submitted: 'Enviado a revisión',
      resubmitted: 'Reenviado a revisión',
      approved: 'Aprobado',
      rejected: 'Devuelto para corrección',
      cancelled: 'Cancelado',
      ticom_cancelled: 'Cancelado por TICOM',
      sent: 'Enviado',
      edited: 'Editado',
      delegated: 'Delegado',
    };
    return map[type] ?? type;
  }

  printDraft(draft: DraftEmail): void {
    const w = window.open('', '_blank', 'width=850,height=1100');
    if (!w) return;
    w.document.write(this.buildPrintHtml(draft));
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  }

  private buildPrintHtml(draft: DraftEmail): string {
    const toList = draft.toAddresses.join(' \u2013 ') || '-';
    const ccList = draft.ccAddresses.length ? draft.ccAddresses.join(' \u2013 ') : '-';
    const approvedDate = draft.approvedAt ? new Date(draft.approvedAt) : new Date();
    const hash = draft.hash ?? '';
    const body = this.escapeHtml(draft.bodyText);
    const zoprDate = this.fmtDateGroup(approvedDate);
    const months = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const fechaLarga = `${months[approvedDate.getMonth()]} ${approvedDate.getFullYear()}`;
    const approvedBy = this.escapeHtml(draft.approvedByName ?? '');
    const creator = this.escapeHtml(draft.creatorName);

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>MTO</title>
<style>
  @page { size: A4; margin: 15mm 15mm 20mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; }
  .page-border { border: 1px solid #000; padding: 6px; min-height: 257mm; display: flex; flex-direction: column; }

  /* TOP HEADER TABLE */
  .top-header { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  .top-header td { border: 1px solid #000; padding: 4px 8px; }
  .td-gn { font-size: 10pt; font-weight: normal; width: 45%; }
  .td-mto { font-size: 12pt; font-weight: bold; text-align: center; }

  /* ZOPR ROW */
  .zopr-row { width: 100%; border-collapse: collapse; }
  .zopr-row td { border: 1px solid #000; border-top: 0; padding: 3px 8px; }
  .td-zopr { font-size: 11pt; font-weight: bold; letter-spacing: 4px; width: 45%; }
  .td-date { text-align: right; font-size: 10pt; }

  /* META ROWS */
  .meta { width: 100%; border-collapse: collapse; }
  .meta td { border: 1px solid #000; border-top: 0; padding: 3px 8px; }
  .meta .lbl { font-weight: bold; white-space: nowrap; width: 1%; padding-right: 6px; }

  /* BODY */
  .body-cell { border: 1px solid #000; border-top: 0; padding: 6px 8px; min-height: 100px; white-space: pre-wrap; font-size: 9pt; line-height: 1.5; flex: 1; }

  /* FOOTER TABLE */
  .footer-tbl { width: 100%; border-collapse: collapse; margin-top: 0; }
  .footer-tbl td { border: 1px solid #000; border-top: 0; padding: 3px 6px; font-size: 8.5pt; vertical-align: top; }
  .ft-labels { width: 22%; }
  .ft-middle { width: 40%; }
  .ft-right { width: 38%; }

  /* SIGNATURE */
  .signature { text-align: center; margin-top: 10px; font-size: 9pt; line-height: 1.6; }

  /* HASH FOOTER */
  .hash-footer { margin-top: auto; border-top: 1px dashed #666; padding-top: 4px; text-align: center; font-size: 7.5pt; color: #444; }
  .hash-value { font-size: 13pt; font-weight: bold; letter-spacing: 5px; color: #000; font-family: 'Courier New', monospace; }

  @media print { .no-print { display: none !important; } }
</style>
</head>
<body>
<div class="page-border">

  <table class="top-header">
    <tr>
      <td class="td-gn">GENDARMERÍA NACIONAL</td>
      <td class="td-mto">MENSAJE DE TRAFICO OFICIAL</td>
    </tr>
  </table>

  <table class="zopr-row">
    <tr>
      <td class="td-zopr">Z &nbsp; O &nbsp; P &nbsp; R</td>
      <td class="td-date">&hellip;&hellip;&hellip;&hellip;&hellip;${zoprDate}</td>
    </tr>
  </table>

  <table class="meta">
    <tr><td class="lbl">PROMOTOR (S):</td><td>${creator}</td></tr>
    <tr><td class="lbl">EJECUTIVO (S):</td><td>${this.escapeHtml(toList)}</td></tr>
    <tr><td class="lbl">INFORMATIVO(S):</td><td>${this.escapeHtml(ccList)}</td></tr>
    <tr><td class="lbl">EXCEPTUADO (S):</td><td>&nbsp;</td></tr>
  </table>

  <div class="body-cell">${body}</div>

  <table class="footer-tbl">
    <tr>
      <td class="ft-labels" rowspan="5">
        <div style="margin-bottom:8px">BT:</div>
        <div style="margin-bottom:8px">RECIBO:</div>
        <div style="margin-bottom:8px">RETRANSMITIDO:</div>
        <div style="margin-bottom:8px">TRANSMITIDO:</div>
        <div>ENT. CENTRAL:</div>
      </td>
      <td class="ft-middle" rowspan="2">
        <div>Lugar: BUENOS AIRES</div>
        <div>Fecha: ${fechaLarga}</div>
      </td>
      <td class="ft-right" style="font-weight:bold; text-align:center">CLASIFICACIÓN</td>
    </tr>
    <tr>
      <td class="ft-right" style="text-align:center">SELLO: &nbsp;/&nbsp; TRAMÍTESE</td>
    </tr>
    <tr><td class="ft-middle" colspan="1">&nbsp;</td><td class="ft-right">&nbsp;</td></tr>
    <tr><td class="ft-middle" colspan="1">&nbsp;</td><td class="ft-right">&nbsp;</td></tr>
    <tr><td class="ft-middle" colspan="1">&nbsp;</td><td class="ft-right">&nbsp;</td></tr>
  </table>

  <div class="signature">
    ${approvedBy}<br>
    <strong></strong>
  </div>

  <div class="hash-footer">
    HASH DE VERIFICACIÓN (no se envía con el correo)<br>
    <span class="hash-value">${hash}</span>
  </div>

</div>
</body>
</html>`;
  }

  private fmtDateGroup(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    const mon = months[d.getMonth()];
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}${hh}${mm}${mon}${yy}`;
  }

  private escapeHtml(text: string): string {
    return (text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
