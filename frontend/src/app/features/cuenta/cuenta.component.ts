import { Component, inject, signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

type Panel = 'info' | 'password' | 'recovery';

@Component({
  selector: 'app-cuenta',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DatePipe],
  template: `
    <div class="space-y-6 max-w-3xl mx-auto">

      <!-- Header + avatar -->
      <div class="bg-white rounded-2xl shadow-sm p-6 border border-gray-100">
        <div class="flex items-center gap-6">
          <!-- Avatar -->
          <div class="relative flex-shrink-0">
            <div class="h-24 w-24 rounded-full overflow-hidden border-4 flex items-center justify-center text-2xl font-bold text-white"
                 style="border-color: #14B8A5; background: linear-gradient(135deg, #14B8A5, #22C562)">
              @if (user()?.avatar) {
                <img [src]="user()!.avatar" class="h-full w-full object-cover" alt="Avatar" />
              } @else {
                {{ initials() }}
              }
            </div>
            <button (click)="fileInput.click()"
              class="absolute bottom-0 right-0 h-7 w-7 rounded-full border-2 border-white flex items-center justify-center shadow text-white"
              style="background: #14B8A5"
              title="Cambiar foto">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <input #fileInput type="file" accept="image/*" class="hidden" (change)="onAvatarSelected($event)" />
          </div>

          <!-- User info -->
          <div class="flex-1 min-w-0">
            <h2 class="text-2xl font-bold text-gray-900 truncate">{{ user()?.displayName }}</h2>
            <p class="text-sm text-gray-500 truncate">{{ user()?.username }} — {{ user()?.email }}</p>
            @if (user()?.lastLoginAt) {
              <p class="mt-2 text-xs text-gray-400">
                Último acceso: {{ user()!.lastLoginAt | date:'dd/MM/yyyy HH:mm' }}
              </p>
            }
          </div>

          <!-- Avatar save btn -->
          @if (avatarChanged()) {
            <button (click)="saveAvatar()" [disabled]="savingAvatar()"
              class="px-4 py-2 rounded-lg text-sm font-medium text-white shadow disabled:opacity-50"
              style="background: linear-gradient(to right, #14B8A5, #22C562)">
              {{ savingAvatar() ? 'Guardando...' : 'Guardar foto' }}
            </button>
          }
        </div>
      </div>

      <!-- Alertas globales -->
      @if (successMsg()) {
        <div class="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-700 flex items-center gap-2">
          <svg class="h-4 w-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
          </svg>
          {{ successMsg() }}
        </div>
      }
      @if (errorMsg()) {
        <div class="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center gap-2">
          <svg class="h-4 w-4 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
          </svg>
          {{ errorMsg() }}
        </div>
      }

      <!-- Paneles -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        @for (panel of panels; track panel.id) {
          <button (click)="activePanel.set(panel.id)"
            class="flex flex-col items-center p-5 rounded-2xl border-2 transition-all duration-200 text-left"
            [class.border-transparent]="activePanel() !== panel.id"
            [class.bg-white]="activePanel() !== panel.id"
            [class.shadow-sm]="activePanel() !== panel.id"
            [style.border-color]="activePanel() === panel.id ? '#14B8A5' : ''"
            [style.background]="activePanel() === panel.id ? '#f0fdfb' : ''">
            <div class="h-10 w-10 rounded-full flex items-center justify-center mb-2"
                 [style.background]="activePanel() === panel.id ? 'linear-gradient(135deg, #14B8A5, #22C562)' : '#f3f4f6'">
              <svg class="h-5 w-5" [class.text-white]="activePanel() === panel.id" [class.text-gray-500]="activePanel() !== panel.id"
                   fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" [attr.d]="panel.icon" />
              </svg>
            </div>
            <span class="text-sm font-semibold" [style.color]="activePanel() === panel.id ? '#14B8A5' : '#374151'">
              {{ panel.label }}
            </span>
          </button>
        }
      </div>

      <!-- Panel: Información -->
      @if (activePanel() === 'info') {
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 class="text-lg font-semibold text-gray-800">Información de la cuenta</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            @for (field of infoFields(); track field.label) {
              <div>
                <dt class="text-xs font-medium text-gray-400 uppercase tracking-wide">{{ field.label }}</dt>
                <dd class="mt-1 text-sm text-gray-900 font-medium break-all">{{ field.value || '—' }}</dd>
              </div>
            }
          </div>
        </div>
      }

      <!-- Panel: Cambiar contraseña -->
      @if (activePanel() === 'password') {
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 class="text-lg font-semibold text-gray-800 mb-4">Cambiar contraseña de dominio</h3>
          <form [formGroup]="passwordForm" (ngSubmit)="onChangePassword()" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Contraseña actual</label>
              <input [type]="showCurrent() ? 'text' : 'password'" formControlName="currentPassword"
                class="w-full rounded-lg border-gray-300 shadow-sm text-sm focus:ring-teal-500 focus:border-teal-500"
                [class.border-red-300]="isInvalid(passwordForm, 'currentPassword')" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
              <div class="relative">
                <input [type]="showNew() ? 'text' : 'password'" formControlName="newPassword"
                  class="w-full rounded-lg border-gray-300 shadow-sm text-sm focus:ring-teal-500 focus:border-teal-500 pr-10"
                  [class.border-red-300]="isInvalid(passwordForm, 'newPassword')" />
                <button type="button" (click)="showNew.set(!showNew())"
                  class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
              @if (isInvalid(passwordForm, 'newPassword')) {
                <p class="mt-1 text-xs text-red-600">Mínimo 8 caracteres.</p>
              }
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Confirmar nueva contraseña</label>
              <input [type]="showNew() ? 'text' : 'password'" formControlName="confirmPassword"
                class="w-full rounded-lg border-gray-300 shadow-sm text-sm focus:ring-teal-500 focus:border-teal-500"
                [class.border-red-300]="pwdMismatch()" />
              @if (pwdMismatch()) {
                <p class="mt-1 text-xs text-red-600">Las contraseñas no coinciden.</p>
              }
            </div>
            <button type="submit" [disabled]="savingPwd()"
              class="px-6 py-2 rounded-lg text-sm font-medium text-white shadow disabled:opacity-50"
              style="background: linear-gradient(to right, #14B8A5, #22C562)">
              {{ savingPwd() ? 'Actualizando...' : 'Actualizar contraseña' }}
            </button>
          </form>
        </div>
      }

      <!-- Panel: Correo de recuperación -->
      @if (activePanel() === 'recovery') {
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 class="text-lg font-semibold text-gray-800 mb-1">Correo de recuperación</h3>
          <p class="text-sm text-gray-500 mb-4">
            Este correo alternativo se usará para recibir el código OTP cuando solicites recuperar tu contraseña.
          </p>
          <form [formGroup]="recoveryForm" (ngSubmit)="onSaveRecovery()" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Correo alternativo</label>
              <input type="email" formControlName="recoveryEmail"
                class="w-full rounded-lg border-gray-300 shadow-sm text-sm focus:ring-teal-500 focus:border-teal-500"
                [class.border-red-300]="isInvalid(recoveryForm, 'recoveryEmail')"
                placeholder="tucorreo@personal.com" />
              @if (isInvalid(recoveryForm, 'recoveryEmail')) {
                <p class="mt-1 text-xs text-red-600">Ingresa un correo válido.</p>
              }
            </div>
            <button type="submit" [disabled]="savingRecovery()"
              class="px-6 py-2 rounded-lg text-sm font-medium text-white shadow disabled:opacity-50"
              style="background: linear-gradient(to right, #14B8A5, #22C562)">
              {{ savingRecovery() ? 'Guardando...' : 'Guardar correo' }}
            </button>
          </form>
        </div>
      }

    </div>
  `,
})
export class CuentaComponent {
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  user = this.authService.currentUser;
  activePanel = signal<Panel>('info');
  successMsg = signal<string | null>(null);
  errorMsg = signal<string | null>(null);
  showCurrent = signal(false);
  showNew = signal(false);
  savingAvatar = signal(false);
  savingPwd = signal(false);
  savingRecovery = signal(false);
  avatarChanged = signal(false);
  pendingAvatar = signal<string | null>(null);

