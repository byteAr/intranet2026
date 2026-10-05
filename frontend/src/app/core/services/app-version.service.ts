import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

/** Cada cuánto se consulta si hay una versión nueva publicada. */
const INTERVALO_MS = 2 * 60 * 1000;
/** Sin tocar nada durante este tiempo, se considera un momento seguro. */
const INACTIVO_MS = 3 * 60 * 1000;
/** Si en este tiempo no hubo un momento seguro, se avisa (con botón). */
const AVISO_TRAS_MS = 60 * 60 * 1000;
/** Campos con foco que no son "estar escribiendo". */
const NO_ES_TEXTO = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'search']);

/**
 * Actualiza la intranet sola cuando se publica una versión nueva, sin que
 * nadie tenga que recargar.
 *
 * nginx sirve `index.html` con `no-store` y un ETag propio de cada build, así
 * que basta con comparar ese ETag con el que había al abrir la app. Cuando
 * cambia, la recarga se aplica en el primer momento seguro:
 *   - la pestaña pasa a segundo plano;
 *   - el usuario cambia de sección (ya es un cambio de pantalla);
 *   - lleva 3 minutos sin tocar nada.
 * Nunca mientras hay trabajo en curso: un formulario abierto, una subida, o
 * el cursor en un campo con texto. Cada pantalla avisa lo suyo con
 * `holdWhile()`. Solo si pasa una hora sin un momento seguro aparece un aviso.
 */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private readonly router = inject(Router);
  private readonly swUpdate = inject(SwUpdate);

  private versionInicial: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendienteDesde = 0;
  private ultimaActividad = Date.now();
  private recargando = false;
  /** Motivos activos para no recargar (MTO abierto, subida en curso…). */
  private readonly holds = new Set<string>();
  private holdSeq = 0;

  readonly actualizacionPendiente = signal(false);
  /** El aviso con botón: solo si la actualización lleva mucho esperando. */
  readonly mostrarAviso = signal(false);

  async iniciar(): Promise<void> {
    if (this.timer) return;

    this.versionInicial = await this.leerVersion();
    // Sin una referencia inicial no hay con qué comparar; no tiene sentido sondear.
    if (!this.versionInicial) return;

    this.timer = setInterval(() => {
      void this.verificar();
      this.revisarInactividad();
    }, INTERVALO_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.aplicarSiEsSeguro();
      else void this.verificar();
    });

    // Cambió de sección: la pantalla ya cambia, una recarga ahí no se nota.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => void this.aplicarSiEsSeguro());

    const actividad = () => (this.ultimaActividad = Date.now());
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      document.addEventListener(ev, actividad, { passive: true, capture: true });
    }
    setInterval(() => this.revisarInactividad(), 30_000);
  }

  /**
   * Mientras `active()` sea verdadero no se recarga (formulario abierto,
   * subida en curso…). Se llama desde el constructor de una pantalla; al
   * destruirse la pantalla se libera solo.
   */
  holdWhile(motivo: string, active: () => boolean): void {
    const id = `${motivo}#${++this.holdSeq}`;
    effect(() => {
      if (active()) this.holds.add(id);
      else this.holds.delete(id);
    });
    inject(DestroyRef).onDestroy(() => this.holds.delete(id));
  }

  /** Aplica la actualización ahora (botón del aviso). */
  actualizarAhora(): void {
    void this.recargar();
  }

  private revisarInactividad(): void {
    if (!this.actualizacionPendiente()) return;
    if (Date.now() - this.ultimaActividad >= INACTIVO_MS) void this.aplicarSiEsSeguro();
    if (Date.now() - this.pendienteDesde >= AVISO_TRAS_MS) this.mostrarAviso.set(true);
  }

  private async verificar(): Promise<void> {
    if (this.actualizacionPendiente()) return;

    const actual = await this.leerVersion();
    if (!actual || actual === this.versionInicial) return;

    this.actualizacionPendiente.set(true);
    this.pendienteDesde = Date.now();
    if (document.hidden) void this.aplicarSiEsSeguro();
  }

  /** Sin trabajo en curso ni texto a medio escribir. */
  private esSeguro(): boolean {
    if (this.holds.size) return false;
    const el = document.activeElement as HTMLElement | null;
    if (el?.isContentEditable) return false;
    if (el instanceof HTMLTextAreaElement) return !el.value;
    if (el instanceof HTMLInputElement && !NO_ES_TEXTO.has(el.type)) return !el.value;
    return true;
  }

  private async aplicarSiEsSeguro(): Promise<void> {
    if (!this.actualizacionPendiente() || !this.esSeguro()) return;
    await this.recargar();
  }

  /**
   * Antes de recargar se activa la versión nueva en el service worker: si no,
   * la recarga podría servir la versión vieja guardada en caché.
   */
  private async recargar(): Promise<void> {
    if (this.recargando) return;
    this.recargando = true;
    try {
      if (this.swUpdate.isEnabled && (await this.swUpdate.checkForUpdate())) {
        await this.swUpdate.activateUpdate();
      }
    } catch {
      // Sin service worker o sin red: la recarga igual pide la versión nueva.
    }
    location.reload();
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
