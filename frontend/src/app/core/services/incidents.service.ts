import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export interface Incident {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAvatar?: string;
  description: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  attachmentMimeType?: string;
  status: 'pendiente' | 'en_proceso' | 'en_espera' | 'no_resuelta' | 'finalizada';
  technicianId?: string;
  technicianName?: string;
  assignedAt?: string;
  resolution?: string;
  resolvedAt?: string;
  waitingReason?: string;
  waitingSince?: string;
  unresolvedReason?: string;
  unresolvedAt?: string;
  unresolvedById?: string;
  unresolvedByName?: string;
  history: IncidentEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface IncidentEvent {
  type: 'creada' | 'tomada' | 'en_espera' | 'reactivada' | 'finalizada' | 'sin_solucion';
  at: string;
  byName?: string;
  detail?: string;
}

@Injectable({ providedIn: 'root' })
export class IncidentsService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private socket: Socket | null = null;
  private notificationSound: HTMLAudioElement | null = null;

  readonly incidents = signal<Incident[]>([]);
  readonly pendingCount = signal(0);

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
    // Pre-load notification sound
    try {
      this.notificationSound = new Audio('/assets/sounds/incident-alert.wav');
      this.notificationSound.volume = 0.5;
    } catch { /* ignore if audio not available */ }
  }

  get isTicom(): boolean {
    return this.authService.currentUser()?.roles?.includes('TICOM') ?? false;
  }

  connect(): void {
    if (this.socket && !this.socket.connected) {
      this.socket.removeAllListeners();
      this.socket = null;
    }
    if (this.socket) return;
    const token = this.authService.getToken();
    if (!token) return;

    this.socket = io('/incidents', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('incident:new', (incident: Incident) => {
      this.incidents.update((list) => {
        // Avoid duplicates
        if (list.some((i) => i.id === incident.id)) return list;
        return [incident, ...list];
      });
      // Play sound for TICOM members
      if (this.isTicom && incident.creatorId !== this.authService.currentUser()?.id) {
        this.pendingCount.update((n) => n + 1);
        this.playNotificationSound();
      }
    });

    this.socket.on('incident:updated', (incident: Incident) => {
      this.incidents.update((list) =>
        list.map((i) => (i.id === incident.id ? incident : i)),
      );
      this.recalcPendingCount();
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.incidents.set([]);
    this.pendingCount.set(0);
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  loadIncidents(mine?: boolean): void {
    const params = mine ? '?mine=true' : '';
    this.http.get<Incident[]>(`/api/incidents${params}`).subscribe({
      next: (list) => {
        this.incidents.set(list);
        this.recalcPendingCount();
      },
    });
  }

  createIncident(description: string, file?: File): Observable<Incident> {
    const form = new FormData();
    form.append('description', description);
    if (file) form.append('file', file);
    return this.http.post<Incident>('/api/incidents', form);
  }

  assignIncident(id: string): Observable<Incident> {
    return this.http.patch<Incident>(`/api/incidents/${id}/assign`, {});
  }

  resolveIncident(id: string, resolution: string): Observable<Incident> {
    return this.http.patch<Incident>(`/api/incidents/${id}/resolve`, { resolution });
  }

  holdIncident(id: string, waitingReason: string): Observable<Incident> {
    return this.http.patch<Incident>(`/api/incidents/${id}/hold`, { waitingReason });
  }

  reactivateIncident(id: string): Observable<Incident> {
    return this.http.patch<Incident>(`/api/incidents/${id}/reactivate`, {});
  }

  closeUnresolvedIncident(id: string, unresolvedReason: string): Observable<Incident> {
    return this.http.patch<Incident>(`/api/incidents/${id}/close-unresolved`, { unresolvedReason });
  }

  private recalcPendingCount(): void {
    const count = this.incidents().filter((i) => i.status === 'pendiente').length;
    this.pendingCount.set(count);
  }

  private playNotificationSound(): void {
    if (this.notificationSound) {
      this.notificationSound.currentTime = 0;
      this.notificationSound.play().catch(() => {});
    }
  }
}
