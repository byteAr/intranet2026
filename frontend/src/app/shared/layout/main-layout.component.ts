import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="flex h-screen bg-gray-100">
      <!-- Sidebar -->
      <aside class="flex flex-col transition-all duration-300 text-white"
             [class.w-64]="!collapsed()"
             [class.w-16]="collapsed()"
             style="background: #0f766e">

        <!-- Logo -->
        <div class="flex items-center justify-between h-16 px-4 flex-shrink-0"
             style="background: #0d6460">
          @if (!collapsed()) {
            <span class="text-base font-bold tracking-wide truncate">Intranet Diredtos</span>
          }
          <button (click)="collapsed.set(!collapsed())"
            class="p-1.5 rounded-md transition-colors flex-shrink-0"
            style="hover:background: rgba(255,255,255,0.1)"
            [attr.aria-label]="collapsed() ? 'Expandir menú' : 'Contraer menú'">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 px-2 py-4 space-y-1 overflow-y-auto">

          <!-- Cuenta -->
          <a routerLink="/cuenta" routerLinkActive="active-nav"
            class="nav-item flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors group"
            [title]="collapsed() ? 'Cuenta' : ''">
            <svg class="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            @if (!collapsed()) {
              <span class="ml-3">Cuenta</span>
            }
          </a>

        </nav>

        <!-- User info + logout -->
        <div class="p-4 flex-shrink-0" style="border-top: 1px solid rgba(255,255,255,0.15)">
          @if (!collapsed()) {
            <div class="flex items-center space-x-3 mb-3">
              <div class="h-9 w-9 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-sm font-bold"
                   style="background: #22C562">
                @if (authService.currentUser()?.avatar) {
                  <img [src]="authService.currentUser()!.avatar" class="h-full w-full object-cover" alt="" />
                } @else {
                  {{ userInitials() }}
                }
              </div>
              <div class="overflow-hidden">
                <p class="text-sm font-medium truncate">{{ authService.currentUser()?.displayName }}</p>
                <p class="text-xs truncate" style="color: rgba(255,255,255,0.6)">{{ authService.currentUser()?.username }}</p>
              </div>
            </div>
          }
          <button (click)="authService.logout()"
            class="flex items-center w-full px-3 py-2 text-sm rounded-md transition-colors"
            style="color: rgba(255,255,255,0.75)"
            onmouseover="this.style.background='rgba(255,255,255,0.1)';this.style.color='white'"
            onmouseout="this.style.background='';this.style.color='rgba(255,255,255,0.75)'">
            <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            @if (!collapsed()) {
              <span class="ml-2">Cerrar sesión</span>
            }
          </button>
        </div>
      </aside>

      <!-- Main content -->
      <div class="flex flex-col flex-1 overflow-hidden">
        <!-- Topbar -->
        <header class="h-16 bg-white shadow-sm flex items-center justify-between px-6 flex-shrink-0">
          <h1 class="text-lg font-semibold text-gray-800">{{ pageTitle() }}</h1>
          <div class="flex items-center space-x-3">
            <span class="text-sm text-gray-500">{{ authService.currentUser()?.username }}</span>
            <div class="h-9 w-9 rounded-full overflow-hidden flex items-center justify-center text-sm font-bold text-white"
                 style="background: linear-gradient(135deg, #14B8A5, #22C562)">
              @if (authService.currentUser()?.avatar) {
                <img [src]="authService.currentUser()!.avatar" class="h-full w-full object-cover" alt="" />
              } @else {
                {{ userInitials() }}
              }
            </div>
          </div>
        </header>

        <!-- Page content -->
        <main class="flex-1 overflow-y-auto p-6">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [`
    .nav-item { color: rgba(255,255,255,0.8); }
    .nav-item:hover { background: rgba(255,255,255,0.12); color: white; }
    .active-nav { background: rgba(255,255,255,0.18) !important; color: white !important; font-weight: 600; }
  `],
})
export class MainLayoutComponent {
  readonly authService = inject(AuthService);
  readonly collapsed = signal(false);
  readonly pageTitle = signal('Mi cuenta');

  userInitials(): string {
    const user = this.authService.currentUser();
    if (!user) return '?';
    return (user.displayName ?? user.username)
      .split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  }
}
