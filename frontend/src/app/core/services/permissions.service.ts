import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export const ALL_MODULES = ['chat', 'incidencias', 'reservas', 'correo', 'redactar-mto'] as const;
export type AppModule = typeof ALL_MODULES[number];

@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private readonly http = inject(HttpClient);

  readonly allowedModules = signal<string[] | null>(null);

  load(): void {
    this.http.get<{ allowedModules: string[] }>('/api/permissions/me').subscribe({
      next:  (res) => this.allowedModules.set(res.allowedModules),
      error: ()    => this.allowedModules.set([...ALL_MODULES]), // fallback: mostrar todo
    });
  }

  isAllowed(module: AppModule): boolean {
    const modules = this.allowedModules();
    if (modules === null) return true; // aún cargando → mostrar todo
    return modules.includes(module);
  }
}
