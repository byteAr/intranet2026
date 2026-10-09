import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

/** mto: un MTO seguido (megáfono) o que coincide con "Mis alertas". */
export type NotificationType = 'announcement' | 'share' | 'upload' | 'scan' | 'mto';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

/** Datos de un anuncio, para mostrarlo en el modal. */
export interface AnnouncementData {
  message: string;
  senderName: string;
  sentAt: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly base = '/api/notifications';
  private socket: Socket | null = null;
  private audio: AudioContext | null = null;

  readonly items = signal<AppNotification[]>([]);
  readonly unread = signal(0);
  /** Se incrementa con cada notificación nueva: la campanita se sacude. */
  readonly ring = signal(0);
  /** Anuncio abierto en el modal (desde la campanita o desde una push). */
  readonly openAnnouncement = signal<AnnouncementData | null>(null);
  /** Cada notificación que llega en vivo (Archivos la usa para mostrar subidas sin recargar). */
  readonly incoming = new Subject<AppNotification>();
  /**
   * Avisos en vivo que no pasan por la campanita (no se guardan ni suenan): para
   * que una pantalla abierta se actualice sola. 'scan_arrived' {groupName, scanId}
   * y 'drive_uploaded' {groupName, folderId, files}.
   */
  readonly signals = new Subject<{ event: string; data: Record<string, unknown> }>();

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
  }

  connect(): void {
    if (this.socket?.connected) return;
    this.load();
    this.socket = io('/notifications', { withCredentials: true, transports: ['websocket', 'polling'] });
    this.socket.on('notification', (n: AppNotification) => {
      this.items.update((list) => [n, ...list.filter((x) => x.id !== n.id)].slice(0, 50));
      this.unread.update((u) => u + 1);
      this.ring.update((r) => r + 1);
      this.chime();
      this.incoming.next(n);
    });
    for (const event of ['scan_arrived', 'drive_uploaded']) {
      this.socket.on(event, (data: Record<string, unknown>) => this.signals.next({ event, data: data ?? {} }));
    }
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.items.set([]);
    this.unread.set(0);
    this.openAnnouncement.set(null);
  }

  load(): void {
    this.http.get<{ items: AppNotification[]; unread: number }>(this.base).subscribe({
      next: (res) => {
        this.items.set(res.items);
        this.unread.set(res.unread);
      },
      error: () => {
        /* sin red: la campanita queda como estaba */
      },
    });
  }

  markRead(n: AppNotification): void {
    if (n.read) return;
    this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    this.unread.update((u) => Math.max(0, u - 1));
    this.http.post<void>(`${this.base}/${n.id}/read`, {}).subscribe({ error: () => this.load() });
  }

  markAllRead(): void {
    this.items.update((list) => list.map((x) => ({ ...x, read: true })));
    this.unread.set(0);
    this.http.post<void>(`${this.base}/read-all`, {}).subscribe({ error: () => this.load() });
  }

  showAnnouncement(n: AppNotification): void {
    const d = n.data as Partial<AnnouncementData>;
    this.openAnnouncement.set({
      message: d.message ?? n.body,
      senderName: d.senderName ?? '',
      sentAt: d.sentAt ?? n.createdAt,
    });
  }

  /**
   * Abre una notificación que llegó por la URL (al tocar una push): la marca
   * como leída y, si es un anuncio, lo muestra.
   */
  openById(id: string): void {
    this.http.get<AppNotification>(`${this.base}/${encodeURIComponent(id)}`).subscribe({
      next: (n) => {
        this.markRead(n);
        if (n.type === 'announcement') this.showAnnouncement(n);
      },
      error: () => {
        /* ya no existe o es de otro usuario */
      },
    });
  }

  /**
   * "Ding" de dos notas generado con Web Audio, sin archivos de sonido. Si el
   * navegador todavía no permite audio (nadie tocó la página), no suena.
   */
  private chime(): void {
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      void ctx.resume();
      const now = ctx.currentTime;
      const notes: [number, number][] = [[880, 0], [1318.5, 0.13]]; // La5 y Mi6
      for (const [freq, at] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + at);
        gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + at);
        osc.stop(now + at + 1);
      }
    } catch {
      /* sin Web Audio: solo se ve la notificación */
    }
  }
}
