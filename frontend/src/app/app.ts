import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VersionCheckService } from './core/services/version-check.service';
import { AppVersionService } from './core/services/app-version.service';
import { UpdateBannerComponent } from './shared/update-banner/update-banner';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, UpdateBannerComponent],
  template: `
    <app-update-banner />
    <router-outlet />
  `,
})
export class App implements OnInit {
  private readonly versionCheck = inject(VersionCheckService);
  private readonly appVersion = inject(AppVersionService);

  ngOnInit(): void {
    this.versionCheck.start();
    // Desde la raíz: así también actualiza en la pantalla de inicio de sesión
    // (quien abre con una copia vieja entra ya con la versión nueva).
    void this.appVersion.iniciar();
  }
}
