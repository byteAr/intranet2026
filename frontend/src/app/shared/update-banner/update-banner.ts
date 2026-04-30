import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VersionCheckService } from '../../core/services/version-check.service';

@Component({
  selector: 'app-update-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (versionCheck.updateAvailable()) {
      <div class="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-4 bg-blue-600 px-4 py-2 text-white shadow-lg">
        <span class="text-sm font-medium">
          Hay una nueva versión disponible del sistema.
        </span>
        <button
          (click)="versionCheck.reload()"
          class="shrink-0 rounded bg-white px-3 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-50"
        >
          Actualizar ahora
        </button>
      </div>
    }
  `,
})
export class UpdateBannerComponent {
  readonly versionCheck = inject(VersionCheckService);
}
