import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export type DraftStatus = 'draft' | 'needs_correction' | 'approved' | 'sent' | 'cancelled';

export interface DraftHistoryEntry {
  type: string;
  at: string;
  byId: string;
  byName: string;
  detail?: string;
  changes?: {
    bodyBefore?: string;
    bodyAfter?: string;
    toAdded?: string[];
    toRemoved?: string[];
    ccAdded?: string[];
    ccRemoved?: string[];
    subjectBefore?: string;
    subjectAfter?: string;
  };
}

export interface DraftAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface DraftEmail {
  id: string;
  hash: string | null;
  creatorId: string;
  creatorName: string;
  creatorUsername: string;
  subject: string;
  bodyText: string;
  toAddresses: string[];
  ccAddresses: string[];
  status: DraftStatus;
  sendMode: string;
  requiresEncryption: boolean;
  encryptionManualOverride: boolean;
  approvedById: string | null;
  approvedByName: string | null;
  approvedByRank: string | null;
  approvedAt: string | null;
  correctionNotes: string | null;
  mailCode: string | null;
  hashEnteredAt: string | null;
  sentById: string | null;
  sentByName: string | null;
  sentAt: string | null;
  cancelledById: string | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  history: DraftHistoryEntry[];
  attachments: DraftAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface DraftMailSigner {
  id: string;
  displayName: string;
  rank: string;
  setById: string;
  setByName: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class DraftMailService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private socket: Socket | null = null;

  readonly approvedCount = signal(0);
  readonly draftStatusChanged$ = new Subject<{ id: string; event: string }>();

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
  }

  connect(): void {
    if (this.socket) return;
    this.socket = io('/draft-mail', { withCredentials: true, transports: ['websocket', 'polling'] });

    this.socket.on('draft_ready_to_send', (p: { id: string }) => {
      this.loadApprovedCount();
      this.draftStatusChanged$.next({ id: p.id, event: 'draft_ready_to_send' });
    });
    this.socket.on('draft_rejected', (p: { id: string }) => {
      this.draftStatusChanged$.next({ id: p.id, event: 'draft_rejected' });
    });
    this.socket.on('draft_sent', (p: { id: string }) => {
      this.loadApprovedCount();
      this.draftStatusChanged$.next({ id: p.id, event: 'draft_sent' });
    });
    this.socket.on('draft_cancelled', (p: { id: string }) => {
      this.draftStatusChanged$.next({ id: p.id, event: 'draft_cancelled' });
    });
    this.socket.on('draft_status_changed', (p: { id: string }) => {
      this.draftStatusChanged$.next({ id: p.id, event: 'draft_status_changed' });
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.approvedCount.set(0);
  }

  loadApprovedCount(): void {
    this.http.get<{ count: number }>('/api/draft-mail/approved-count').subscribe({
      next: (r) => this.approvedCount.set(r.count),
      error: () => {},
    });
  }

  getAll(): Observable<DraftEmail[]> {
    return this.http.get<DraftEmail[]>('/api/draft-mail');
  }

  getOne(id: string): Observable<DraftEmail> {
    return this.http.get<DraftEmail>(`/api/draft-mail/${id}`);
  }

  getApproved(): Observable<DraftEmail[]> {
    return this.http.get<DraftEmail[]>('/api/draft-mail/para-enviar');
  }

  getByHash(hash: string): Observable<DraftEmail> {
    return this.http.get<DraftEmail>(`/api/draft-mail/hash/${hash}`);
  }

  getNextMailCode(): Observable<{ code: string }> {
    return this.http.get<{ code: string }>('/api/draft-mail/next-mailcode');
  }

  create(formData: FormData): Observable<DraftEmail> {
    return this.http.post<DraftEmail>('/api/draft-mail', formData);
  }

  update(id: string, dto: { subject?: string; bodyText?: string; toAddresses?: string[]; ccAddresses?: string[]; sendMode?: string }): Observable<DraftEmail> {
    return this.http.patch<DraftEmail>(`/api/draft-mail/${id}`, dto);
  }

  confirmDraft(id: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/confirm`, {});
  }

  cancel(id: string, notes: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/cancel`, { notes });
  }

  ticomCancel(id: string, notes: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/ticom-cancel`, { notes });
  }

  toggleEncryption(id: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/toggle-encryption`, {});
  }

  enterHash(id: string, hash: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/enter-hash`, { hash });
  }

  send(id: string, hash: string, mailCode: string, fdoTimestamp: string, subject?: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/send`, { hash, mailCode, fdoTimestamp, subject });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/draft-mail/${id}`);
  }

  getAttachmentUrl(draftId: string, attId: string): string {
    return `/api/draft-mail/${draftId}/attachments/${attId}`;
  }

  downloadAttachment(draftId: string, attId: string): Observable<Blob> {
    return this.http.get(`/api/draft-mail/${draftId}/attachments/${attId}`, { responseType: 'blob' });
  }

  previewAttachment(draftId: string, attId: string): Observable<Blob> {
    return this.http.get(`/api/draft-mail/${draftId}/attachments/${attId}/preview`, { responseType: 'blob' });
  }

  deleteAttachment(draftId: string, attId: string): Observable<DraftEmail> {
    return this.http.delete<DraftEmail>(`/api/draft-mail/${draftId}/attachments/${attId}`);
  }

  addAttachments(draftId: string, files: File[]): Observable<DraftEmail> {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f, f.name));
    return this.http.post<DraftEmail>(`/api/draft-mail/${draftId}/attachments`, fd);
  }

  getBodyReferences(id: string): Observable<{ referencedCode: string; referencedEmailId: string | null }[]> {
    return this.http.get<{ referencedCode: string; referencedEmailId: string | null }[]>(`/api/draft-mail/${id}/references`);
  }

  // Signer (firmante) management
  getSigner(): Observable<DraftMailSigner | null> {
    return this.http.get<DraftMailSigner | null>('/api/draft-mail/signer');
  }

  setSigner(displayName: string, rank: string): Observable<DraftMailSigner> {
    return this.http.post<DraftMailSigner>('/api/draft-mail/signer', { displayName, rank });
  }

  removeSigner(): Observable<void> {
    return this.http.delete<void>('/api/draft-mail/signer');
  }
}
