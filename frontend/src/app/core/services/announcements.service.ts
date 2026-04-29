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
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

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

  private showAnnouncement(data: Announcement): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.fading.set(false);
    this.current.set(data);
    this.fadeTimer = setTimeout(() => this.fading.set(true), 9500);
    this.dismissTimer = setTimeout(() => this.current.set(null), 10000);
  }

  disconnect(): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.socket?.disconnect();
    this.socket = null;
    this.current.set(null);
    this.fading.set(false);
  }

  dismiss(): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.fading.set(true);
    setTimeout(() => { this.current.set(null); this.fading.set(false); }, 500);
  }

  send(message: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/announcements/broadcast', { message });
  }
}
