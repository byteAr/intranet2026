import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';

type Step = 'login' | 'forgot-username' | 'forgot-otp' | 'forgot-newpass';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-green-100">
      <div class="max-w-md w-full space-y-8 p-10 bg-white rounded-2xl shadow-xl">

        <!-- Header -->
        <div class="text-center">
          <div class="mx-auto h-16 w-16 flex items-center justify-center rounded-full"
               style="background: linear-gradient(135deg, #14B8A5, #22C562)">
            <svg class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 class="mt-4 text-3xl font-extrabold text-gray-900">Intranet Diredtos</h2>
          @if (step() === 'login') {
            <p class="mt-2 text-sm text-gray-600">Inicia sesión con tus credenciales corporativas</p>
          } @else if (step() === 'forgot-username') {
            <p class="mt-2 text-sm text-gray-600">Paso 1 de 3 — Ingresa tu usuario</p>
          } @else if (step() === 'forgot-otp') {
            <p class="mt-2 text-sm text-gray-600">Paso 2 de 3 — Código enviado a tu correo corporativo</p>
          } @else {
            <p class="mt-2 text-sm text-gray-600">Paso 3 de 3 — Establece tu nueva contraseña</p>
          }
        </div>

        <!-- Alert -->
        @if (errorMessage()) {
          <div class="rounded-md bg-red-50 p-4 border border-red-200">
            <div class="flex">
              <svg class="h-5 w-5 text-red-400 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clip-rule="evenodd" />
              </svg>
              <p class="ml-3 text-sm text-red-700">{{ errorMessage() }}</p>
            </div>
          </div>
        }

        @if (successMessage()) {
          <div class="rounded-md bg-green-50 p-4 border border-green-200">
            <div class="flex">
              <svg class="h-5 w-5 text-green-400 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd" />
              </svg>
              <p class="ml-3 text-sm text-green-700">{{ successMessage() }}</p>
            </div>
          </div>
        }

        <!-- ===== STEP: LOGIN ===== -->
        @if (step() === 'login') {
          <form [formGroup]="loginForm" (ngSubmit)="onLogin()" class="space-y-6">
            <div>
              <label for="username" class="block text-sm font-medium text-gray-700">Usuario (AD)</label>
              <input
                id="username"
                type="text"
                formControlName="username"
                autocomplete="username"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm
                       focus:border-teal-500 focus:ring-teal-500 sm:text-sm
                       disabled:bg-gray-50 disabled:text-gray-500"
                [class.border-red-300]="isInvalid(loginForm, 'username')"
                placeholder="usuario.apellido"
              />
              @if (isInvalid(loginForm, 'username')) {
                <p class="mt-1 text-xs text-red-600">El usuario es requerido.</p>
              }
            </div>

            <div>
              <label for="password" class="block text-sm font-medium text-gray-700">Contraseña</label>
              <div class="mt-1 relative">
                <input
                  id="password"
                  [type]="showPassword() ? 'text' : 'password'"
                  formControlName="password"
                  autocomplete="current-password"
                  class="block w-full rounded-md border-gray-300 shadow-sm pr-10
                         focus:border-teal-500 focus:ring-teal-500 sm:text-sm
                         disabled:bg-gray-50 disabled:text-gray-500"
                  [class.border-red-300]="isInvalid(loginForm, 'password')"
                />
                <button type="button"
                  class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  (click)="showPassword.set(!showPassword())">
                  @if (showPassword()) {
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  } @else {
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  }
                </button>
              </div>
              @if (isInvalid(loginForm, 'password')) {
                <p class="mt-1 text-xs text-red-600">La contraseña es requerida.</p>
              }
            </div>

            <button type="submit" [disabled]="loading()"
              class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md
                     shadow-sm text-sm font-medium text-white
                     focus:outline-none focus:ring-2 focus:ring-offset-2
                     focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-all duration-200"
              style="background: linear-gradient(to right, #14B8A5, #22C562)"
              onmouseover="this.style.background='linear-gradient(to right, #0f9d8f, #1aad52)'"
              onmouseout="this.style.background='linear-gradient(to right, #14B8A5, #22C562)'">
              @if (loading()) {
                <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 3 2.373 3 5.373A8.001 8.001 0 004 12z"></path>
                </svg>
                Verificando...
              } @else {
                Iniciar sesión
              }
            </button>
          </form>

          <div class="text-center">
            <button type="button" (click)="goToForgot()"
              class="text-sm hover:underline focus:outline-none" style="color: #14B8A5">
              ¿Olvidaste tu contraseña?
            </button>
          </div>
        }

        <!-- ===== STEP 1: FORGOT — USERNAME ===== -->
        @if (step() === 'forgot-username') {
          <form [formGroup]="forgotUsernameForm" (ngSubmit)="onSendOtp()" class="space-y-6">
            <div>
              <label for="forgot-user" class="block text-sm font-medium text-gray-700">
                Tu usuario de dominio
              </label>
              <input
                id="forgot-user"
                type="text"
                formControlName="username"
                autocomplete="username"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm
                       focus:border-teal-500 focus:ring-teal-500 sm:text-sm"
                [class.border-red-300]="isInvalid(forgotUsernameForm, 'username')"
                placeholder="usuario.apellido"
              />
              @if (isInvalid(forgotUsernameForm, 'username')) {
                <p class="mt-1 text-xs text-red-600">El usuario es requerido.</p>
              }
              <p class="mt-2 text-xs text-gray-500">
                Se enviará un código de 4 dígitos al correo corporativo asociado a este usuario.
              </p>
            </div>

            <div class="flex gap-3">
              <button type="button" (click)="backToLogin()"
                class="flex-1 py-2.5 px-4 border border-gray-300 rounded-md text-sm font-medium
                       text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-200">
                Volver
              </button>
              <button type="submit" [disabled]="loading()"
                class="flex-1 flex justify-center py-2.5 px-4 border border-transparent rounded-md
                       shadow-sm text-sm font-medium text-white bg-indigo-600
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200"
                style="background: linear-gradient(to right, #14B8A5, #22C562)"
                onmouseover="this.style.background='linear-gradient(to right, #0f9d8f, #1aad52)'"
                onmouseout="this.style.background='linear-gradient(to right, #14B8A5, #22C562)'">
                @if (loading()) { Enviando... } @else { Enviar código }
              </button>
            </div>
          </form>
        }

        <!-- ===== STEP 2: FORGOT — OTP ===== -->
        @if (step() === 'forgot-otp') {
          <form [formGroup]="otpForm" (ngSubmit)="onVerifyOtp()" class="space-y-6">
            <div>
              <label for="otp" class="block text-sm font-medium text-gray-700">
                Código de verificación (4 dígitos)
              </label>
              <input
                id="otp"
                type="text"
                formControlName="otp"
                autocomplete="one-time-code"
                maxlength="4"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-center
                       text-2xl font-bold tracking-widest focus:border-teal-500
                       focus:ring-teal-500 sm:text-sm"
                [class.border-red-300]="isInvalid(otpForm, 'otp')"
                placeholder="0000"
              />
              @if (isInvalid(otpForm, 'otp')) {
                <p class="mt-1 text-xs text-red-600">Ingresa el código de 4 dígitos.</p>
              }
              <p class="mt-2 text-xs text-gray-500">
                Revisa el correo corporativo del usuario <strong>{{ forgotUsername() }}</strong>.
                El código expira en 10 minutos.
              </p>
            </div>

            <div class="flex gap-3">
              <button type="button" (click)="step.set('forgot-username')"
                class="flex-1 py-2.5 px-4 border border-gray-300 rounded-md text-sm font-medium
                       text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-200">
                Volver
              </button>
              <button type="submit" [disabled]="loading()"
                class="flex-1 flex justify-center py-2.5 px-4 border border-transparent rounded-md
                       shadow-sm text-sm font-medium text-white bg-indigo-600
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200"
                style="background: linear-gradient(to right, #14B8A5, #22C562)"
                onmouseover="this.style.background='linear-gradient(to right, #0f9d8f, #1aad52)'"
                onmouseout="this.style.background='linear-gradient(to right, #14B8A5, #22C562)'">
                @if (loading()) { Verificando... } @else { Continuar }
              </button>
            </div>
          </form>
        }

        <!-- ===== STEP 3: FORGOT — NEW PASSWORD ===== -->
        @if (step() === 'forgot-newpass') {
          <form [formGroup]="newPasswordForm" (ngSubmit)="onResetPassword()" class="space-y-6">
            <div>
              <label for="newpass" class="block text-sm font-medium text-gray-700">
                Nueva contraseña
              </label>
              <div class="mt-1 relative">
                <input
                  id="newpass"
                  [type]="showNewPassword() ? 'text' : 'password'"
                  formControlName="newPassword"
                  class="block w-full rounded-md border-gray-300 shadow-sm pr-10
                         focus:border-teal-500 focus:ring-teal-500 sm:text-sm"
                  [class.border-red-300]="isInvalid(newPasswordForm, 'newPassword')"
                  placeholder="Mínimo 8 caracteres"
                />
                <button type="button"
                  class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  (click)="showNewPassword.set(!showNewPassword())">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
              @if (isInvalid(newPasswordForm, 'newPassword')) {
                <p class="mt-1 text-xs text-red-600">La contraseña debe tener al menos 8 caracteres.</p>
              }
            </div>

            <div>
              <label for="confirmpass" class="block text-sm font-medium text-gray-700">
                Confirmar contraseña
              </label>
              <input
                id="confirmpass"
                [type]="showNewPassword() ? 'text' : 'password'"
                formControlName="confirmPassword"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm
                       focus:border-teal-500 focus:ring-teal-500 sm:text-sm"
                [class.border-red-300]="isInvalid(newPasswordForm, 'confirmPassword') || passwordMismatch()"
              />
              @if (passwordMismatch()) {
                <p class="mt-1 text-xs text-red-600">Las contraseñas no coinciden.</p>
              }
            </div>

            <div class="flex gap-3">
              <button type="button" (click)="step.set('forgot-otp')"
                class="flex-1 py-2.5 px-4 border border-gray-300 rounded-md text-sm font-medium
                       text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-200">
                Volver
              </button>
              <button type="submit" [disabled]="loading()"
                class="flex-1 flex justify-center py-2.5 px-4 border border-transparent rounded-md
                       shadow-sm text-sm font-medium text-white bg-indigo-600
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200"
                style="background: linear-gradient(to right, #14B8A5, #22C562)"
                onmouseover="this.style.background='linear-gradient(to right, #0f9d8f, #1aad52)'"
                onmouseout="this.style.background='linear-gradient(to right, #14B8A5, #22C562)'">
                @if (loading()) { Guardando... } @else { Restablecer }
              </button>
            </div>
          </form>
        }

      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  step = signal<Step>('login');
  loading = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  showPassword = signal(false);
  showNewPassword = signal(false);
  forgotUsername = signal('');

  loginForm: FormGroup = this.fb.group({
    username: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required]],
  });

  forgotUsernameForm: FormGroup = this.fb.group({
    username: ['', [Validators.required, Validators.maxLength(100)]],
  });

  otpForm: FormGroup = this.fb.group({
    otp: ['', [Validators.required, Validators.pattern(/^\d{4}$/)]],
  });

  newPasswordForm: FormGroup = this.fb.group({
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required]],
  });

  isInvalid(form: FormGroup, field: string): boolean {
    const c = form.get(field);
    return !!(c?.invalid && c.touched);
  }

  passwordMismatch(): boolean {
    const f = this.newPasswordForm;
    return f.touched && f.get('newPassword')?.value !== f.get('confirmPassword')?.value;
  }

  private clearMessages(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  goToForgot(): void {
    this.clearMessages();
    this.forgotUsernameForm.reset();
    this.step.set('forgot-username');
  }

  backToLogin(): void {
    this.clearMessages();
    this.loginForm.reset();
    this.step.set('login');
  }

  onLogin(): void {
    if (this.loginForm.invalid) { this.loginForm.markAllAsTouched(); return; }

    this.loading.set(true);
    this.clearMessages();
    const { username, password } = this.loginForm.value as { username: string; password: string };

    this.authService.login(username, password).subscribe({
      next: () => void this.router.navigate(['/dashboard']),
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('Credenciales incorrectas. Verifica tu usuario y contraseña de dominio.');
      },
    });
  }

  onSendOtp(): void {
    if (this.forgotUsernameForm.invalid) { this.forgotUsernameForm.markAllAsTouched(); return; }

    this.loading.set(true);
    this.clearMessages();
    const { username } = this.forgotUsernameForm.value as { username: string };

    this.authService.forgotPassword(username).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.forgotUsername.set(username);
        this.otpForm.reset();
        this.successMessage.set(`Código enviado a ${res.email}`);
        this.step.set('forgot-otp');
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.message ?? 'Error al enviar el código. Verifica el usuario.');
      },
    });
  }

  onVerifyOtp(): void {
    if (this.otpForm.invalid) { this.otpForm.markAllAsTouched(); return; }

    this.clearMessages();
    const { otp } = this.otpForm.value as { otp: string };

    // El OTP se verifica en el servidor junto con el reset — avanzamos al paso 3
    this.newPasswordForm.reset();
    this.step.set('forgot-newpass');
    this.successMessage.set('Código aceptado. Ahora establece tu nueva contraseña.');
  }

  onResetPassword(): void {
    if (this.newPasswordForm.invalid) { this.newPasswordForm.markAllAsTouched(); return; }
    if (this.passwordMismatch()) return;

    this.loading.set(true);
    this.clearMessages();
    const { newPassword } = this.newPasswordForm.value as { newPassword: string; confirmPassword: string };
    const { otp } = this.otpForm.value as { otp: string };

    this.authService.resetPassword(this.forgotUsername(), otp, newPassword).subscribe({
      next: () => {
        this.loading.set(false);
        this.successMessage.set('¡Contraseña restablecida exitosamente! Ya puedes iniciar sesión.');
        this.step.set('login');
        this.loginForm.reset();
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.message ?? 'Error al restablecer la contraseña.');
      },
    });
  }
}
