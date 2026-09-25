import { Injectable, signal } from '@angular/core';

/** Cada cuánto se consulta si hay una versión nueva publicada. */
const INTERVALO_MS = 2 * 60 * 1000;

/**
 * Detecta cuándo se desplegó una versión nueva del frontend y recarga sola.
 *
 * nginx sirve `index.html` con `no-store` y un ETag propio de cada build
 * (ver frontend/nginx.conf), así que basta con comparar ese ETag contra el
 * que había al abrir la aplicación: si cambió, hay una versión nueva.
 *
 * La recarga se hace cuando la app pasa a segundo plano. Recargar mientras
 * alguien redacta un MTO o un correo le haría perder lo que está escribiendo,
 * así que en ese caso solo se marca `actualizacionPendiente` y el layout
 * ofrece un botón para aplicarla cuando el usuario quiera.
 */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private versionInicial: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly actualizacionPendiente = signal(false);

  async iniciar(): Promise<void> {
    if (this.timer) return;

    this.versionInicial = await this.leerVersion();
    // Sin una referencia inicial no hay con qué comparar; no tiene sentido sondear.
    if (!this.versionInicial) return;

    this.timer = setInterval(() => void this.verificar(), INTERVALO_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Momento seguro: el usuario está en otra ventana.
        if (this.actualizacionPendiente()) location.reload();
      } else {
        void this.verificar();
      }
    });
  }

  /** Aplica la actualización ahora (botón del aviso). */
  actualizarAhora(): void {
    location.reload();
  }

  private async verificar(): Promise<void> {
    if (this.actualizacionPendiente()) return;

    const actual = await this.leerVersion();
    if (!actual || actual === this.versionInicial) return;

    this.actualizacionPendiente.set(true);
    if (document.hidden) location.reload();
  }

  private async leerVersion(): Promise<string | null> {
    try {
      const res = await fetch('/index.html', { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) return null;
      return res.headers.get('etag') ?? res.headers.get('last-modified');
    } catch {
      // Backend o red caídos: se reintenta en el ciclo siguiente.
      return null;
    }
  }
}
