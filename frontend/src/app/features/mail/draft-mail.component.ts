import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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

const MONTHS_LONG = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
const MONTHS_SHORT = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

@Component({
  selector: 'app-draft-mail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">

      <!-- ── Left sidebar: draft list ────────────────────── -->
      <aside class="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col">

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
              <p class="text-sm text-center">
                @if (isAuthorizer()) { No hay borradores pendientes } @else { No tenés borradores }
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
                  <span class="inline-flex flex-wrap items-baseline gap-0">
                    @for (addr of toAddresses(); track addr; let i = $index) {
                      @if (i > 0) {<span class="mx-1">–</span>}
                      <span>{{ addr }}</span><button type="button" (click)="removeAddress('to', addr)" class="text-gray-300 hover:text-red-400 bg-transparent border-0 cursor-pointer px-0.5 text-xs leading-none">&times;</button>
                    }
                    @if (toAddresses().length > 0) {<span class="mx-1">–</span>}
                    <input [(ngModel)]="toInput" (ngModelChange)="onRecipientChange($event,'to')"
                      (keydown.enter)="$event.preventDefault();addManualAddress('to')"
                      (keydown.tab)="addManualAddress('to')"
                      (keydown.comma)="$event.preventDefault();addManualAddress('to')"
                      type="text" [placeholder]="toAddresses().length===0 ? 'Agregar ejecutivo...' : ''"
                      class="border-0 outline-none bg-transparent min-w-[120px] font-mono text-sm p-0" />
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
                  <span class="inline-flex flex-wrap items-baseline gap-0">
                    @for (addr of ccAddresses(); track addr; let i = $index) {
                      @if (i > 0) {<span class="mx-1">–</span>}
                      <span>{{ addr }}</span><button type="button" (click)="removeAddress('cc', addr)" class="text-gray-300 hover:text-red-400 bg-transparent border-0 cursor-pointer px-0.5 text-xs leading-none">&times;</button>
                    }
                    @if (ccAddresses().length > 0) {<span class="mx-1">–</span>}
                    <input [(ngModel)]="ccInput" (ngModelChange)="onRecipientChange($event,'cc')"
                      (keydown.enter)="$event.preventDefault();addManualAddress('cc')"
                      (keydown.tab)="addManualAddress('cc')"
                      (keydown.comma)="$event.preventDefault();addManualAddress('cc')"
                      type="text" [placeholder]="ccAddresses().length===0 ? 'Agregar informativo...' : ''"
                      class="border-0 outline-none bg-transparent min-w-[120px] font-mono text-sm p-0" />
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
                <button (click)="saveDraft()" [disabled]="saving()"
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
                <div class="border-b border-black p-4 min-h-[250px] whitespace-pre-wrap leading-relaxed uppercase">{{ activeDraft()!.bodyText }}</div>
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
                    <button type="button" (click)="downloadAtt(activeDraft()!.id, att.id, att.filename)"
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
                }
                @if (isCreator(activeDraft()!) && activeDraft()!.status === 'needs_correction' && canSubmitAfterCorrection()) {
                  <button (click)="submitDraft(activeDraft()!.id)" [disabled]="saving()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                    Reenviar a revisión
                  </button>
                }
                @if (isCreator(activeDraft()!) && activeDraft()!.status === 'draft') {
                  <button (click)="submitDraft(activeDraft()!.id)" [disabled]="saving()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                    Enviar a revisión
                  </button>
                  <button (click)="promptDelete(activeDraft()!.id)"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-rose-600 border border-rose-200 hover:bg-rose-50">Eliminar</button>
                }
                @if (isCreator(activeDraft()!) && !isAuthorizer() && ['pending_review','needs_correction'].includes(activeDraft()!.status)) {
                  <button (click)="promptCancel()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-rose-600 border border-rose-200 hover:bg-rose-50">Cancelar</button>
                }
                @if (isAuthorizer() && activeDraft()!.status === 'pending_review') {
                  <button (click)="approveDraft()" [disabled]="saving()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                    style="background:#0f766e">Aprobar</button>
                  <button (click)="showRejectForm.set(true)"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-amber-700 border border-amber-300 hover:bg-amber-50">
                    Devolver para corrección
                  </button>
                  <button (click)="promptTicomCancel()"
                    class="px-4 py-2 rounded-lg text-sm font-medium text-rose-600 border border-rose-200 hover:bg-rose-50">Cancelar</button>
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
                      class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
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
                      class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cerrar</button>
                  </div>
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
  `,
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
  readonly canSubmitAfterCorrection = signal(false);

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

  // Review actions
  readonly showRejectForm = signal(false);
  readonly showCancelForm = signal(false);
  rejectNotes = '';
  cancelNotes = '';
  cancelIsTicom = false;

  private readonly toSearchSubject = new Subject<string>();
  private readonly ccSearchSubject = new Subject<string>();

  readonly isAuthorizer = computed(() => this.draftMailService.isAuthorizerSignal());

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
    this.showRejectForm.set(false);
    this.showCancelForm.set(false);
    this.canSubmitAfterCorrection.set(false);
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
    const MAX_SIZE = 5 * 1024 * 1024;
    const input = event.target as HTMLInputElement;
    const newFiles = Array.from(input.files ?? []);
    const oversized = newFiles.filter(f => f.size > MAX_SIZE);
    const valid = newFiles.filter(f => f.size <= MAX_SIZE);
    if (oversized.length > 0) {
      this.fileError.set(
        `El archivo que intenta adjuntar pesa más de 5 MB. Si desea enviar MTO's con adjuntos de mayor peso considere enviarlos por el sistema de SASS o en el caso de encriptados por el sistema SIENA.`
      );
    } else {
      this.fileError.set(null);
    }
    // Accumulate: merge with existing, deduplicate by name
    const existing = this.selectedFiles();
    const merged = [...existing];
    for (const f of valid) {
      if (!merged.some(e => e.name === f.name)) merged.push(f);
    }
    this.selectedFiles.set(merged.slice(0, 10));
    input.value = ''; // reset so same file can be re-selected after removal
  }

  removeFile(name: string): void {
    this.selectedFiles.update(files => files.filter(f => f.name !== name));
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

  statusLabel(s: DraftStatus): string { return STATUS_LABELS[s] ?? s; }
  statusClass(s: DraftStatus): string { return STATUS_CLASSES[s] ?? 'bg-gray-100 text-gray-500'; }

  historyLabel(type: string): string {
    const map: Record<string, string> = {
      created: 'Creado', submitted: 'Enviado a revisión', resubmitted: 'Reenviado a revisión',
      approved: 'Aprobado', rejected: 'Devuelto para corrección', cancelled: 'Cancelado',
      ticom_cancelled: 'Cancelado por TICOM', sent: 'Enviado', edited: 'Editado', delegated: 'Delegado',
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
}
