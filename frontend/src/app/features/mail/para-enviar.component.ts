import {
  Component,
  inject,
  signal,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DraftMailService,
  DraftEmail,
} from '../../core/services/draft-mail.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-para-enviar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">

      <!-- ── Left sidebar: approved list ──────────────────── -->
      <aside class="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col">
        <div class="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h2 class="text-sm font-semibold text-gray-700">Correos aprobados para enviar</h2>
        </div>

        <!-- Hash quick-search -->
        <div class="px-3 py-2 border-b border-gray-100">
          <label class="block text-xs text-gray-500 mb-1">Buscar por hash del papel firmado:</label>
          <div class="flex gap-1.5">
            <input [(ngModel)]="hashSearch"
              type="text" placeholder="Ingresá el hash..."
              class="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            <button (click)="searchByHash()" [disabled]="!hashSearch.trim() || searchingHash()"
              class="px-3 py-1.5 rounded-md text-sm font-medium text-white disabled:opacity-40"
              style="background:#0f766e">
              Buscar
            </button>
          </div>
          @if (hashNotFound()) {
            <p class="mt-1.5 text-xs text-rose-600">No hay ningún correo para enviar con ese hash ingresado.</p>
          }
        </div>

        <!-- List -->
        <div class="flex-1 overflow-y-auto">
          @if (loading()) {
            <div class="flex items-center justify-center h-24">
              <span class="text-sm text-gray-400">Cargando...</span>
            </div>
          } @else if (emails().length === 0) {
            <div class="flex flex-col items-center justify-center h-32 text-gray-400 px-4">
              <svg class="h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              <p class="text-sm text-center">No hay correos aprobados pendientes de envío</p>
            </div>
          } @else {
            @for (email of emails(); track email.id) {
              <button
                (click)="selectEmail(email)"
                class="w-full text-left px-3 py-3 border-b border-gray-50 transition-all hover:bg-gray-50 focus:outline-none"
                [class.bg-teal-50]="activeEmail()?.id === email.id">
                <div class="flex items-center gap-2">
                  <svg class="h-4 w-4 text-teal-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div class="flex-1 min-w-0">
                    <p class="text-xs font-medium text-gray-700 truncate">{{ email.creatorName }}</p>
                    <p class="text-[11px] text-gray-400 mt-0.5">Aprobado {{ email.approvedAt | date:'dd/MM/yy HH:mm' }}</p>
                  </div>
                </div>
              </button>
            }
          }
        </div>
      </aside>

      <!-- ── Right panel ─────────────────────────────────── -->
      <div class="flex-1 flex flex-col overflow-hidden">

        @if (activeEmail() && !unlockedEmailId()) {
          <!-- ── Hash unlock form ───────────────────────── -->
          <div class="flex-1 flex flex-col items-center justify-center p-8">
            <div class="w-full max-w-md space-y-4">
              <div class="text-center">
                <div class="h-12 w-12 rounded-full bg-teal-50 flex items-center justify-center mx-auto mb-3">
                  <svg class="h-6 w-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 class="text-base font-semibold text-gray-800">Ingresá el hash del papel firmado</h3>
                <p class="text-sm text-gray-500 mt-1">
                  Para ver el contenido del correo de <strong>{{ activeEmail()!.creatorName }}</strong>,
                  ingresá el hash de verificación del documento firmado.
                </p>
              </div>
              <input [(ngModel)]="unlockHash" type="text" placeholder="Hash del papel firmado..."
                class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-center font-mono" />
              @if (unlockError()) {
                <p class="text-xs text-rose-600 text-center">{{ unlockError() }}</p>
              }
              <button (click)="unlockEmail()" [disabled]="!unlockHash.trim() || unlocking()"
                class="w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style="background:#0f766e">
                {{ unlocking() ? 'Verificando...' : 'Desbloquear' }}
              </button>
            </div>
          </div>

        } @else if (activeEmail() && unlockedEmailId()) {
          <!-- ── Unlocked: MTO document + send form ─────────── -->
          <div class="flex-1 overflow-y-auto bg-gray-300 p-5">
            <div class="max-w-4xl mx-auto space-y-4">

              <!-- Encryption indicator -->
              @if (activeEmail()!.requiresEncryption || activeEmail()!.encryptionManualOverride) {
                <div class="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                  <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Este correo requiere encriptación (PON detectado)
                </div>
              }

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
                      <div class="p-1 flex items-center justify-center text-xs">{{ draftDateGroup(activeEmail()!) }}</div>
                    </div>
                  </div>
                </div>
                <!-- Fields -->
                <div class="border-b border-black p-2">
                  <span class="font-bold">PROMOTOR (S):</span> DIREDTOS@MTO.GNA
                </div>
                <div class="border-b border-black p-2 leading-tight">
                  <span class="font-bold">EJECUTIVO (S):</span> {{ activeEmail()!.toAddresses.join(' \u2013 ') || '\u2014' }}
                </div>
                <div class="border-b border-black p-2 min-h-[2rem]">
                  <span class="font-bold">INFORMATIVO(S):</span>
                  @if (activeEmail()!.ccAddresses.length) { {{ activeEmail()!.ccAddresses.join(' \u2013 ') }} }
                </div>
                <div class="border-b border-black p-2 min-h-[2rem]">
                  <span class="font-bold">EXCEPTUADO (S):</span>
                </div>
                <!-- Body preview: mailCode + body + FDO/BT/TX -->
                <div class="border-b border-black p-4 min-h-[250px] whitespace-pre-wrap leading-relaxed uppercase">{{ previewBody() }}</div>
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
                      <div class="text-[10px] p-1 text-center italic">Fecha: <span class="not-italic">{{ draftFechaLarga(activeEmail()!) }}</span></div>
                    </div>
                    <div class="p-4 text-center text-[11px] min-h-[60px]">
                      @if (activeEmail()!.approvedByName) {
                        <span class="font-bold uppercase block">{{ activeEmail()!.approvedByName }}</span>
                        <span class="uppercase block">{{ activeEmail()!.approvedByRank ?? '' }}</span>
                        <span class="uppercase block">DIRECCIÓN DE EDUCACIÓN E INSTITUTOS</span>
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
              </div>

              <!-- Attachments -->
              @if (activeEmail()!.attachments.length > 0) {
                <div class="bg-white rounded-lg p-3 border border-gray-200">
                  <p class="text-xs font-medium text-gray-500 mb-2">Adjuntos:</p>
                  <div class="space-y-1">
                    @for (att of activeEmail()!.attachments; track att.id) {
                      <a [href]="draftMailService.getAttachmentUrl(activeEmail()!.id, att.id)" target="_blank"
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

              <!-- Send form -->
              <div class="border border-teal-100 rounded-xl p-5 space-y-4 bg-teal-50">
                <h4 class="text-sm font-semibold text-teal-800">Confirmar envío</h4>

                <!-- MailCode -->
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">
                    Código de nota (mailCode)
                    @if (loadingNextCode()) { <span class="text-gray-400">(calculando...)</span> }
                  </label>
                  <input [(ngModel)]="editableMailCode" type="text" placeholder="Ej: DEI 131/25"
                    class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white font-mono" />
                </div>

                <!-- Subject -->
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">Asunto</label>
                  <input [(ngModel)]="editableSubject" type="text" [placeholder]="activeEmail()!.subject"
                    class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white" />
                </div>

                <!-- Send error -->
                @if (sendError()) {
                  <div class="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {{ sendError() }}
                  </div>
                }

                <!-- Send actions -->
                <div class="flex flex-wrap gap-2">
                  <button (click)="sendEmail()" [disabled]="sending() || !editableMailCode.trim()"
                    class="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                    style="background:#0f766e">
                    {{ sending() ? 'Enviando...' : 'Enviar correo' }}
                  </button>
                  <button (click)="promptTicomCancel()"
                    class="px-4 py-2.5 rounded-lg text-sm font-medium text-rose-600 border border-rose-200 bg-white hover:bg-rose-50">
                    Cancelar / Devolver
                  </button>
                </div>
              </div>

              <!-- Cancel form -->
              @if (showCancelForm()) {
                <div class="rounded-lg border border-rose-200 bg-rose-50 p-4 space-y-3">
                  <p class="text-sm font-medium text-rose-800">Motivo de cancelación/devolución:</p>
                  <textarea [(ngModel)]="cancelNotes" rows="3"
                    class="w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
                    placeholder="Indicá el motivo..."></textarea>
                  <div class="flex gap-2">
                    <button (click)="confirmTicomCancel()" [disabled]="sending() || !cancelNotes.trim()"
                      class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50">
                      Confirmar cancelación
                    </button>
                    <button (click)="showCancelForm.set(false); cancelNotes = ''"
                      class="px-4 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-700">
                      Cerrar
                    </button>
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
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            <p class="text-sm">Seleccioná un correo o buscá por hash</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class ParaEnviarComponent implements OnInit {
  readonly draftMailService = inject(DraftMailService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly MONTHS_SHORT = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  private readonly MONTHS_LONG = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

  readonly loading = signal(false);
  readonly sending = signal(false);
  readonly searchingHash = signal(false);
  readonly unlocking = signal(false);
  readonly loadingNextCode = signal(false);

  readonly emails = signal<DraftEmail[]>([]);
  readonly activeEmail = signal<DraftEmail | null>(null);
  readonly unlockedEmailId = signal<string | null>(null);

  hashSearch = '';
  readonly hashNotFound = signal(false);

  unlockHash = '';
  readonly unlockError = signal<string | null>(null);

  editableMailCode = '';
  editableSubject = '';
  private unlockedAt: Date | null = null;

  readonly showCancelForm = signal(false);
  cancelNotes = '';
  readonly sendError = signal<string | null>(null);

  ngOnInit(): void {
    this.loadEmails();

    this.draftMailService.draftStatusChanged$.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ id, event }) => {
      if (event === 'draft_ready_to_send' || event === 'draft_status_changed') {
        // A draft was approved → may need to appear in the list
        this.draftMailService.getApproved().subscribe({
          next: (list) => this.emails.set(list),
          error: () => {},
        });
      } else if (event === 'draft_sent' || event === 'draft_cancelled') {
        // Remove from list if present
        this.emails.update((list) => list.filter((e) => e.id !== id));
        if (this.activeEmail()?.id === id) {
          this.activeEmail.set(null);
          this.unlockedEmailId.set(null);
        }
      }
    });
  }

  loadEmails(): void {
    this.loading.set(true);
    this.draftMailService.getApproved().subscribe({
      next: (list) => { this.emails.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  searchByHash(): void {
    const h = this.hashSearch.trim();
    if (!h) return;
    this.hashNotFound.set(false);
    this.searchingHash.set(true);
    this.draftMailService.getByHash(h).subscribe({
      next: (email) => {
        this.searchingHash.set(false);
        this.hashNotFound.set(false);
        this.activeEmail.set(email);
        this.unlockedEmailId.set(email.id);
        this.unlockedAt = email.hashEnteredAt ? null : new Date();
        this.prepareEditFields(email);
      },
      error: () => {
        this.searchingHash.set(false);
        this.hashNotFound.set(true);
        this.activeEmail.set(null);
        this.unlockedEmailId.set(null);
      },
    });
  }

  selectEmail(email: DraftEmail): void {
    if (this.activeEmail()?.id === email.id && this.unlockedEmailId() === email.id) return;
    this.activeEmail.set(email);
    this.unlockedEmailId.set(null);
    this.unlockedAt = null;
    this.unlockHash = '';
    this.unlockError.set(null);
    this.showCancelForm.set(false);
    this.cancelNotes = '';
    this.sendError.set(null);
    this.editableMailCode = '';
    this.editableSubject = '';
  }

  unlockEmail(): void {
    const h = this.unlockHash.trim();
    if (!h) return;
    const email = this.activeEmail();
    if (!email) return;
    this.unlocking.set(true);
    this.unlockError.set(null);
    this.draftMailService.enterHash(email.id, h).subscribe({
      next: (updated) => {
        this.unlocking.set(false);
        this.activeEmail.set(updated);
        this.unlockedEmailId.set(updated.id);
        this.unlockedAt = updated.hashEnteredAt ? null : new Date();
        this.prepareEditFields(updated);
      },
      error: (err: { error?: { message?: string } }) => {
        this.unlocking.set(false);
        this.unlockError.set(err?.error?.message ?? 'Hash incorrecto o inválido');
      },
    });
  }

  private prepareEditFields(email: DraftEmail): void {
    if (email.mailCode) {
      this.editableMailCode = email.mailCode;
      this.editableSubject = email.mailCode;
    } else {
      this.editableSubject = '';
      this.loadingNextCode.set(true);
      this.draftMailService.getNextMailCode().subscribe({
        next: (r) => {
          this.editableMailCode = r.code;
          this.editableSubject = r.code;
          this.loadingNextCode.set(false);
        },
        error: () => { this.editableMailCode = ''; this.loadingNextCode.set(false); },
      });
    }
  }

  previewBody(): string {
    const email = this.activeEmail();
    if (!email) return '';
    const code = this.editableMailCode.trim();
    let body = email.bodyText ?? '';
    if (code) {
      const deiPlaceholder = /^DEI\s+\/\d{2}/;
      if (deiPlaceholder.test(body)) {
        body = body.replace(deiPlaceholder, `${code}.-`);
      } else {
        body = `${code}.- ${body}`;
      }
    }
    const fdo = email.approvedAt ? this.fmtDateGroup(new Date(email.approvedAt)) : '------';
    const bt = email.hashEnteredAt
      ? this.fmtDateGroup(new Date(email.hashEnteredAt))
      : (this.unlockedAt ? this.fmtDateGroup(this.unlockedAt) : '------');
    const user = this.authService.currentUser();
    const rank = user?.rank ?? '';
    const lastName = (user?.lastName ?? user?.displayName ?? '').toUpperCase();
    const tx = [rank, lastName].filter(Boolean).join(' ');
    return `${body}\n\nFDO: ${fdo}     BT: ${bt}     TX: ${tx}`;
  }

  draftDateGroup(email: DraftEmail): string {
    const d = email.approvedAt ? new Date(email.approvedAt) : new Date(email.createdAt);
    return this.fmtDateGroup(d);
  }

  draftFechaLarga(email: DraftEmail): string {
    const d = email.approvedAt ? new Date(email.approvedAt) : new Date(email.createdAt);
    return `${this.MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  }

  private fmtDateGroup(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${dd}${hh}${mm}${this.MONTHS_SHORT[d.getMonth()]}${String(d.getFullYear()).slice(-2)}`;
  }

  sendEmail(): void {
    const email = this.activeEmail();
    if (!email || !this.editableMailCode.trim()) return;
    this.sending.set(true);
    this.sendError.set(null);
    this.draftMailService.send(
      email.id,
      this.unlockHash,
      this.editableMailCode,
      this.editableSubject || undefined,
    ).subscribe({
      next: (updated) => {
        this.sending.set(false);
        this.emails.update((list) => list.filter((e) => e.id !== updated.id));
        this.activeEmail.set(null);
        this.unlockedEmailId.set(null);
        this.draftMailService.loadApprovedCount();
      },
      error: (err: { error?: { message?: string } }) => {
        this.sending.set(false);
        this.sendError.set(err?.error?.message ?? 'Error al enviar');
      },
    });
  }

  promptTicomCancel(): void {
    this.cancelNotes = '';
    this.showCancelForm.set(true);
  }

  confirmTicomCancel(): void {
    const id = this.activeEmail()?.id;
    if (!id || !this.cancelNotes.trim()) return;
    this.sending.set(true);
    this.draftMailService.ticomCancel(id, this.cancelNotes).subscribe({
      next: (updated) => {
        this.sending.set(false);
        this.emails.update((list) => list.filter((e) => e.id !== updated.id));
        this.activeEmail.set(null);
        this.unlockedEmailId.set(null);
        this.showCancelForm.set(false);
        this.cancelNotes = '';
      },
      error: () => this.sending.set(false),
    });
  }
}
