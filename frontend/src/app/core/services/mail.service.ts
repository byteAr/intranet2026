import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export type MailFolder = 'informativos' | 'ejecutivos' | 'redgen' | 'tx';

export interface MailAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface MailReadStatus {
  isRead: boolean;
  readAt?: string;
}

export interface MailOutgoingRef {
  referencedCode: string;
  referencedEmailId: string | null;
}

export interface Email {
  id: string;
  internetMessageId: string;
  mailCode?: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  date: string;
  folder: MailFolder;
  isFromPstImport: boolean;
  createdAt: string;
  attachments?: MailAttachment[];
  attachmentCount?: number;
  readStatuses?: MailReadStatus[];
  outgoingRefs?: MailOutgoingRef[];
}

export interface EmailListResponse {
  data: Email[];
  total: number;
  page: number;
  limit: number;
}

export interface MailTreeNode {
  id: string;
  mail_code: string;
  subject: string;
  from_address: string;
  date: string;
  depth: number;
}

export interface SendEmailDto {
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}

@Injectable({ providedIn: 'root' })
export class MailService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private socket: Socket | null = null;

  readonly emails = signal<Email[]>([]);
  readonly totalEmails = signal(0);
  readonly unreadCount = signal(0);
  readonly loading = signal(false);

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
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

    this.socket = io('/mail', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('new_email', (payload: Pick<Email, 'id' | 'subject' | 'fromAddress' | 'folder' | 'date' | 'mailCode'>) => {
      // Add to list only if matches current folder (or always add and let component filter)
      this.unreadCount.update((n) => n + 1);
      // Prepend a minimal email entry so the list updates immediately
      const newEntry: Email = {
        id: payload.id,
        internetMessageId: '',
        mailCode: payload.mailCode,
        subject: payload.subject,
        fromAddress: payload.fromAddress,
        toAddresses: [],
        ccAddresses: [],
        date: payload.date,
        folder: payload.folder,
        isFromPstImport: false,
        createdAt: payload.date,
        readStatuses: [],
      };
      this.emails.update((list) => {
        if (list.some((e) => e.id === newEntry.id)) return list;
        return [newEntry, ...list];
      });
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.emails.set([]);
    this.totalEmails.set(0);
    this.unreadCount.set(0);
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  loadEmails(folder?: MailFolder, page = 1, limit = 30): void {
    this.loading.set(true);
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (folder) params = params.set('folder', folder);

    this.http.get<EmailListResponse>('/api/mail/emails', { params }).subscribe({
      next: (res) => {
        this.emails.set(res.data);
        this.totalEmails.set(res.total);
        this.recalcUnread();
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  search(q: string): void {
    if (!q.trim()) return;
    this.loading.set(true);
    this.http
      .get<EmailListResponse>('/api/mail/emails', {
        params: new HttpParams().set('q', q).set('limit', 50),
      })
      .subscribe({
        next: (res) => {
          this.emails.set(res.data);
          this.totalEmails.set(res.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  getEmail(id: string): Observable<Email> {
    return this.http.get<Email>(`/api/mail/emails/${id}`);
  }

  getTree(id: string): Observable<MailTreeNode[]> {
    return this.http.get<MailTreeNode[]>(`/api/mail/emails/${id}/tree`);
  }

  markRead(id: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`/api/mail/emails/${id}/read`, {});
  }

  sendEmail(dto: SendEmailDto, files: File[] = []): Observable<Email> {
    const fd = new FormData();
    dto.to.forEach((t) => fd.append('to', t));
    dto.cc?.forEach((c) => fd.append('cc', c));
    fd.append('subject', dto.subject);
    fd.append('bodyText', dto.bodyText);
    if (dto.bodyHtml) fd.append('bodyHtml', dto.bodyHtml);
    files.forEach((f) => fd.append('files', f, f.name));
    return this.http.post<Email>('/api/mail/emails/send', fd);
  }

  downloadAttachment(emailId: string, attachmentId: string, filename: string): void {
    this.http
      .get(`/api/mail/emails/${emailId}/attachments/${attachmentId}`, { responseType: 'blob' })
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  private recalcUnread(): void {
    const count = this.emails().filter((e) => {
      const rs = e.readStatuses;
      return !rs || rs.length === 0 || !rs[0].isRead;
    }).length;
    this.unreadCount.set(count);
  }
}
