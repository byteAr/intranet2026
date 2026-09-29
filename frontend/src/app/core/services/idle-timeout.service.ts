import { Injectable, NgZone, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ACTIVITY_KEY, AuthService, USER_KEY } from './auth.service';

/** Duración de la cuenta regresiva previa al cierre. */
export const IDLE_WARNING_SECONDS = 15;

const DEFAULT_IDLE_MINUTES = 30;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];
/** La actividad se guarda como mucho una vez por segundo: mousemove dispara cientos. */
const WRITE_THROTTLE_MS = 1000;

/**
 * Cierra la sesión tras SESSION_IDLE_MINUTES sin actividad (lo informa el
 * backend; 30 por defecto), con un aviso de 15 segundos antes.
 *
 * La última actividad vive en localStorage, compartida por todas las pestañas:
 * trabajar en una mantiene vivas las demás, y todas cierran juntas. Se compara
 * contra el reloj en cada tick (no con un setTimeout largo) porque el navegador
 * frena los timers de las pestañas en segundo plano y de la PC suspendida.
 */
@Injectable({ providedIn: 'root' })
export class IdleTimeoutService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly zone = inject(NgZone);

  private idleMs = DEFAULT_IDLE_MINUTES * 60_000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWrite = 0;
  private running = false;

  /** Segundos que faltan mientras se muestra el aviso; null si no hay aviso. */
  readonly secondsLeft = signal<number | null>(null);

  constructor() {
    this.authService.onBeforeLogout(() => this.stop());
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const cfg = await firstValueFrom(
        this.http.get<{ idleMinutes: number }>('/api/auth/session-config'),
      );
      if (cfg?.idleMinutes >= 1) this.idleMs = cfg.idleMinutes * 60_000;
    } catch {
      // Sin respuesta del backend se usa el valor por defecto.
    }
    if (!this.running) return; // se cerró la sesión mientras esperaba

    // La cookie dura 8 h: quien cierra el navegador sin salir y lo reabre
    // después del límite no debe encontrar la sesión abierta.
    const last = this.readLastActivity();
    if (last !== null && Date.now() - last >= this.idleMs) {
      this.expire();
      return;
    }
    this.recordActivity(true);

    this.zone.runOutsideAngular(() => {
      for (const ev of ACTIVITY_EVENTS) {
        window.addEventListener(ev, this.onActivity, { passive: true, capture: true });
      }
      window.addEventListener('storage', this.onStorage);
      document.addEventListener('visibilitychange', this.tick);
      this.timer = setInterval(this.tick, 1000);
    });
  }

  /** Botón "Seguir conectado". */
  keepAlive(): void {
    this.recordActivity(true);
    this.secondsLeft.set(null);
  }

  private stop(): void {
    this.running = false;
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, this.onActivity, { capture: true });
    }
    window.removeEventListener('storage', this.onStorage);
    document.removeEventListener('visibilitychange', this.tick);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.secondsLeft.set(null);
  }

  private expire(): void {
    this.zone.run(() => this.authService.logout('idle'));
  }

  private readonly onActivity = (): void => {
    // Con el aviso en pantalla, mover el mouse no alcanza: hay que confirmar
    // con el botón que hay alguien frente a la PC.
    if (this.secondsLeft() !== null) return;
    this.recordActivity(false);
  };

  private readonly tick = (): void => {
    if (!this.running) return;
    const last = this.readLastActivity() ?? Date.now();
    const remaining = last + this.idleMs - Date.now();
    if (remaining <= 0) {
      this.expire();
      return;
    }
    const secs = remaining <= IDLE_WARNING_SECONDS * 1000 ? Math.ceil(remaining / 1000) : null;
    if (secs !== this.secondsLeft()) this.zone.run(() => this.secondsLeft.set(secs));
  };

  /** Otra pestaña cerró la sesión (por inactividad o a mano): esta la sigue. */
  private readonly onStorage = (e: StorageEvent): void => {
    if (e.key !== USER_KEY || e.newValue !== null || !this.running) return;
    const last = this.readLastActivity() ?? Date.now();
    const porInactividad = Date.now() - last >= this.idleMs - 2000;
    this.zone.run(() => this.authService.clearSession(porInactividad ? 'idle' : undefined));
  };

  private recordActivity(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastWrite < WRITE_THROTTLE_MS) return;
    this.lastWrite = now;
    try {
      localStorage.setItem(ACTIVITY_KEY, String(now));
    } catch {
      // Sin localStorage cada pestaña queda por su cuenta; el tick igual cierra.
    }
  }

  private readLastActivity(): number | null {
    try {
      const v = Number(localStorage.getItem(ACTIVITY_KEY));
      return v > 0 ? v : null;
    } catch {
      return this.lastWrite || null;
    }
  }
}
