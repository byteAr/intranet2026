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
  status: 'pendiente_ayudantia' | 'pendiente_ticom' | 'confirmada' | 'rechazada' | 'cancelada';
  // Ayudantia approval
  ayudantiaApprovedById?: string;
  ayudantiaApprovedByName?: string;
  ayudantiaApprovedByGroup?: string;
  ayudantiaApprovedAt?: string;
  // Rejection
  rejectionReason?: string;
  rejectedById?: string;
  rejectedByName?: string;
  rejectedByGroup?: string;
  rejectedAt?: string;
  // TICOM confirmation
  ticomConfirmedById?: string;
  ticomConfirmedByName?: string;
  ticomConfirmedAt?: string;
  // Creator self-cancellation
  creatorCancelledAt?: string;
  // TICOM cancellation (definitive)
  ticomCancellationReason?: string;
  ticomCancelledById?: string;
  ticomCancelledByName?: string;
  ticomCancelledAt?: string;
  // Block cancellation
  blockCancellationReason?: string;
  blockCancelledById?: string;
  blockCancelledByName?: string;
  blockCancelledByGroup?: string;
  blockCancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BlockedPeriod {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  location: 'piso_8' | 'piso_6';
  reason: string;
  createdById: string;
  createdByName: string;
  createdByGroup: string;
  createdAt: string;
}

export interface CreateBlockedPeriodDto {
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
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

  get isAyudantiaDiredtos(): boolean {
    const roles = this.authService.currentUser()?.roles ?? [];
    // Backward compat: old generic 'AYUDANTIA' role maps to piso_8 (AYUDANTIADIREDTOS behavior)
    return roles.includes('AYUDANTIADIREDTOS') || roles.includes('AYUDANTIA');
  }

  get isAyudantiaRectorado(): boolean {
    return this.authService.currentUser()?.roles?.includes('AYUDANTIARECTORADO') ?? false;
  }

  get isAyudantia(): boolean {
    return this.isAyudantiaDiredtos || this.isAyudantiaRectorado;
  }

  /** True if user has a privileged view (TICOM or any AYUDANTIA group) */
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
      this.recalcPendingCount();
      if (this.hasPrivilegedView && reservation.creatorId !== this.authService.currentUser()?.id) {
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

  /** Creator edits a rejected reservation */
  updateReservation(id: string, dto: CreateReservationDto): Observable<Reservation> {
    return this.http.patch<Reservation>(`/api/reservations/${id}`, dto);
  }

  /** Returns active reservations for a given date (excluded rejected) */
  checkAvailability(date: string): Observable<Reservation[]> {
    return this.http.get<Reservation[]>(`/api/reservations/availability?date=${date}`);
  }

  /** AYUDANTIADIREDTOS or AYUDANTIARECTORADO approves a reservation */
  approveReservation(id: string): Observable<Reservation> {
    return this.http.patch<Reservation>(`/api/reservations/${id}/approve`, {});
  }

  /** AYUDANTIADIREDTOS or AYUDANTIARECTORADO rejects a reservation */
  rejectReservation(id: string, reason: string): Observable<Reservation> {
    return this.http.patch<Reservation>(`/api/reservations/${id}/reject`, { reason });
  }

  /** TICOM confirms a reservation already approved by AYUDANTIA */
  confirmReservation(id: string): Observable<Reservation> {
    return this.http.patch<Reservation>(`/api/reservations/${id}/confirm`, {});
  }

  /** Creator cancels their own reservation */
  cancelReservation(id: string): Observable<Reservation> {
    return this.http.patch<Reservation>(`/api/reservations/${id}/cancel`, {});
  }

  /** TICOM definitively cancels a reservation (technical impossibility) */
  ticomCancelReservation(id: string, reason: string): Observable<Reservation> {
    return this.http.patch<Reservation>(`/api/reservations/${id}/ticom-cancel`, { reason });
  }

  getBlockedPeriods(location?: string, date?: string): Observable<BlockedPeriod[]> {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (location) params.set('location', location);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<BlockedPeriod[]>(`/api/reservations/blocked-periods${qs}`);
  }

  createBlockedPeriod(dto: CreateBlockedPeriodDto): Observable<{ blockedPeriod: BlockedPeriod; cancelledCount: number }> {
    return this.http.post<{ blockedPeriod: BlockedPeriod; cancelledCount: number }>('/api/reservations/blocked-periods', dto);
  }

  deleteBlockedPeriod(id: string): Observable<void> {
    return this.http.delete<void>(`/api/reservations/blocked-periods/${id}`);
  }

  private recalcPendingCount(): void {
    const list = this.reservations();
    if (this.isTicom) {
      this.pendingCount.set(list.filter((r) => r.status === 'pendiente_ticom').length);
    } else if (this.isAyudantiaDiredtos) {
      this.pendingCount.set(list.filter((r) => r.status === 'pendiente_ayudantia' && r.location === 'piso_8').length);
    } else if (this.isAyudantiaRectorado) {
      this.pendingCount.set(list.filter((r) => r.status === 'pendiente_ayudantia' && r.location === 'piso_6').length);
    } else {
      // Regular users: count rejected reservations that need editing
      this.pendingCount.set(list.filter((r) => r.status === 'rechazada').length);
    }
  }

  private playNotificationSound(): void {
    if (this.notificationSound) {
      this.notificationSound.currentTime = 0;
      this.notificationSound.play().catch(() => {});
    }
  }
}
