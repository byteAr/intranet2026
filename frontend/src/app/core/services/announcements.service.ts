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

  readonly current = signal<Announcement | null>(null);

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
  }

  connect(): void {
    if (this.socket?.connected) return;
    const token = this.authService.getToken();
    if (!token) return;
    this.socket = io('/announcements', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    this.socket.on('announcement', (data: Announcement) => {
      this.current.set(data);
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.current.set(null);
  }

  dismiss(): void {
    this.current.set(null);
  }

  send(message: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/announcements/broadcast', { message });
  }
}
