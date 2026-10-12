import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { AppNotification, NotificationsService } from './notifications.service';

export interface Announcement {
  message: string;
  senderName: string;
  sentAt: string;
  /** La notificación de la campanita: al cerrar el cartel queda leída. */
  notificationId?: string;
}

@Injectable({ providedIn: 'root' })
export class AnnouncementsService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationsService);
  private socket: Socket | null = null;
  /** Solo para la animación de salida; el aviso no se oculta por sí solo. */
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  readonly current = signal<Announcement | null>(null);
  readonly fading = signal(false);

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
    // Quien no estaba conectado cuando se mandó: el cartel aparece al entrar
    // (anuncio sin leer de los últimos días), hasta que lo cierre.
    this.notifications.pendingAnnouncement.subscribe((n) => this.showAnnouncement(this.fromNotification(n)));
    // En vivo llega dos veces (por /announcements y por la campanita): de la
    // campanita sale el id, para marcarlo leído al cerrar el cartel.
    this.notifications.incoming.subscribe((n) => {
      if (n.type !== 'announcement') return;
      const cur = this.current();
      const data = this.fromNotification(n);
      if (!cur || cur.message === data.message) this.showAnnouncement(data);
    });
  }

  private fromNotification(n: AppNotification): Announcement {
    const d = n.data as Partial<Announcement>;
    return {
      message: d.message ?? n.body,
      senderName: d.senderName ?? '',
      sentAt: d.sentAt ?? n.createdAt,
      notificationId: n.id,
    };
  }

  connect(): void {
    if (this.socket?.connected) return;
    this.socket = io('/announcements', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    this.socket.on('announcement', (data: Announcement) => {
      this.showAnnouncement(data);
    });
    // El servidor solo corta este socket cuando vence el JWT; como este
    // namespace está abierto en todas las pantallas, sirve de aviso de que
    // la sesión terminó aunque el usuario no haga ninguna petición HTTP.
    this.socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') this.authService.clearSession('session_expired');
    });
  }

  /**
   * El aviso queda visible hasta que el usuario lo cierra con la X. Son
   * comunicados de servicio (cortes programados, mantenimiento): si se
   * ocultaran solos, quien no estuviera mirando la pantalla en ese momento
   * nunca se enteraría.
   */
  private showAnnouncement(data: Announcement): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.fading.set(false);
    // Si ya se está mostrando el mismo, solo se suma el id (llega primero sin él)
    const cur = this.current();
    this.current.set(cur && cur.message === data.message ? { ...cur, ...data, notificationId: data.notificationId ?? cur.notificationId } : data);
  }

  disconnect(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.socket?.disconnect();
    this.socket = null;
    this.current.set(null);
    this.fading.set(false);
  }

  dismiss(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    // Cerrado con la X: leído (no vuelve a salir al entrar, y baja el número de la campanita)
    const id = this.current()?.notificationId;
    if (id) this.notifications.markReadById(id);
    this.fading.set(true);
    this.hideTimer = setTimeout(() => {
      this.current.set(null);
      this.fading.set(false);
    }, 500);
  }

  send(message: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/announcements/broadcast', { message });
  }
}
