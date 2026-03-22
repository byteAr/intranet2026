import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly http = inject(HttpClient);
  private readonly swPush = inject(SwPush);

  async subscribe(): Promise<void> {
    if (!this.swPush.isEnabled) return;

    // Esperar a que el SW esté activo
    await this.waitForSW();

    try {
      const { key } = await firstValueFrom(
        this.http.get<{ key: string }>('/api/push/vapid-public-key')
      );

      const sub = await this.swPush.requestSubscription({ serverPublicKey: key });

      await firstValueFrom(this.http.post('/api/push/subscribe', sub));
    } catch {
      // Permiso denegado o SW no disponible — silencioso
    }
  }

  private waitForSW(): Promise<void> {
    return new Promise((resolve) => {
      if (navigator.serviceWorker?.controller) {
        resolve();
        return;
      }
      const handler = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', handler);
        resolve();
      };
      navigator.serviceWorker.addEventListener('controllerchange', handler);
      // Timeout de seguridad
      setTimeout(resolve, 5000);
    });
  }
}