  panels = [
    { id: 'info' as Panel, label: 'Información', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
    { id: 'password' as Panel, label: 'Contraseña', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
    { id: 'recovery' as Panel, label: 'Recuperación', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  ];

  passwordForm: FormGroup = this.fb.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  });

  recoveryForm: FormGroup = this.fb.group({
    recoveryEmail: [this.user()?.recoveryEmail ?? '', [Validators.required, Validators.email]],
  });

  initials(): string {
    return (this.user()?.displayName ?? this.user()?.username ?? '?')
      .split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  }

  infoFields() {
    const u = this.user();
    return [
      { label: 'Usuario', value: u?.username },
      { label: 'Correo corporativo', value: u?.email },
      { label: 'Correo de recuperación', value: u?.recoveryEmail },
      { label: 'Cargo', value: u?.title },
      { label: 'Departamento', value: u?.department },
      { label: 'Empresa', value: u?.company },
      { label: 'Oficina', value: u?.office },
      { label: 'Teléfono', value: u?.phone },
      { label: 'Móvil', value: u?.mobile },
      { label: 'Jefe directo', value: u?.manager },
      { label: 'Legajo', value: u?.employeeId },
      { label: 'Estado', value: u?.isActive ? 'Activo' : 'Inactivo' },
    ].filter(f => f.value);
  }

  isInvalid(form: FormGroup, field: string): boolean {
    const c = form.get(field);
    return !!(c?.invalid && c.touched);
  }

  pwdMismatch(): boolean {
    const f = this.passwordForm;
    return f.touched && f.get('newPassword')?.value !== f.get('confirmPassword')?.value;
  }

  private clear(): void {
    this.successMsg.set(null);
    this.errorMsg.set(null);
  }

  onAvatarSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) { this.errorMsg.set('La imagen no debe superar 1.5 MB'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      this.pendingAvatar.set(base64);
      // preview immediately via authService user signal update (temporary)
      const updated = { ...this.user()!, avatar: base64 };
      this.authService['_user'].set(updated);
      this.avatarChanged.set(true);
    };
    reader.readAsDataURL(file);
  }

