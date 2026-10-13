import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppVersionService } from './core/services/app-version.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <router-outlet />
  `,
})
export class App implements OnInit {
  private readonly appVersion = inject(AppVersionService);

  ngOnInit(): void {
    // Desde la raíz: así también actualiza en la pantalla de inicio de sesión
    // (quien abre con una copia vieja entra ya con la versión nueva). Se
    // actualiza sola en un momento seguro; la franja azul "Hay una nueva
    // versión" (VersionCheckService) se quitó el 13/10/2026.
    void this.appVersion.iniciar();
  }
}
