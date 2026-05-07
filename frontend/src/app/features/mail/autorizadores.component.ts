import {
  Component,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DraftMailService, DraftMailSigner } from '../../core/services/draft-mail.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-autorizadores',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="max-w-lg mx-auto space-y-6">

      <!-- Header -->
      <div class="bg-white rounded-2xl shadow-sm p-6 border border-gray-100">
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded-full flex items-center justify-center"
               style="background: linear-gradient(135deg, #d97706, #b45309)">
            <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900">Configuración del firmante MTO</h2>
            <p class="text-sm text-gray-500">Nombre y jerarquía que aparecen al pie de los MTOs enviados</p>
          </div>
        </div>
      </div>

      @if (!isMlopez()) {
        <div class="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <p class="text-sm text-amber-700">Solo el administrador puede configurar el firmante.</p>
        </div>
      } @else {

        <!-- Current signer / form -->
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-100"
               style="background: linear-gradient(135deg, #fffbeb, #fef3c7)">
            <h3 class="text-sm font-bold text-amber-800">Firmante actual</h3>
          </div>

          <div class="p-6 space-y-5">
            @if (loading()) {
              <div class="flex items-center justify-center h-16">
                <svg class="h-6 w-6 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                </svg>
              </div>
            } @else {
              @if (signer()) {
                <div class="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-100">
                  <div class="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                       style="background: linear-gradient(135deg, #d97706, #b45309)">
                    {{ initials(signer()!.displayName) }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-gray-900">{{ signer()!.displayName }}</p>
                    <p class="text-xs text-gray-500">{{ signer()!.rank }}</p>
                    <p class="text-xs text-gray-400 mt-0.5">
                      Configurado por {{ signer()!.setByName }}
                      · {{ signer()!.createdAt | date:'dd/MM/yy HH:mm' }}
                    </p>
                  </div>
                </div>
              } @else {
                <p class="text-sm text-gray-400">No hay firmante configurado.</p>
              }

              <!-- Form fields -->
              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">Nombre completo</label>
                  <input
                    [(ngModel)]="displayName"
                    type="text"
                    placeholder="Ej: Juan Carlos PÉREZ"
                    class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1">Jerarquía</label>
                  <input
                    [(ngModel)]="rank"
                    type="text"
                    placeholder="Ej: Director de Educación e Institutos"
                    class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                </div>
              </div>

              @if (error()) {
                <div class="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {{ error() }}
                </div>
              }

              @if (successMsg()) {
                <div class="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                  {{ successMsg() }}
                </div>
              }

              <!-- Action buttons -->
              <div class="flex items-center gap-3">
                <button (click)="saveSigner()"
                  [disabled]="saving() || !displayName.trim() || !rank.trim()"
                  class="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-40"
                  style="background: linear-gradient(135deg, #d97706, #b45309)">
                  @if (saving()) {
                    <span class="flex items-center gap-2">
                      <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                      </svg>
                      Guardando...
                    </span>
                  } @else {
                    Guardar firmante
                  }
                </button>

                @if (signer()) {
                  <button (click)="removeSigner()"
                    [disabled]="removing()"
                    class="px-4 py-2 text-sm font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors disabled:opacity-40">
                    @if (removing()) {
                      Quitando...
                    } @else {
                      Quitar firmante
                    }
                  </button>
                }
              </div>
            }
          </div>
        </div>

      }
    </div>
  `,
})
export class AutorizadoresComponent implements OnInit {
  private readonly draftMailService = inject(DraftMailService);
  private readonly authService = inject(AuthService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly removing = signal(false);
  readonly signer = signal<DraftMailSigner | null>(null);
  readonly error = signal<string | null>(null);
  readonly successMsg = signal<string | null>(null);

  displayName = '';
  rank = '';

  isMlopez(): boolean {
    return this.authService.currentUser()?.username?.toLowerCase() === 'mlopez';
  }

  ngOnInit(): void {
    if (this.isMlopez()) {
      this.loadSigner();
    }
  }

  loadSigner(): void {
    this.loading.set(true);
    this.draftMailService.getSigner().subscribe({
      next: (s) => {
        this.signer.set(s);
        if (s) {
          this.displayName = s.displayName;
          this.rank = s.rank;
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  saveSigner(): void {
    const name = this.displayName.trim();
    const r = this.rank.trim();
    if (!name || !r) return;

    this.error.set(null);
    this.successMsg.set(null);
    this.saving.set(true);

    this.draftMailService.setSigner(name, r).subscribe({
      next: (s) => {
        this.saving.set(false);
        this.signer.set(s);
        this.displayName = s.displayName;
        this.rank = s.rank;
        this.successMsg.set('Firmante actualizado correctamente');
        setTimeout(() => this.successMsg.set(null), 3000);
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? 'Error al guardar el firmante');
      },
    });
  }

  removeSigner(): void {
    if (!confirm('¿Quitar el firmante actual? Los MTOs no tendrán firma configurada hasta que se designe uno nuevo.')) return;

    this.error.set(null);
    this.successMsg.set(null);
    this.removing.set(true);

    this.draftMailService.removeSigner().subscribe({
      next: () => {
        this.removing.set(false);
        this.signer.set(null);
        this.displayName = '';
        this.rank = '';
        this.successMsg.set('Firmante eliminado');
        setTimeout(() => this.successMsg.set(null), 3000);
      },
      error: () => this.removing.set(false),
    });
  }

  initials(name: string): string {
    const parts = (name ?? '').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] ?? '?').toUpperCase();
  }
}
