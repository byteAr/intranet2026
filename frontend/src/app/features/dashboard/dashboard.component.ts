import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">
      <!-- Welcome banner -->
      <div class="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
        <h2 class="text-2xl font-bold text-gray-900">
          Bienvenido, {{ authService.currentUser()?.displayName ?? 'Usuario' }}
        </h2>
        <p class="mt-1 text-gray-500">
          Has iniciado sesión correctamente con tu cuenta corporativa.
        </p>
      </div>

      <!-- Stats grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <dt class="text-sm font-medium text-gray-500 truncate">Usuario AD</dt>
          <dd class="mt-1 text-2xl font-semibold text-gray-900">
            {{ authService.currentUser()?.username }}
          </dd>
        </div>

        <div class="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <dt class="text-sm font-medium text-gray-500 truncate">Email</dt>
          <dd class="mt-1 text-lg font-semibold text-gray-900 truncate">
            {{ authService.currentUser()?.email }}
          </dd>
        </div>

        <div class="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <dt class="text-sm font-medium text-gray-500 truncate">Roles</dt>
          <dd class="mt-2 flex flex-wrap gap-2">
            @for (role of authService.currentUser()?.roles; track role) {
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white" style="background: linear-gradient(to right, #14B8A5, #22C562)">
                {{ role }}
              </span>
            }
            @if (!authService.currentUser()?.roles?.length) {
              <span class="text-sm text-gray-400">Sin roles asignados</span>
            }
          </dd>
        </div>
      </div>

      <!-- Auth info card -->
      <div class="bg-green-50 border border-green-200 rounded-xl p-6">
        <div class="flex items-start">
          <div class="flex-shrink-0">
            <svg class="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div class="ml-4">
            <h3 class="text-sm font-medium text-green-800">Autenticación exitosa via LDAP/AD</h3>
            <p class="mt-1 text-sm text-green-700">
              Tu sesión está protegida con JWT. Todas las peticiones a la API incluyen el token de autenticación automáticamente.
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DashboardComponent {
  readonly authService = inject(AuthService);
}
