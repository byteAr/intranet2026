import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  DestroyRef,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DraftMailService,
  DraftEmail,
  DraftStatus,
} from '../../core/services/draft-mail.service';
import { AuthService } from '../../core/services/auth.service';
import { MailService, MailRecipient, Email, MailOutgoingRef } from '../../core/services/mail.service';
import { AttachmentPreviewModalComponent, AttachmentPreviewRequest } from '../../shared/attachment-preview-modal/attachment-preview-modal.component';

const STATUS_LABELS: Record<DraftStatus, string> = {
  draft: 'Borrador',
  needs_correction: 'Requiere corrección',
  approved: 'Confirmado',
  sent: 'Enviado',
  cancelled: 'Cancelado',
};

const STATUS_CLASSES: Record<DraftStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  needs_correction: 'bg-rose-100 text-rose-700',
  approved: 'bg-teal-100 text-teal-700',
  sent: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-gray-200 text-gray-500',
};

const MONTHS_LONG = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
const MONTHS_SHORT = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

@Component({
  selector: 'app-draft-mail',
  standalone: true,
  imports: [CommonModule, FormsModule, AttachmentPreviewModalComponent],
  template: `
    <div class="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">

      <!-- ── Left sidebar: draft list ────────────────────── -->
      <aside class="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col">

        <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
          <h2 class="text-sm font-semibold text-gray-700">Mis borradores</h2>
          <button (click)="openNew()"
            class="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-white"
            style="background:#0f766e">
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Nuevo
          </button>
        </div>

        <div class="flex-1 overflow-y-auto">
          @if (loading()) {
            <div class="flex items-center justify-center h-20">
              <svg class="h-8 w-8 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" style="color: #0d9488" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="url(#spinner-grad)" stroke-width="3" stroke-linecap="round" />
                <defs><linearGradient id="spinner-grad" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0d9488"/><stop offset="1" stop-color="#166534"/></linearGradient></defs>
              </svg>
            </div>
          } @else if (drafts().length === 0) {
            <div class="flex flex-col items-center justify-center h-32 text-gray-400 px-4">
              <svg class="h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <p class="text-sm text-center">No tenés borradores</p>
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
          <!-- ── Editable MTO Document ──────────────────── -->
          <div class="flex-1 overflow-y-auto bg-gray-300 p-5">
            <div class="max-w-3xl mx-auto">

              <div class="flex items-center justify-between mb-3">
                <span class="text-xs text-gray-500 font-medium uppercase tracking-wide">
                  {{ editingDraft() ? 'Editando borrador' : 'Nuevo borrador' }}
                </span>
                <button (click)="closeForm()" class="text-gray-500 hover:text-gray-700 text-xl leading-none">&times;</button>
              </div>

              <!-- ═══ MTO DOCUMENT ═══ -->
              <div class="bg-white border-2 border-black font-mono text-sm text-black shadow-md">
                <!-- Header -->
                <div class="grid grid-cols-10 border-b border-black">
                  <div class="col-span-4 p-2 border-r border-black font-bold flex items-center">GENDARMERÍA NACIONAL</div>
                  <div class="col-span-6 flex flex-col">
                    <div class="border-b border-black p-1 text-center font-bold">MENSAJE DE TRAFICO OFICIAL</div>
                    <div class="grid grid-cols-2 h-full">
                      <div class="border-r border-black p-1 flex justify-around items-center font-bold">
                        <span>Z</span><span>O</span><span>P</span><span>R</span>
                      </div>
                      <div class="p-1 flex items-center justify-center text-xs">{{ formDateGroup() }}</div>
                    </div>
                  </div>
                </div>
                <!-- PROMOTOR -->
                <div class="border-b border-black p-2">
                  <span class="font-bold">PROMOTOR (S):</span> DIREDTOS@MTO.GNA
                </div>
                <!-- EJECUTIVO (S) -->
                <div class="border-b border-black p-2 relative">
                  <span class="font-bold">EJECUTIVO (S):</span>
                  <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-3 pt-1">
                    @for (addr of toAddresses(); track addr) {
                      <span class="relative inline-flex items-center bg-gray-100 text-gray-700 text-xs border border-gray-200 rounded px-2 py-0.5">
                        {{ addr }}
                        <button type="button" (click)="removeAddress('to', addr)"
                          class="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center text-xs leading-none shadow">&times;</button>
                      </span>
                    }
                    <input #toInputEl [(ngModel)]="toInput" (ngModelChange)="onRecipientChange($event,'to')"
                      (keydown.enter)="$event.preventDefault();addManualAddress('to')"
                      (keydown.tab)="addManualAddress('to')"
                      (keydown.comma)="$event.preventDefault();addManualAddress('to')"
                      type="text" [placeholder]="toAddresses().length===0 ? 'Agregar ejecutivo...' : ''"
                      [class.ring-2]="toJustAdded()" [class.ring-green-500]="toJustAdded()" [class.rounded]="toJustAdded()"
                      class="border-0 outline-none bg-transparent min-w-[160px] font-mono text-sm p-0 transition-all" />
                  </span>
                  @if (toSuggestions().length > 0) {
                    <div class="absolute top-full left-0 z-50 min-w-72 bg-white border border-gray-300 shadow-lg rounded mt-0.5 max-h-48 overflow-y-auto">
                      @for (r of toSuggestions(); track r.email) {
                        <button type="button" (click)="selectRecipient('to',r)" class="block w-full text-left px-3 py-2 border-0 border-b border-gray-100 bg-transparent cursor-pointer text-xs hover:bg-gray-50">
                          <div class="font-semibold text-gray-900">{{ r.displayName }}</div>
                          <div class="text-gray-500">{{ r.email }}</div>
                        </button>
                      }
                    </div>
                  }
                </div>
                <!-- INFORMATIVO(S) -->
                <div class="border-b border-black p-2 relative">
                  <span class="font-bold">INFORMATIVO(S):</span>
                  <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-3 pt-1">
                    @for (addr of ccAddresses(); track addr) {
                      <span class="relative inline-flex items-center bg-gray-100 text-gray-700 text-xs border border-gray-200 rounded px-2 py-0.5">
                        {{ addr }}
                        <button type="button" (click)="removeAddress('cc', addr)"
                          class="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center text-xs leading-none shadow">&times;</button>
                      </span>
                    }
                    <input #ccInputEl [(ngModel)]="ccInput" (ngModelChange)="onRecipientChange($event,'cc')"
                      (keydown.enter)="$event.preventDefault();addManualAddress('cc')"
                      (keydown.tab)="addManualAddress('cc')"
                      (keydown.comma)="$event.preventDefault();addManualAddress('cc')"
                      type="text" [placeholder]="ccAddresses().length===0 ? 'Agregar informativo...' : ''"
                      [class.ring-2]="ccJustAdded()" [class.ring-green-500]="ccJustAdded()" [class.rounded]="ccJustAdded()"
                      class="border-0 outline-none bg-transparent min-w-[160px] font-mono text-sm p-0 transition-all" />
                  </span>
                  @if (ccSuggestions().length > 0) {
                    <div class="absolute top-full left-0 z-50 min-w-72 bg-white border border-gray-300 shadow-lg rounded mt-0.5 max-h-48 overflow-y-auto">
                      @for (r of ccSuggestions(); track r.email) {
                        <button type="button" (click)="selectRecipient('cc',r)" class="block w-full text-left px-3 py-2 border-0 border-b border-gray-100 bg-transparent cursor-pointer text-xs hover:bg-gray-50">
                          <div class="font-semibold text-gray-900">{{ r.displayName }}</div>
                          <div class="text-gray-500">{{ r.email }}</div>
                        </button>
                      }
                    </div>
                  }
                </div>
                <!-- EXCEPTUADO (S) -->
                <div class="border-b border-black p-2 min-h-[2rem]">
                  <span class="font-bold">EXCEPTUADO (S):</span>
                </div>
                <!-- Body -->
                <div class="border-b border-black min-h-[250px]">
                  <textarea [(ngModel)]="formBody" rows="10"
                    placeholder="Escribir el contenido del mensaje..."
                    class="block w-full border-0 outline-none bg-transparent p-4 font-mono text-sm leading-relaxed resize-y min-h-[250px] uppercase placeholder:normal-case placeholder:text-gray-400"></textarea>
                </div>
                <!-- Footer -->
                <div class="grid grid-cols-12">
                  <div class="col-span-3 border-r border-black">
                    <div class="border-b border-black p-1 text-center font-bold text-xs italic">BT:</div>
                    <div class="text-[10px] p-1 border-b border-black">INICIAL:</div>
                    <div class="text-[10px] p-1 border-b border-black">RECIBIDO:</div>
                    <div class="text-[10px] p-1 border-b border-black">RETRANSMITIDO:</div>
                    <div class="text-[10px] p-1 border-b border-black">TRASMITIDO:</div>
                    <div class="text-[10px] p-1">ENT. CENTRAL:</div>
                  </div>
                  <div class="col-span-2 border-r border-black"></div>
                  <div class="col-span-4 flex flex-col justify-between border-r border-black">
                    <div class="border-b border-black">
                      <div class="text-[10px] p-1 border-b border-black text-center italic">Lugar: <span class="not-italic">BUENOS AIRES</span></div>
                      <div class="text-[10px] p-1 text-center italic">Fecha: <span class="not-italic">{{ formFechaLarga() }}</span></div>
                    </div>
                    <div class="p-4 text-center text-[11px] min-h-[60px] text-gray-400 italic">[Firma del autorizador]</div>
                  </div>
                  <div class="col-span-3 border-l border-black">
                    <div class="border-b border-black p-1 text-center font-bold text-[10px] italic">CLASIFICACION:</div>
                    <div class="border-b border-black p-1 text-center font-bold text-[10px] italic">SELLO:</div>
                    <div class="p-1 text-center font-bold text-[10px] italic">TRAMITESE:</div>
                    <div class="h-16"></div>
                  </div>
                </div>
              </div><!-- /MTO document -->

              <!-- Send mode selection -->
              <div class="mt-3">
                <label class="text-xs text-gray-400 block mb-1.5">Modalidad de envío para TICOM:</label>
                <div class="flex flex-wrap gap-2">
                  <button type="button" (click)="formSendMode.set(formSendMode()==='sass' ? 'normal' : 'sass')"
                    class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                    [class.bg-blue-600]="formSendMode()==='sass'" [class.text-white]="formSendMode()==='sass'" [class.border-blue-600]="formSendMode()==='sass'"
                    [class.text-gray-600]="formSendMode()!=='sass'" [class.border-gray-300]="formSendMode()!=='sass'" [class.hover:bg-gray-50]="formSendMode()!=='sass'">
                    Adjuntos por SASS
                  </button>
                  <button type="button" (click)="formSendMode.set(formSendMode()==='siena' ? 'normal' : 'siena')"
                    class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                    [class.bg-purple-600]="formSendMode()==='siena'" [class.text-white]="formSendMode()==='siena'" [class.border-purple-600]="formSendMode()==='siena'"
                    [class.text-gray-600]="formSendMode()!=='siena'" [class.border-gray-300]="formSendMode()!=='siena'" [class.hover:bg-gray-50]="formSendMode()!=='siena'">
                    Enviar por SIENA
                  </button>
                  <button type="button" (click)="formSendMode.set(formSendMode()==='pon' ? 'normal' : 'pon')"
                    class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                    [class.bg-orange-600]="formSendMode()==='pon'" [class.text-white]="formSendMode()==='pon'" [class.border-orange-600]="formSendMode()==='pon'"
                    [class.text-gray-600]="formSendMode()!=='pon'" [class.border-gray-300]="formSendMode()!=='pon'" [class.hover:bg-gray-50]="formSendMode()!=='pon'">
                    Enviar por PON 33/96
                  </button>
                </div>
                @if (formSendMode() === 'sass') {
                  <p class="mt-1.5 text-[11px] text-blue-600">TICOM podrá agregar texto adicional antes del bloque FDO/BT/TX.</p>
                }
                @if (formSendMode() === 'siena') {
                  <p class="mt-1.5 text-[11px] text-purple-600">El botón de envío estará bloqueado; el envío se realiza desde el sistema SIENA.</p>
                }
                @if (formSendMode() === 'pon') {
                  <p class="mt-1.5 text-[11px] text-orange-600">TICOM podrá reemplazar los adjuntos por versiones encriptadas antes de enviar.</p>
                }
              </div>

              <!-- Attachments -->
              <div class="mt-3">
                <label class="text-xs text-gray-400">Adjuntos (opcional, máx. 5 MB por archivo):</label>
                <input #fileInput type="file" multiple (change)="onFilesSelected($event)"
                  class="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100" />
                @if (fileError()) {
                  <div class="mt-2 rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-800">{{ fileError() }}</div>
                }
                @if (editingDraft()?.attachments?.length) {
                  <div class="mt-1.5">
                    <p class="text-[11px] text-gray-400 mb-0.5">Adjuntos guardados:</p>
                    <div class="flex flex-wrap gap-1">
                      @for (att of editingDraft()!.attachments; track att.id) {
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs border border-gray-200">
                          <button type="button" (click)="downloadAtt(editingDraft()!.id, att.id, att.filename)" class="hover:underline">{{ att.filename }}</button>
                          <button type="button" (click)="deleteEditAtt(att.id)" class="text-gray-300 hover:text-rose-500 ml-0.5">✕</button>
                        </span>
                      }
                    </div>
                  </div>
                }
                @if (selectedFiles().length > 0) {
                  <div class="mt-1.5">
                    <p class="text-[11px] text-gray-400 mb-0.5">Nuevos adjuntos:</p>
                    <div class="flex flex-wrap gap-1">
                      @for (f of selectedFiles(); track f.name) {
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs border border-teal-200">
                          {{ f.name }}
                          <button type="button" (click)="removeFile(f.name)" class="text-teal-400 hover:text-rose-500 ml-0.5">✕</button>
                        </span>
                      }
                    </div>
                  </div>
                }
              </div>

              @if (formError()) {
                <div class="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{{ formError() }}</div>
              }

              <div class="mt-4 flex items-center gap-3">
                <button (click)="saveDraft()" [disabled]="saving() || toAddresses().length === 0 || !formBody.trim()"
                  class="px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                  style="background:#0f766e">
                  {{ saving() ? 'Guardando...' : (editingDraft() ? 'Guardar cambios' : 'Guardar borrador') }}
                </button>
                <button (click)="closeForm()" class="px-4 py-2 text-sm text-gray-400 hover:text-gray-600">Cancelar</button>
              </div>

            </div>
          </div>

        } @else if (activeDraft()) {
          <!-- ── MTO Document (read-only) + actions ────── -->
          <div class="flex-1 overflow-y-auto bg-gray-300 p-5">
            <div class="max-w-3xl mx-auto space-y-3">

              <!-- Status + hash bar -->
              <div class="flex items-center justify-between flex-wrap gap-2">
                <span class="text-xs px-3 py-1 rounded-full font-medium" [ngClass]="statusClass(activeDraft()!.status)">
                  {{ statusLabel(activeDraft()!.status) }}
                </span>
                @if (activeDraft()!.hash) {
                  <div class="flex items-center gap-2 text-xs bg-teal-50 border border-teal-200 rounded-lg px-3 py-1.5">
                    <span class="text-teal-600">Hash:</span>
                    <span class="font-mono font-bold text-teal-900 tracking-widest">{{ activeDraft()!.hash }}</span>
                  </div>
                }
              </div>

              <!-- ═══ MTO DOCUMENT ═══ -->
              <div class="bg-white border-2 border-black font-mono text-sm text-black shadow-md">
                <!-- Header -->
                <div class="grid grid-cols-10 border-b border-black">
                  <div class="col-span-4 p-2 border-r border-black font-bold flex items-center">GENDARMERÍA NACIONAL</div>
                  <div class="col-span-6 flex flex-col">
                    <div class="border-b border-black p-1 text-center font-bold">MENSAJE DE TRAFICO OFICIAL</div>
                    <div class="grid grid-cols-2 h-full">
                      <div class="border-r border-black p-1 flex justify-around items-center font-bold">
                        <span>Z</span><span>O</span><span>P</span><span>R</span>
                      </div>
                      <div class="p-1 flex items-center justify-center text-xs">{{ draftDateGroup(activeDraft()!) }}</div>
                    </div>
                  </div>
                </div>
                <!-- Fields -->
                <div class="border-b border-black p-2">
                  <span class="font-bold">PROMOTOR (S):</span> DIREDTOS@MTO.GNA
                </div>
                <div class="border-b border-black p-2 leading-tight">
                  <span class="font-bold">EJECUTIVO (S):</span> {{ activeDraft()!.toAddresses.join(' \u2013 ') || '\u2014' }}
                </div>
                <div class="border-b border-black p-2 min-h-[2rem]">
                  <span class="font-bold">INFORMATIVO(S):</span>
                  @if (activeDraft()!.ccAddresses.length) { {{ activeDraft()!.ccAddresses.join(' \u2013 ') }} }
                </div>
                <div class="border-b border-black p-2 min-h-[2rem]">
                  <span class="font-bold">EXCEPTUADO (S):</span>
                </div>
                <!-- Body -->
                <div class="border-b border-black p-4 min-h-[250px] whitespace-pre-wrap leading-relaxed uppercase" (click)="onDraftBodyCodeClick($event)" [innerHTML]="highlightedDraftBody()"></div>
                <!-- Footer -->
                <div class="grid grid-cols-12">
                  <div class="col-span-3 border-r border-black">
                    <div class="border-b border-black p-1 text-center font-bold text-xs italic">BT:</div>
                    <div class="text-[10px] p-1 border-b border-black">INICIAL:</div>
                    <div class="text-[10px] p-1 border-b border-black">RECIBIDO:</div>
                    <div class="text-[10px] p-1 border-b border-black">RETRANSMITIDO:</div>
                    <div class="text-[10px] p-1 border-b border-black">TRASMITIDO:</div>
                    <div class="text-[10px] p-1">ENT. CENTRAL:</div>
                  </div>
                  <div class="col-span-2 border-r border-black"></div>
                  <div class="col-span-4 flex flex-col justify-between border-r border-black">
                    <div class="border-b border-black">
                      <div class="text-[10px] p-1 border-b border-black text-center italic">Lugar: <span class="not-italic">BUENOS AIRES</span></div>
                      <div class="text-[10px] p-1 text-center italic">Fecha: <span class="not-italic">{{ draftFechaLarga(activeDraft()!) }}</span></div>
                    </div>
                    <div class="p-4 text-center text-[11px] min-h-[60px]">
                      @if (activeDraft()!.approvedByName) {
                        <span class="font-bold uppercase block">{{ activeDraft()!.approvedByName }}</span>
                        <span class="uppercase block">{{ activeDraft()!.approvedByRank ?? '' }}</span>
                        <span class="uppercase block">DIRECCIÓN DE EDUCACIÓN E INSTITUTOS</span>
                      } @else {
                        <span class="text-gray-400 italic">[Firma del autorizador]</span>
                      }
                    </div>
                  </div>
                  <div class="col-span-3 border-l border-black">
                    <div class="border-b border-black p-1 text-center font-bold text-[10px] italic">CLASIFICACION:</div>
                    <div class="border-b border-black p-1 text-center font-bold text-[10px] italic">SELLO:</div>
                    <div class="p-1 text-center font-bold text-[10px] italic">TRAMITESE:</div>
                    <div class="h-16"></div>
                  </div>
                </div>
              </div><!-- /MTO document -->

              <!-- Attachments -->
              @if (activeDraft()!.attachments.length > 0) {
                <div>
                  <p class="text-xs font-medium text-gray-400 mb-1">Adjuntos:</p>
                  @for (att of activeDraft()!.attachments; track att.id) {
                    <button type="button" (click)="openPreview(activeDraft()!.id, att.id, att.filename)"
                      class="flex items-center gap-1.5 text-xs text-teal-700 hover:underline mb-0.5">
                      <svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      {{ att.filename }}
                    </button>
                  }
                </div>
              }

              <!-- Correction notes -->
              @if (activeDraft()!.correctionNotes) {
                <div class="rounded-lg bg-rose-50 border border-rose-200 p-3">
                  <p class="text-xs font-semibold text-rose-700 mb-1">Notas de corrección:</p>
                  <p class="text-sm text-rose-800 whitespace-pre-wrap">{{ activeDraft()!.correctionNotes }}</p>
                </div>
              }

              <!-- Action buttons -->
              <div class="flex flex-wrap gap-2">
                @if (isCreator(activeDraft()!) && activeDraft()!.status === 'approved' && activeDraft()!.hash) {
                  <button (click)="printDraft(activeDraft()!)"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-teal-700 border border-teal-300 hover:bg-teal-50 flex items-center gap-2">
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Imprimir para firmar
                  </button>
                }
                @if (isCreator(activeDraft()!) && (activeDraft()!.status === 'draft' || activeDraft()!.status === 'needs_correction')) {
                  <button (click)="openEdit(activeDraft()!)"
                    class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">Editar</button>
                  <button (click)="confirmAndGenerateHash(activeDraft()!.id)" [disabled]="saving()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                    style="background:#0f766e">
                    Confirmar y generar hash
                  </button>
                  <button (click)="promptDelete(activeDraft()!.id)"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-rose-600 border border-rose-200 hover:bg-rose-50">Eliminar</button>
                  <button (click)="promptCancel()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-rose-600 border border-rose-200 hover:bg-rose-50">Cancelar</button>
                }
              </div>

              <!-- Cancel form -->
              @if (showCancelForm()) {
                <div class="rounded-lg border border-rose-200 bg-rose-50 p-4 space-y-3">
                  <p class="text-sm font-medium text-rose-800">Motivo de cancelación:</p>
                  <textarea [(ngModel)]="cancelNotes" rows="3"
                    class="w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
                    placeholder="Indicá el motivo..."></textarea>
                  <div class="flex gap-2">
                    <button (click)="confirmCancel()" [disabled]="saving()"
                      class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50">
                      Confirmar cancelación
                    </button>
                    <button (click)="showCancelForm.set(false); cancelNotes = ''"
                      class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cerrar</button>
                  </div>
                </div>
              }

              <!-- Antecedentes (emails referenciados en el cuerpo del MTO) -->
              @if (activeRefEmail()) {
                <div #refEmailViewer class="rounded-xl border border-gray-200 bg-white shadow overflow-hidden">
                  <!-- Header bar -->
                  <div class="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Antecedente</span>
                      @if (refNavHistory().length > 1) {
                        <div class="flex items-center gap-1 ml-2">
                          <button (click)="refNavBack()" [disabled]="refNavIndex() <= 0"
                            class="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded border border-gray-200 disabled:opacity-30">
                            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                            Atrás
                          </button>
                          <span class="text-xs text-gray-400">{{ refNavIndex() + 1 }}/{{ refNavHistory().length }}</span>
                          <button (click)="refNavForward()" [disabled]="refNavIndex() >= refNavHistory().length - 1"
                            class="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded border border-gray-200 disabled:opacity-30">
                            Adelante
                            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                          </button>
                        </div>
                      }
                    </div>
                    <button (click)="closeRefEmail()" class="text-gray-400 hover:text-gray-700 text-sm leading-none px-1" title="Cerrar">✕</button>
                  </div>
                  <!-- Metadata -->
                  <div class="px-4 py-3 border-b border-gray-100">
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <h3 class="text-sm font-semibold text-gray-900 leading-snug">{{ activeRefEmail()!.subject }}</h3>
                      @if (activeRefEmail()!.mailCode) {
                        <span class="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 flex-shrink-0 font-mono">
                          {{ activeRefEmail()!.mailCode }}
                        </span>
                      }
                    </div>
                    <div class="space-y-0.5 text-xs text-gray-500">
                      <p><span class="font-medium text-gray-600">De:</span> {{ activeRefEmail()!.fromAddress }}</p>
                      <p><span class="font-medium text-gray-600">Para:</span> {{ activeRefEmail()!.toAddresses?.join(', ') }}</p>
                      @if (activeRefEmail()!.ccAddresses?.length) {
                        <p><span class="font-medium text-gray-600">CC:</span> {{ activeRefEmail()!.ccAddresses.join(', ') }}</p>
                      }
                      <p><span class="font-medium text-gray-600">Fecha:</span> {{ formatRefDate(activeRefEmail()!.date) }}</p>
                    </div>
                    @if (activeRefEmail()!.attachments?.length) {
                      <div class="mt-2 pt-2 border-t border-gray-100 flex flex-wrap gap-2">
                        @for (att of activeRefEmail()!.attachments!; track att.id) {
                          <button (click)="openMailPreview(activeRefEmail()!.id, att.id, att.filename)"
                            class="flex items-center gap-1 text-xs text-teal-700 hover:underline">
                            <svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
                            </svg>
                            {{ att.filename }}
                          </button>
                        }
                      </div>
                    }
                  </div>
                  <!-- Body with code highlighting (recursive navigation) -->
                  <div class="px-4 py-3 text-sm font-mono whitespace-pre-wrap leading-relaxed"
                       (click)="onRefBodyCodeClick($event)"
                       [innerHTML]="highlightedRefBody()"></div>
                </div>
              }

              <!-- History -->
              @if (activeDraft()!.history.length > 0) {
                <div class="border-t border-gray-300 pt-3">
                  <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Historial</p>
                  <div class="space-y-2">
                    @for (entry of activeDraft()!.history; track entry.at) {
                      <div class="flex gap-3 text-sm">
                        <div class="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-gray-400 mt-1.5"></div>
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

    <!-- Modal: archivo muy grande para modo normal/PON -->
    @if (showFileSizeModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" (click)="showFileSizeModal.set(false)">
        <div class="bg-white rounded-2xl shadow-xl p-6 max-w-sm mx-4 space-y-4" (click)="$event.stopPropagation()">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg class="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h3 class="text-base font-bold text-gray-900">Adjunto demasiado grande</h3>
          </div>
          <p class="text-sm text-gray-600">
            Los adjuntos mayores a <strong>5 MB</strong> solo pueden enviarse cuando se selecciona la modalidad
            <strong>Adjuntos por SASS</strong> o <strong>Enviar por SIENA</strong>.
          </p>
          <p class="text-sm text-gray-500">
            Seleccioná una de esas modalidades de envío antes de adjuntar archivos de mayor tamaño.
          </p>
          <button (click)="showFileSizeModal.set(false)"
            class="w-full px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700">
            Entendido
          </button>
        </div>
      </div>
    }

    <app-attachment-preview-modal
      [request]="previewRequest()"
      (closed)="previewRequest.set(null)" />
  `,
})
export class DraftMailComponent implements OnInit, OnDestroy {
  readonly draftMailService = inject(DraftMailService);
  private readonly authService = inject(AuthService);
  readonly mailService = inject(MailService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  @ViewChild('toInputEl') toInputEl?: ElementRef<HTMLInputElement>;
  @ViewChild('ccInputEl') ccInputEl?: ElementRef<HTMLInputElement>;
  @ViewChild('refEmailViewer') refEmailViewerEl?: ElementRef<HTMLElement>;

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly drafts = signal<DraftEmail[]>([]);
  readonly activeDraft = signal<DraftEmail | null>(null);
  readonly showForm = signal(false);
  readonly editingDraft = signal<DraftEmail | null>(null);
  readonly canSubmitAfterCorrection = signal(false);
  readonly toJustAdded = signal(false);
  readonly ccJustAdded = signal(false);
  readonly showFileSizeModal = signal(false);
  readonly previewRequest = signal<AttachmentPreviewRequest | null>(null);

  // Form fields
  readonly toAddresses = signal<string[]>([]);
  readonly ccAddresses = signal<string[]>([]);
  readonly toSuggestions = signal<MailRecipient[]>([]);
  readonly ccSuggestions = signal<MailRecipient[]>([]);
  toInput = '';
  ccInput = '';
  formSubject = '';
  formBody = '';
  readonly formSendMode = signal<'normal' | 'sass' | 'siena' | 'pon'>('normal');
  readonly selectedFiles = signal<File[]>([]);
  readonly formError = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);

