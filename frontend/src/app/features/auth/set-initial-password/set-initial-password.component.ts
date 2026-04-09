import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-set-initial-password',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-950 p-4">
      <div class="w-full max-w-md">

        <!-- Logo / título -->
        <div class="text-center mb-8">
          <div class="flex items-center justify-center w-16 h-16 rounded-full bg-teal-100 dark:bg-teal-900/30 mx-auto mb-4">
            <svg class="h-8 w-8 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
            </svg>
          </div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Establecé tu contraseña</h1>
          <p class="text-sm text-gray-500 dark:text-zinc-400 mt-2">
            Es tu primer ingreso al sistema. Debés crear una contraseña personal antes de continuar.
          </p>
        </div>

        <!-- Formulario -->
        <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-gray-100 dark:border-zinc-700 p-6 space-y-5">

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Nueva contraseña</label>
            <input [(ngModel)]="newPassword" type="password" placeholder="Mínimo 8 caracteres"
              autocomplete="new-password"
              class="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Repetir contraseña</label>
            <input [(ngModel)]="confirmPassword" type="password" placeholder="Repetí la misma contraseña"
              autocomplete="new-password"
              class="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
              [class.border-red-400]="confirmPassword && newPassword !== confirmPassword" />
            @if (confirmPassword && newPassword !== confirmPassword) {
              <p class="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>
            }
          </div>

          @if (error()) {
            <p class="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{{ error() }}</p>
          }

          <button (click)="submit()"
            [disabled]="!canSubmit() || saving()"
            class="w-full py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
            @if (saving()) {
              <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Guardando...
            } @else {
              Confirmar contraseña
            }
          </button>

          <div class="text-center">
            <button (click)="logout()" class="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">
              Salir de la sesión
            </button>
          </div>

        </div>
      </div>
    </div>
  `,
})
export class SetInitialPasswordComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  newPassword = '';
  confirmPassword = '';
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    // If user doesn't need to change password, redirect to app
    if (!this.authService.currentUser()?.mustChangePassword) {
      void this.router.navigate(['/cuenta']);
    }
  }

  canSubmit(): boolean {
    return this.newPassword.length >= 8 && this.newPassword === this.confirmPassword;
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.error.set(null);
    this.authService.setInitialPassword(this.newPassword).subscribe({
      next: () => {
        this.saving.set(false);
        void this.router.navigate(['/cuenta']);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err.error?.message ?? 'Error al guardar la contraseña. Intentá nuevamente.');
      },
    });
  }

  logout(): void {
    this.authService.logout();
  }
}
