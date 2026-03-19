import { Component, inject, signal, ViewChildren, QueryList, ElementRef } from '@angular/core';
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
          <img src="assets/images/diredtosintranet.png" class="mx-auto h-36 object-contain" alt="Diredtos Intranet" />
          @if (step() === 'login') {
            <p class="mt-2 text-sm text-gray-600">Inicie sesión con el mismo usuario y contraseña que utiliza para ingresar a la PC</p>
          } @else if (step() === 'forgot-username') {
            <p class="mt-2 text-sm text-gray-600">Paso 1 de 3 — Ingresa tu usuario</p>
          } @else if (step() === 'forgot-otp') {
            <p class="mt-2 text-sm text-gray-600">Paso 2 de 3 — Código enviado a tu correo educativo</p>
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
              <label for="username" class="block text-sm font-medium text-gray-700">Usuario</label>
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
                <svg class="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 3 2.373 3 5.373A8.001 8.001 0 004 12z"></path>
                </svg>
              } @else {
                Iniciar sesión
              }
            </button>
          </form>

          <div class="text-center space-y-3">
            <button type="button" (click)="goToForgot()"
              class="text-sm hover:underline focus:outline-none" style="color: #14B8A5">
              ¿Olvidaste tu contraseña?
            </button>
            <p class="text-xs text-gray-400 mt-6">División tecnología de la información y comunicaciones</p>
          </div>
        }

        <!-- ===== STEP 1: FORGOT — USERNAME ===== -->
        @if (step() === 'forgot-username') {
          <form [formGroup]="forgotUsernameForm" (ngSubmit)="onSendOtp()" class="space-y-6">
            <div>
              <label for="forgot-user" class="block text-sm font-medium text-gray-700">
                Tu usuario
              </label>
              <input
                id="forgot-user"
                type="text"
                formControlName="username"
                autocomplete="username"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm
                       focus:border-teal-500 focus:ring-teal-500 sm:text-sm"
                [class.border-red-300]="isInvalid(forgotUsernameForm, 'username')"
                placeholder="Tu usuario"
              />
              @if (isInvalid(forgotUsernameForm, 'username')) {
                <p class="mt-1 text-xs text-red-600">El usuario es requerido.</p>
              }
              <p class="mt-2 text-xs text-gray-500">
                Se enviará un código de 4 dígitos al correo educativo asociado a este usuario.
              </p>
            </div>

            <div class="flex gap-3">
              <button type="button" (click)="backToLogin()"
                class="flex-1 py-2.5 px-4 border border-gray-300 rounded-md text-sm font-medium
                       text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-200">
                Volver
              </button>
              <button type="submit" [disabled]="loading()"
                class="flex-1 flex justify-center items-center py-2.5 px-4 border border-transparent rounded-md
                       shadow-sm text-sm font-medium text-white
                       disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                style="background: linear-gradient(to right, #14B8A5, #22C562)"
                onmouseover="this.style.background='linear-gradient(to right, #0f9d8f, #1aad52)'"
                onmouseout="this.style.background='linear-gradient(to right, #14B8A5, #22C562)'">
                @if (loading()) {
                  <svg class="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 3 2.373 3 5.373A8.001 8.001 0 004 12z"></path>
                  </svg>
                } @else {
                  Enviar código
                }
              </button>
            </div>
          </form>
        }

        <!-- ===== STEP 2: FORGOT — OTP ===== -->
        @if (step() === 'forgot-otp') {
          <div class="space-y-6">
            <div>
              <p class="block text-sm font-medium text-gray-700 text-center mb-6">
                Código de verificación
              </p>

              <!-- 4 OTP boxes -->
              <div class="flex justify-center gap-4">
                @for (digit of otpDigits(); track $index) {
                  <div class="otp-wrapper"
                       [class.otp-wrapper--filled]="digit !== '' && !otpError()"
                       [class.otp-wrapper--error]="otpError()">
                    <input
                      #otpInput
                      type="text"
                      inputmode="numeric"
                      maxlength="1"
                      class="otp-input"
                      [class.otp-input--error]="otpError()"
                      [value]="digit"
                      [disabled]="otpVerifying()"
                      (input)="onOtpInput($index, $event)"
                      (keydown)="onOtpKeydown($index, $event)"
                      (paste)="onOtpPaste($event)"
                      autocomplete="one-time-code"
                    />
                  </div>
                }
              </div>
              @if (otpVerifying()) {
                <div class="flex justify-center mt-4">
                  <svg class="animate-spin h-6 w-6" style="color: #14B8A5" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 3 2.373 3 5.373A8.001 8.001 0 004 12z"></path>
                  </svg>
                </div>
              }

              <p class="mt-4 text-xs text-gray-500 text-center">
                Revisa el correo educativo del usuario <strong>{{ forgotUsername() }}</strong>.
                El código expira en 10 minutos.
              </p>
            </div>

            <div class="flex gap-3">
              <button type="button" (click)="step.set('forgot-username')"
                class="flex-1 py-2.5 px-4 border border-gray-300 rounded-md text-sm font-medium
                       text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-200">
                Volver
              </button>
            </div>
          </div>
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
                class="flex-1 flex justify-center items-center py-2.5 px-4 border border-transparent rounded-md
                       shadow-sm text-sm font-medium text-white
                       disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                style="background: linear-gradient(to right, #14B8A5, #22C562)"
                onmouseover="this.style.background='linear-gradient(to right, #0f9d8f, #1aad52)'"
                onmouseout="this.style.background='linear-gradient(to right, #14B8A5, #22C562)'">
                @if (loading()) {
                  <svg class="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 3 2.373 3 5.373A8.001 8.001 0 004 12z"></path>
                  </svg>
                } @else {
                  Restablecer
                }
              </button>
            </div>
          </form>
        }

      </div>
    </div>
  `,
  styles: [`
    .otp-wrapper {
      display: inline-flex;
      padding: 2px;
      border-radius: 14px;
      background: linear-gradient(135deg, #d1fae5, #ccfbf1);
      transition: all 0.2s;
    }
    .otp-wrapper:focus-within {
      background: linear-gradient(135deg, #14B8A5, #22C562);
      box-shadow: 0 0 0 4px rgba(20, 184, 165, 0.18);
    }
    .otp-wrapper--filled {
      background: linear-gradient(135deg, #14B8A5, #22C562);
    }
    .otp-wrapper--error {
      background: linear-gradient(135deg, #ef4444, #dc2626) !important;
      box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18);
      animation: shake 0.4s ease;
    }
    .otp-input {
      width: 44px;
      height: 52px;
      text-align: center;
      font-size: 1.4rem;
      font-weight: 700;
      border-radius: 10px;
      border: none;
      outline: none;
      background: white;
      color: #0d9488;
      caret-color: #14B8A5;
      transition: color 0.2s;
    }
    .otp-input--error {
      color: #ef4444 !important;
    }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%       { transform: translateX(-6px); }
      40%       { transform: translateX(6px); }
      60%       { transform: translateX(-4px); }
      80%       { transform: translateX(4px); }
    }
  `],
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  @ViewChildren('otpInput') otpInputs!: QueryList<ElementRef<HTMLInputElement>>;

  step = signal<Step>('login');
  loading = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  showPassword = signal(false);
  showNewPassword = signal(false);
  forgotUsername = signal('');
  otpDigits = signal<string[]>(['', '', '', '']);
  otpError = signal(false);
  otpVerifying = signal(false);

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

  focusOtp(index: number): void {
    const inputs = this.otpInputs?.toArray();
    inputs?.[index]?.nativeElement.focus();
  }

  onOtpInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = input.value.replace(/\D/g, '').slice(-1);
    input.value = val;
    const digits = [...this.otpDigits()];
    digits[index] = val;
    this.otpDigits.set(digits);
    this.otpForm.get('otp')?.setValue(digits.join(''));

    // Limpiar error al empezar a corregir
    if (this.otpError()) this.otpError.set(false);

    if (val && index < 3) {
      setTimeout(() => this.focusOtp(index + 1), 0);
    }

    if (digits.every(d => d !== '')) {
      setTimeout(() => this.onVerifyOtp(), 80);
    }
  }

  onOtpKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.otpDigits()[index] && index > 0) {
      setTimeout(() => this.focusOtp(index - 1), 0);
    }
  }

  onOtpPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    const digits = text.replace(/\D/g, '').slice(0, 4).split('');
    if (digits.length === 4) {
      event.preventDefault();
      this.otpDigits.set(digits);
      this.otpForm.get('otp')?.setValue(digits.join(''));
      setTimeout(() => this.focusOtp(3), 0);
      setTimeout(() => this.onVerifyOtp(), 150);
    }
  }

  onLogin(): void {
    if (this.loginForm.invalid) { this.loginForm.markAllAsTouched(); return; }

    this.loading.set(true);
    this.clearMessages();
    const { username, password } = this.loginForm.value as { username: string; password: string };

    this.authService.login(username, password).subscribe({
      next: () => void this.router.navigate(['/cuenta']),
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
        this.otpDigits.set(['', '', '', '']);
        this.otpForm.reset();
        this.successMessage.set(`Código enviado a ${res.email}`);
        this.step.set('forgot-otp');
        setTimeout(() => this.focusOtp(0), 100);
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.message ?? 'Error al enviar el código. Verifica el usuario.');
      },
    });
  }

  onVerifyOtp(): void {
    if (this.otpForm.invalid) return;

    this.otpVerifying.set(true);
    this.otpError.set(false);
    this.clearMessages();
    const otp = this.otpForm.get('otp')!.value as string;

    this.authService.verifyOtp(this.forgotUsername(), otp).subscribe({
      next: () => {
        this.otpVerifying.set(false);
        this.newPasswordForm.reset();
        this.step.set('forgot-newpass');
        this.successMessage.set('Código aceptado. Ahora establece tu nueva contraseña.');
      },
      error: (err: { error?: { message?: string } }) => {
        this.otpVerifying.set(false);
        this.otpError.set(true);
        this.errorMessage.set(err?.error?.message ?? 'Código incorrecto.');
        // Limpiar cajitas para reintento
        setTimeout(() => {
          this.otpDigits.set(['', '', '', '']);
          this.otpForm.get('otp')?.setValue('');
          this.otpError.set(false);
          this.focusOtp(0);
        }, 1200);
      },
    });
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