  readonly showCancelForm = signal(false);
  cancelNotes = '';

  // Body references (mailCode highlighting)
  readonly draftRefs = signal<{ referencedCode: string; referencedEmailId: string | null }[]>([]);

  // Referenced email viewer
  readonly activeRefEmail = signal<Email | null>(null);
  readonly refNavHistory = signal<Email[]>([]);
  readonly refNavIndex = signal(0);

  private readonly toSearchSubject = new Subject<string>();
  private readonly ccSearchSubject = new Subject<string>();

  readonly isTicomUser = computed(() => !!this.authService.currentUser()?.roles?.includes('TICOM'));

  readonly highlightedDraftBody = computed((): SafeHtml => {
    const draft = this.activeDraft();
    if (!draft) return this.sanitizer.bypassSecurityTrustHtml('');
    const refs = this.draftRefs();
    const refMap = new Map<string, string | null>();
    for (const r of refs) refMap.set(r.referencedCode.toUpperCase(), r.referencedEmailId ?? null);
    const body = draft.bodyText ?? '';
    const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const CODE_RE = /\b([A-ZÁÉÍÓÚÑ]{1,4})[ \t]*(\d+)[^\w\/]*\/[^\w]*(\d[^\w\/]*\d)\b/g;
    const EXCLUDED = new Set(['PON', 'DDNG']);
    const highlighted = escaped.replace(CODE_RE, (match, p1, p2, p3) => {
      if (EXCLUDED.has(p1.toUpperCase())) return match;
      const code = `${p1.toUpperCase()} ${p2}/${p3.replace(/\D/g, '')}`;
      if (!refMap.has(code)) return match;
      const emailId = refMap.get(code)!;
      if (emailId) return `<span class="text-green-600 font-medium cursor-pointer hover:underline" data-ref-id="${emailId}" title="Ver ${code}">${match}</span>`;
      return `<span class="text-red-500 font-medium" title="${code} — no encontrado en la base de datos">${match}</span>`;
    });
    return this.sanitizer.bypassSecurityTrustHtml(highlighted);
  });

