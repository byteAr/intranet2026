import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VersionCheckService } from './core/services/version-check.service';
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

  ngOnInit(): void {
    this.versionCheck.start();
  }
}
