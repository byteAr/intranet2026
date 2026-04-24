import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export type DraftStatus = 'draft' | 'pending_review' | 'needs_correction' | 'approved' | 'sent' | 'cancelled';

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
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
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

export interface DraftMailAuthorizer {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  addedById: string;
  addedByName: string;
  createdAt: string;
}

export interface DraftMailDirector {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  setById: string;
  setByName: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class DraftMailService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private socket: Socket | null = null;

  readonly pendingCount = signal(0);
  readonly approvedCount = signal(0);
  readonly isAuthorizerSignal = signal(false);
  readonly draftStatusChanged$ = new Subject<{ id: string; event: string }>();

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
  }

  connect(): void {
    if (this.socket) return;
    const token = this.authService.getToken();
    if (!token) return;
    this.socket = io('/draft-mail', { auth: { token }, transports: ['websocket', 'polling'] });

    this.socket.on('draft_submitted', (p: { id: string }) => {
      this.loadPendingCount();
      this.draftStatusChanged$.next({ id: p.id, event: 'draft_submitted' });
    });
    this.socket.on('draft_approved', (p: { id: string; subject: string; hash: string }) => {
      this.loadApprovedCount();
      this.draftStatusChanged$.next({ id: p.id, event: 'draft_approved' });
    });
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
    this.pendingCount.set(0);
    this.approvedCount.set(0);
    this.isAuthorizerSignal.set(false);
  }

  loadIsAuthorizer(): void {
    this.http.get<{ value: boolean }>('/api/draft-mail/is-authorizer').subscribe({
      next: (r) => this.isAuthorizerSignal.set(r.value),
      error: () => {},
    });
  }

  loadPendingCount(): void {
    this.http.get<{ count: number }>('/api/draft-mail/pending-count').subscribe({
      next: (r) => this.pendingCount.set(r.count),
      error: () => {},
    });
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

  submit(id: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/submit`, {});
  }

  approve(id: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/approve`, {});
  }

  reject(id: string, notes: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/reject`, { notes });
  }

  cancel(id: string, notes: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/cancel`, { notes });
  }

  ticomCancel(id: string, notes: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/ticom-cancel`, { notes });
  }

  delegate(id: string, userId: string, username: string, displayName: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/delegate`, { userId, username, displayName });
  }

  toggleEncryption(id: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/toggle-encryption`, {});
  }

  enterHash(id: string, hash: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/enter-hash`, { hash });
  }

  send(id: string, hash: string, mailCode: string, subject?: string): Observable<DraftEmail> {
    return this.http.post<DraftEmail>(`/api/draft-mail/${id}/send`, { hash, mailCode, subject });
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

  // Director
  getDirector(): Observable<DraftMailDirector | null> {
    return this.http.get<DraftMailDirector | null>('/api/draft-mail/director');
  }

  setDirector(userId: string, username: string, displayName: string): Observable<DraftMailDirector> {
    return this.http.post<DraftMailDirector>('/api/draft-mail/director', { userId, username, displayName });
  }

  removeDirector(): Observable<void> {
    return this.http.delete<void>('/api/draft-mail/director');
  }

  // Authorizers
  getAuthorizers(): Observable<DraftMailAuthorizer[]> {
    return this.http.get<DraftMailAuthorizer[]>('/api/draft-mail/authorizers');
  }

  addAuthorizer(userId: string, username: string, displayName: string): Observable<DraftMailAuthorizer> {
    return this.http.post<DraftMailAuthorizer>('/api/draft-mail/authorizers', { userId, username, displayName });
  }

  removeAuthorizer(userId: string): Observable<void> {
    return this.http.delete<void>(`/api/draft-mail/authorizers/${userId}`);
  }
}
