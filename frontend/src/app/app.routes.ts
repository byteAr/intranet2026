import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'cuenta',
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
      {
        path: 'chat',
        loadComponent: () =>
          import('./features/chat/chat.component').then(
            (m) => m.ChatComponent,
          ),
      },
      {
        path: 'incidencias',
        loadComponent: () =>
          import('./features/incidents/incidents.component').then(
            (m) => m.IncidentsComponent,
          ),
      },
      {
        path: 'reservas',
        loadComponent: () =>
          import('./features/reservations/reservations.component').then(
            (m) => m.ReservationsComponent,
          ),
      },
      {
        path: 'correo',
        loadComponent: () =>
          import('./features/mail/mail.component').then(
            (m) => m.MailComponent,
          ),
      },
      {
        path: 'correo/admin',
        loadComponent: () =>
          import('./features/mail/pst-admin.component').then(
            (m) => m.PstAdminComponent,
          ),
      },
      {
        path: 'correo/redactar-mto',
        loadComponent: () =>
          import('./features/mail/draft-mail.component').then(
            (m) => m.DraftMailComponent,
          ),
      },
      {
        path: 'correo/para-enviar',
        loadComponent: () =>
          import('./features/mail/para-enviar.component').then(
            (m) => m.ParaEnviarComponent,
          ),
      },
      {
        path: 'correo/autorizadores',
        loadComponent: () =>
          import('./features/mail/autorizadores.component').then(
            (m) => m.AutorizadoresComponent,
          ),
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./features/admin/admin.component').then(
            (m) => m.AdminComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'cuenta' },
];