  saveAvatar(): void {
    const avatar = this.pendingAvatar();
    if (!avatar) return;
    this.clear();
    this.savingAvatar.set(true);
    this.authService.updateProfile({ avatar }).subscribe({
      next: () => { this.savingAvatar.set(false); this.avatarChanged.set(false); this.successMsg.set('Foto de perfil actualizada.'); },
      error: () => { this.savingAvatar.set(false); this.errorMsg.set('Error al guardar la foto.'); },
    });
  }

  onChangePassword(): void {
    if (this.passwordForm.invalid) { this.passwordForm.markAllAsTouched(); return; }
    if (this.pwdMismatch()) return;
    this.clear();
    this.savingPwd.set(true);
    const { currentPassword, newPassword } = this.passwordForm.value as { currentPassword: string; newPassword: string; confirmPassword: string };
    this.authService.changePassword(currentPassword, newPassword).subscribe({
      next: () => {
        this.savingPwd.set(false);
        this.passwordForm.reset();
        this.successMsg.set('Contraseña actualizada correctamente en el dominio.');
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingPwd.set(false);
        this.errorMsg.set(err?.error?.message ?? 'Error al actualizar la contraseña.');
      },
    });
  }

  onSaveRecovery(): void {
    if (this.recoveryForm.invalid) { this.recoveryForm.markAllAsTouched(); return; }
    this.clear();
    this.savingRecovery.set(true);
    const { recoveryEmail } = this.recoveryForm.value as { recoveryEmail: string };
    this.authService.updateProfile({ recoveryEmail }).subscribe({
      next: () => {
        this.savingRecovery.set(false);
        this.successMsg.set('Correo de recuperación guardado correctamente.');
      },
      error: () => {
        this.savingRecovery.set(false);
        this.errorMsg.set('Error al guardar el correo de recuperación.');
      },
    });
  }
}
