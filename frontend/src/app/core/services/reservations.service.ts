import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export interface Reservation {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAvatar?: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  location: 'piso_8' | 'piso_6';
  equipmentType: 'notebook' | 'equipo_completo';
  conferenceUrl?: string;
  status: 'pendiente' | 'recibida';
  technicianId?: string;
  technicianName?: string;
  acknowledgedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReservationDto {
  date: string;
  startTime: string;
  durationHours: number;
  location: 'piso_8' | 'piso_6';
  equipmentType: 'notebook' | 'equipo_completo';
  conferenceUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class ReservationsService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private socket: Socket | null = null;
  private notificationSound: HTMLAudioElement | null = null;

  readonly reservations = signal<Reservation[]>([]);
  readonly pendingCount = signal(0);

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
    try {
      this.notificationSound = new Audio('/assets/sounds/incident-alert.wav');
      this.notificationSound.volume = 0.5;
    } catch { /* ignore */ }
  }

  get isTicom(): boolean {
    return this.authService.currentUser()?.roles?.includes('TICOM') ?? false;
  }

  get isAyudantia(): boolean {
    return this.authService.currentUser()?.roles?.includes('AYUDANTIA') ?? false;
  }

  /** True if user has a privileged view (TICOM or AYUDANTIA) */
  get hasPrivilegedView(): boolean {
    return this.isTicom || this.isAyudantia;
  }

  connect(): void {
    if (this.socket && !this.socket.connected) {
      this.socket.removeAllListeners();
      this.socket = null;
    }
    if (this.socket) return;
    const token = this.authService.getToken();
    if (!token) return;

    this.socket = io('/reservations', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('reservation:new', (reservation: Reservation) => {
      this.reservations.update((list) => {
        if (list.some((r) => r.id === reservation.id)) return list;
        return [reservation, ...list];
      });
      if (this.hasPrivilegedView && reservation.creatorId !== this.authService.currentUser()?.id) {
        this.pendingCount.update((n) => n + 1);
        this.playNotificationSound();
      }
    });

    this.socket.on('reservation:updated', (reservation: Reservation) => {
      this.reservations.update((list) =>
        list.map((r) => (r.id === reservation.id ? reservation : r)),
      );
      this.recalcPendingCount();
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.reservations.set([]);
    this.pendingCount.set(0);
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  loadReservations(mine?: boolean): void {
    const params = mine ? '?mine=true' : '';
    this.http.get<Reservation[]>(`/api/reservations${params}`).subscribe({
      next: (list) => {
        this.reservations.set(list);
        this.recalcPendingCount();
      },
    });
  }

  createReservation(dto: CreateReservationDto): Observable<Reservation> {
    return this.http.post<Reservation>('/api/reservations', dto);
  }

  /** Returns all reservations for a given date (equipment is shared) */
  checkAvailability(date: string): Observable<Reservation[]> {
    return this.http.get<Reservation[]>(`/api/reservations/availability?date=${date}`);
  }

  acknowledgeReservation(id: string): Observable<Reservation> {
    return this.http.patch<Reservation>(`/api/reservations/${id}/acknowledge`, {});
  }

  private recalcPendingCount(): void {
    this.pendingCount.set(this.reservations().filter((r) => r.status === 'pendiente').length);
  }

  private playNotificationSound(): void {
    if (this.notificationSound) {
      this.notificationSound.currentTime = 0;
      this.notificationSound.play().catch(() => {});
    }
  }
}
