import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        loadComponent: () =>
          import('./features/auth/login/login.component').then(
            (m) => m.LoginComponent,
          ),
      },
      { path: '', redirectTo: 'login', pathMatch: 'full' },
    ],
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/layout/main-layout.component').then(
        (m) => m.MainLayoutComponent,
      ),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'cuenta',
        loadComponent: () =>
          import('./features/cuenta/cuenta.component').then(
            (m) => m.CuentaComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