  readonly highlightedRefBody = computed((): SafeHtml => {
    const email = this.activeRefEmail();
    if (!email) return this.sanitizer.bypassSecurityTrustHtml('');
    return this.buildHighlightedMailBody(email);
  });

  ngOnInit(): void {
    this.loadDrafts();

    this.draftMailService.draftStatusChanged$.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ id }) => {
      this.draftMailService.getOne(id).subscribe({
        next: (updated) => {
          const inList = this.drafts().some((d) => d.id === id);
          if (inList) {
            this.drafts.update((list) => list.map((d) => d.id === id ? updated : d));
          } else {
            this.drafts.update((list) => [updated, ...list]);
          }
          if (this.activeDraft()?.id === id) {
            this.activeDraft.set(updated);
          }
        },
        error: () => {
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
    this.showCancelForm.set(false);
    this.canSubmitAfterCorrection.set(false);
    this.draftRefs.set([]);
    this.activeRefEmail.set(null);
    this.refNavHistory.set([]);
    this.refNavIndex.set(0);
    this.loadDraftRefs(draft.id);
  }

  openNew(): void {
    const yr = String(new Date().getFullYear()).slice(-2);
    this.editingDraft.set(null);
    this.activeDraft.set(null);
    this.toAddresses.set([]);
    this.ccAddresses.set([]);
    this.formSubject = '';
    this.formBody = `DEI  /${yr}\n\n`;
    this.formSendMode.set('normal');
    this.selectedFiles.set([]);
    this.formError.set(null);
    this.fileError.set(null);
    this.showForm.set(true);
  }

  openEdit(draft: DraftEmail): void {
    this.canSubmitAfterCorrection.set(false);
    this.editingDraft.set(draft);
    this.toAddresses.set([...draft.toAddresses]);
    this.ccAddresses.set([...draft.ccAddresses]);
    this.formSubject = draft.subject;
    this.formBody = draft.bodyText;
    this.formSendMode.set((draft.sendMode ?? 'normal') as 'normal' | 'sass' | 'siena' | 'pon');
    this.selectedFiles.set([]);
    this.fileError.set(null);
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
      if (!this.toAddresses().includes(r.email)) this.toAddresses.update((a) => [...a, r.email]);
      this.toInput = '';
      this.toSuggestions.set([]);
      this.flashAndFocus('to');
    } else {
      if (!this.ccAddresses().includes(r.email)) this.ccAddresses.update((a) => [...a, r.email]);
      this.ccInput = '';
      this.ccSuggestions.set([]);
      this.flashAndFocus('cc');
    }
  }

  addManualAddress(field: 'to' | 'cc'): void {
    const raw = field === 'to' ? this.toInput.trim().replace(/,$/, '') : this.ccInput.trim().replace(/,$/, '');
    if (!raw || !raw.includes('@')) return;
    if (field === 'to') {
      if (!this.toAddresses().includes(raw)) this.toAddresses.update((a) => [...a, raw]);
      this.toInput = '';
      this.toSuggestions.set([]);
      this.flashAndFocus('to');
    } else {
      if (!this.ccAddresses().includes(raw)) this.ccAddresses.update((a) => [...a, raw]);
      this.ccInput = '';
      this.ccSuggestions.set([]);
      this.flashAndFocus('cc');
    }
  }

  private flashAndFocus(field: 'to' | 'cc'): void {
    const justAdded = field === 'to' ? this.toJustAdded : this.ccJustAdded;
    const inputEl = field === 'to' ? this.toInputEl : this.ccInputEl;
    justAdded.set(true);
    setTimeout(() => {
      inputEl?.nativeElement.focus();
      setTimeout(() => justAdded.set(false), 1500);
    }, 0);
  }

  removeAddress(field: 'to' | 'cc', addr: string): void {
    if (field === 'to') this.toAddresses.update((a) => a.filter((x) => x !== addr));
    else this.ccAddresses.update((a) => a.filter((x) => x !== addr));
  }

  onFilesSelected(event: Event): void {
    const MAX_SIZE = 5 * 1024 * 1024;
    const input = event.target as HTMLInputElement;
    const newFiles = Array.from(input.files ?? []);
    const mode = this.formSendMode();
    const allowLarge = mode === 'sass' || mode === 'siena';

    const oversized = newFiles.filter(f => f.size > MAX_SIZE);
    const valid = allowLarge ? newFiles : newFiles.filter(f => f.size <= MAX_SIZE);

    if (!allowLarge && oversized.length > 0) {
      this.showFileSizeModal.set(true);
    } else {
      this.fileError.set(null);
    }

    const existing = this.selectedFiles();
    const merged = [...existing];
    for (const f of valid) {
      if (!merged.some(e => e.name === f.name)) merged.push(f);
    }
    this.selectedFiles.set(merged.slice(0, 10));
    input.value = '';
  }

  removeFile(name: string): void {
    this.selectedFiles.update(files => files.filter(f => f.name !== name));
  }

  openPreview(draftId: string, attId: string, filename: string): void {
    this.previewRequest.set({
      url: `/api/draft-mail/${draftId}/attachments/${attId}/preview`,
      filename,
      downloadUrl: `/api/draft-mail/${draftId}/attachments/${attId}`,
    });
  }

  openMailPreview(emailId: string, attId: string, filename: string): void {
    this.previewRequest.set({
      url: `/api/mail/emails/${emailId}/attachments/${attId}/preview`,
      filename,
      downloadUrl: `/api/mail/emails/${emailId}/attachments/${attId}`,
    });
  }

  downloadAtt(draftId: string, attId: string, filename: string): void {
    this.draftMailService.downloadAttachment(draftId, attId).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      error: () => {},
    });
  }

  deleteEditAtt(attId: string): void {
    const draft = this.editingDraft();
    if (!draft) return;
    this.draftMailService.deleteAttachment(draft.id, attId).subscribe({
      next: (updated) => {
        this.editingDraft.set(updated);
        this.drafts.update(list => list.map(d => d.id === updated.id ? updated : d));
      },
      error: () => {},
    });
  }

  saveDraft(): void {
    this.formError.set(null);
    const subject = this.formSubject || this.formBody.split('\n')[0]?.trim().slice(0, 120) || '(sin asunto)';
    if (this.editingDraft()) {
      this.saving.set(true);
      const newFiles = this.selectedFiles();
      this.draftMailService.update(this.editingDraft()!.id, {
        subject,
        bodyText: this.formBody,
        toAddresses: this.toAddresses(),
        ccAddresses: this.ccAddresses(),
        sendMode: this.formSendMode(),
      }).pipe(
        switchMap((updated) => {
          if (newFiles.length === 0) return of(updated);
          return this.draftMailService.addAttachments(updated.id, newFiles);
        })
      ).subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.drafts.update((list) => list.map((d) => d.id === updated.id ? updated : d));
          this.activeDraft.set(updated);
          this.showForm.set(false);
          this.editingDraft.set(null);
          if (updated.status === 'needs_correction') {
            this.canSubmitAfterCorrection.set(true);
          }
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.formError.set(err?.error?.message ?? 'Error al guardar');
        },
      });
    } else {
      const fd = new FormData();
      fd.append('subject', subject);
      fd.append('bodyText', this.formBody);
      fd.append('sendMode', this.formSendMode());
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

  confirmAndGenerateHash(id: string): void {
    if (!confirm('¿Confirmar este borrador y generar el hash para imprimir?')) return;
    this.saving.set(true);
    this.draftMailService.confirmDraft(id).subscribe({
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

  promptCancel(): void {
    this.cancelNotes = '';
    this.showCancelForm.set(true);
  }

  confirmCancel(): void {
    const id = this.activeDraft()?.id;
    if (!id) return;
    this.saving.set(true);
    this.draftMailService.cancel(id, this.cancelNotes).subscribe({
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

  statusLabel(s: DraftStatus): string { return STATUS_LABELS[s] ?? s; }
  statusClass(s: DraftStatus): string { return STATUS_CLASSES[s] ?? 'bg-gray-100 text-gray-500'; }

  historyLabel(type: string): string {
    const map: Record<string, string> = {
      created: 'Creado', confirmed: 'Confirmado', submitted: 'Enviado a revisión', resubmitted: 'Reenviado a revisión',
      approved: 'Aprobado', rejected: 'Devuelto para corrección', cancelled: 'Cancelado',
      ticom_cancelled: 'Devuelto por TICOM', sent: 'Enviado', edited: 'Editado', delegated: 'Delegado',
    };
    return map[type] ?? type;
  }

  // ── MTO document helpers ──────────────────────────────────

  promotorName(): string {
    const u = this.authService.currentUser();
    return u ? (u.displayName || u.username) : '';
  }

  formDateGroup(): string {
    const d = this.editingDraft() ? new Date(this.editingDraft()!.createdAt) : new Date();
    return this.fmtDateGroup(d);
  }

  formFechaLarga(): string {
    const d = this.editingDraft() ? new Date(this.editingDraft()!.createdAt) : new Date();
    return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  }

  draftDateGroup(draft: DraftEmail): string {
    if (!draft.approvedAt) return '';
    return this.fmtDateGroup(new Date(draft.approvedAt));
  }

  draftFechaLarga(draft: DraftEmail): string {
    const d = draft.approvedAt ? new Date(draft.approvedAt) : new Date(draft.createdAt);
    return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  }

  // ── Print ────────────────────────────────────────────────

  printDraft(draft: DraftEmail): void {
    const w = window.open('', '_blank', 'width=850,height=1100');
    if (!w) return;
    w.document.write(this.buildPrintHtml(draft));
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  }

  private buildPrintHtml(draft: DraftEmail): string {
    const toList = draft.toAddresses.join(' \u2013 ') || '\u2014';
    const ccList = draft.ccAddresses.length ? draft.ccAddresses.join(' \u2013 ') : '';
    const approvedDate = draft.approvedAt ? new Date(draft.approvedAt) : new Date();
    const hash = draft.hash ?? '';
    const body = this.escapeHtml(draft.bodyText);
    const zoprDate = this.fmtDateGroup(approvedDate);
    const fechaLarga = `${MONTHS_LONG[approvedDate.getMonth()]} ${approvedDate.getFullYear()}`;
    const approvedByName = this.escapeHtml(draft.approvedByName ?? '');
    const approvedByRank = this.escapeHtml(draft.approvedByRank ?? '');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>MTO</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 9pt; color: #000; }
  .doc { border: 2px solid #000; display: flex; flex-direction: column; }
  .b { font-weight: bold; }
  .uc { text-transform: uppercase; }
  .center { text-align: center; }
  /* Header */
  .hdr { display: grid; grid-template-columns: 40% 60%; border-bottom: 1px solid #000; }
  .hdr-gn { padding: 6px 10px; border-right: 1px solid #000; font-weight: bold; display: flex; align-items: center; }
  .hdr-right { display: flex; flex-direction: column; }
  .hdr-mto { padding: 4px 8px; text-align: center; font-weight: bold; border-bottom: 1px solid #000; }
  .hdr-zopr-row { display: grid; grid-template-columns: 50% 50%; }
  .hdr-zopr { padding: 4px 8px; font-weight: bold; letter-spacing: 6px; border-right: 1px solid #000; }
  .hdr-date { padding: 4px 8px; text-align: center; font-size: 8pt; }
  /* Fields */
  .field-row { border-bottom: 1px solid #000; padding: 4px 10px; min-height: 1.6em; }
  /* Body */
  .body-area { border-bottom: 1px solid #000; padding: 10px; min-height: 160px; white-space: pre-wrap; line-height: 1.7; text-transform: uppercase; }
  /* Footer */
  .ftr { display: grid; grid-template-columns: 25% 17% 33% 25%; }
  .ftr-bt { border-right: 1px solid #000; padding: 6px 8px; font-size: 8pt; line-height: 2; }
  .ftr-empty { border-right: 1px solid #000; }
  .ftr-mid { border-right: 1px solid #000; display: flex; flex-direction: column; justify-content: space-between; }
  .ftr-loc { border-bottom: 1px solid #000; }
  .ftr-loc div { padding: 3px 8px; font-size: 8pt; font-style: italic; }
  .ftr-loc div + div { border-top: 1px solid #000; }
  .ftr-sig { padding: 12px 8px; text-align: center; font-size: 8pt; min-height: 60px; }
  .ftr-cls { padding: 6px 8px; font-size: 8pt; text-align: center; }
  .ftr-cls div { border-bottom: 1px solid #000; padding: 4px; font-weight: bold; font-style: italic; }
  .ftr-cls div:last-child { border-bottom: none; padding-top: 4px; min-height: 40px; }
  /* Hash */
  .hash-section { border-top: 1px dashed #666; padding: 5px; text-align: center; font-size: 7.5pt; color: #444; }
  .hash-val { font-size: 14pt; font-weight: bold; letter-spacing: 5px; color: #000; }
</style>
</head>
<body>
<div class="doc">
  <!-- Header -->
  <div class="hdr">
    <div class="hdr-gn">GENDARMERÍA NACIONAL</div>
    <div class="hdr-right">
      <div class="hdr-mto">MENSAJE DE TRAFICO OFICIAL</div>
      <div class="hdr-zopr-row">
        <div class="hdr-zopr">Z &nbsp; O &nbsp; P &nbsp; R</div>
        <div class="hdr-date">${zoprDate}</div>
      </div>
    </div>
  </div>
  <!-- Fields -->
  <div class="field-row"><span class="b">PROMOTOR (S):</span> DIREDTOS@MTO.GNA</div>
  <div class="field-row"><span class="b">EJECUTIVO (S):</span> ${this.escapeHtml(toList)}</div>
  <div class="field-row"><span class="b">INFORMATIVO(S):</span> ${this.escapeHtml(ccList)}</div>
  <div class="field-row"><span class="b">EXCEPTUADO (S):</span></div>
  <!-- Body -->
  <div class="body-area">${body}</div>
  <!-- Footer -->
  <div class="ftr">
    <div class="ftr-bt"><span class="b">BT:</span><br>INICIAL:<br>RECIBIDO:<br>RETRANSMITIDO:<br>TRASMITIDO:<br>ENT. CENTRAL:</div>
    <div class="ftr-empty"></div>
    <div class="ftr-mid">
      <div class="ftr-loc">
        <div>Lugar: <span style="font-style:normal">BUENOS AIRES</span></div>
        <div>Fecha: <span style="font-style:normal;text-transform:uppercase">${fechaLarga}</span></div>
      </div>
      <div class="ftr-sig">
        ${approvedByName ? `<strong class="uc">${approvedByName}</strong><br>${approvedByRank ? `<span class="uc">${approvedByRank}</span><br>` : ''}<span class="uc">DIRECCIÓN DE EDUCACIÓN E INSTITUTOS</span>` : ''}
      </div>
    </div>
    <div class="ftr-cls">
      <div>CLASIFICACION:</div>
      <div>SELLO:</div>
      <div>TRAMITESE:</div>
    </div>
  </div>
  ${hash ? `<div class="hash-section">HASH DE VERIFICACIÓN (no se envía con el correo)<br><span class="hash-val">${hash}</span></div>` : ''}
</div>
</body>
</html>`;
  }

  private fmtDateGroup(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${dd}${hh}${mm}${MONTHS_SHORT[d.getMonth()]}${String(d.getFullYear()).slice(-2)}`;
  }

  private escapeHtml(text: string): string {
    return (text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Body refs & antecedentes ─────────────────────────────

  loadDraftRefs(id: string): void {
    this.draftMailService.getBodyReferences(id).subscribe({
      next: (refs) => this.draftRefs.set(refs),
      error: () => {},
    });
  }

  onDraftBodyCodeClick(event: MouseEvent): void {
    const span = (event.target as HTMLElement).closest<HTMLElement>('[data-ref-id]');
    const emailId = span?.getAttribute('data-ref-id');
    if (!emailId) return;
    this.mailService.getEmail(emailId).subscribe({
      next: (email) => {
        this.refNavHistory.set([email]);
        this.refNavIndex.set(0);
        this.activeRefEmail.set(email);
        setTimeout(() => this.refEmailViewerEl?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
      },
    });
  }

  onRefBodyCodeClick(event: MouseEvent): void {
    const span = (event.target as HTMLElement).closest<HTMLElement>('[data-ref-id]');
    const emailId = span?.getAttribute('data-ref-id');
    if (!emailId) return;
    this.mailService.getEmail(emailId).subscribe({
      next: (email) => {
        const truncated = this.refNavHistory().slice(0, this.refNavIndex() + 1);
        this.refNavHistory.set([...truncated, email]);
        this.refNavIndex.set(truncated.length);
        this.activeRefEmail.set(email);
      },
    });
  }

  refNavBack(): void {
    const idx = this.refNavIndex();
    if (idx <= 0) return;
    this.refNavIndex.set(idx - 1);
    this.activeRefEmail.set(this.refNavHistory()[idx - 1]);
  }

  refNavForward(): void {
    const idx = this.refNavIndex();
    const history = this.refNavHistory();
    if (idx >= history.length - 1) return;
    this.refNavIndex.set(idx + 1);
    this.activeRefEmail.set(history[idx + 1]);
  }

  closeRefEmail(): void {
    this.activeRefEmail.set(null);
    this.refNavHistory.set([]);
    this.refNavIndex.set(0);
  }

  formatRefDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  private buildHighlightedMailBody(email: Email): SafeHtml {
    const refs = email.outgoingRefs ?? [];
    const refMap = new Map<string, string | null>();
    for (const r of refs) refMap.set(r.referencedCode.toUpperCase(), r.referencedEmailId ?? null);

    if (!email.bodyText?.trim()) {
      return this.sanitizer.bypassSecurityTrustHtml(
        `<div class="prose prose-sm max-w-none text-gray-700 text-sm leading-relaxed">${email.bodyHtml ?? ''}</div>`
      );
    }
    const escaped = (email.bodyText ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const CODE_RE = /\b([A-ZÁÉÍÓÚÑ]{1,4})[ \t]*(\d+)[^\w\/]*\/[^\w]*(\d[^\w\/]*\d)\b/g;
    const EXCLUDED = new Set(['PON', 'DDNG']);
    const selfCode = (email.mailCode ?? '').toUpperCase();
    const highlighted = escaped.replace(CODE_RE, (match, p1, p2, p3) => {
      if (EXCLUDED.has(p1.toUpperCase())) return match;
      const code = `${p1.toUpperCase()} ${p2}/${p3.replace(/\D/g, '')}`;
      if (code === selfCode) return `<span class="font-semibold text-gray-800">${match}</span>`;
      if (!refMap.has(code)) return match;
      const emailId = refMap.get(code)!;
      if (emailId) return `<span class="text-green-600 font-medium cursor-pointer hover:underline" data-ref-id="${emailId}" title="Ver ${code}">${match}</span>`;
      return `<span class="text-red-500 font-medium" title="${code} — no encontrado en la base de datos">${match}</span>`;
    });
    return this.sanitizer.bypassSecurityTrustHtml(highlighted);
  }
}
