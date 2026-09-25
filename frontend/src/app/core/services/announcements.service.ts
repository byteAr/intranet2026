import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export interface Announcement {
  message: string;
  senderName: string;
  sentAt: string;
}

@Injectable({ providedIn: 'root' })
export class AnnouncementsService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private socket: Socket | null = null;
  /** Solo para la animación de salida; el aviso no se oculta por sí solo. */
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  readonly current = signal<Announcement | null>(null);
  readonly fading = signal(false);

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
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
    this.current.set(data);
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
