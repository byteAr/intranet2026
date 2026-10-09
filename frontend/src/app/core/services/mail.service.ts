import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, Subject, tap } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export type MailFolder = 'informativos' | 'ejecutivos' | 'redgen' | 'tx';

/** MTO por pedido; la lista trae la siguiente tanda al llegar al final (scroll infinito). */
const PAGE_SIZE = 30;

export interface SienaFile {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
  uploadedByName: string;
}

export interface MailAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  hasDecrypted?: boolean;
  /**
   * Solo para TICOM y ENCRIPTADO, en adjuntos .~NN: lo que subió TICOM ya
   * desencriptado. Puede ser más de uno (un .rar encriptado trae varios documentos).
   */
  decryptedFiles?: DecryptedFile[];
}

export interface DecryptedFile {
  id: string;
  /** Como lo subió TICOM (a veces el nombre corto de DOS: CONTRO~1.DOC). */
  filename: string;
  /** El nombre real, sacado del cuerpo del MTO ("CONTROL09" (DOCX) → CONTROL09.docx). */
  displayName?: string;
  size: number;
  uploadedByName: string;
  uploadedAt: string;
}

/** Alguien que abrió el MTO (fila "Visto por"). */
export interface MtoViewer {
  userId: string;
  username: string;
  name: string;
  /** Si tiene foto: está en /api/users/:id/avatar. */
  hasAvatar: boolean;
  readAt: string;
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
  sienaFiles?: SienaFile[];
  /**
   * Solo en resultados de búsqueda: fragmento del cuerpo con las coincidencias
   * delimitadas por U+0002 (inicio) y U+0003 (fin).
   */
  snippet?: string;
  /** Banderita (solo llega a TICOM): quién la puso y cuándo. */
  flag?: MailFlag | null;
  /** El usuario sigue este MTO (megáfono): le avisan los que lo citan. Solo en el detalle. */
  following?: boolean;
}

export interface MailFlag {
  byName: string;
  at: string;
}

/** Un término de "Mis alertas": avisa cuando llega un MTO que lo contiene. */
export interface AlertTerm {
  id: string;
  term: string;
  /** true: todas las palabras en cualquier orden; false: la frase tal cual. */
  allWords: boolean;
  createdAt: string;
}

/** Un MTO que el usuario sigue. */
export interface FollowedMto {
  emailId: string;
  mailCode: string | null;
  subject: string;
  date: string | null;
  /** false: se sumó solo porque citaba a uno que el usuario seguía. */
  manual: boolean;
  followedAt: string;
}

/** Búsqueda de una sola palabra que es un código (SNF) o una unidad (DIRTICOM): todos los de eso, por fecha. */
export interface MailSearchListing {
  word: string;
  /** Hay MTO con ese código (SNF 3411/26…). */
  code: boolean;
  /** Hay MTO que mandó esa casilla (DIRTICOM@MTO.GNA). */
  sender: boolean;
}

export interface EmailListResponse {
  data: Email[];
  total: number;
  page: number;
  limit: number;
  listing?: MailSearchListing;
}

export interface MailUnreadCounts {
  total: number;
  informativos: number;
  ejecutivos: number;
  redgen: number;
  tx: number;
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
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}

export interface MailRecipient {
  displayName: string;
  email: string;
  department?: string;
  title?: string;
}

@Injectable({ providedIn: 'root' })
export class MailService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private socket: Socket | null = null;

  readonly emails = signal<Email[]>([]);
  readonly totalEmails = signal(0);
  readonly unreadCount = signal(0);
  readonly unreadCounts = signal<MailUnreadCounts>({ total: 0, informativos: 0, ejecutivos: 0, redgen: 0, tx: 0 });
  readonly loading = signal(false);
  readonly isSearchActive = signal(false);

  constructor() {
    this.authService.onBeforeLogout(() => this.disconnect());
  }

  get isTicom(): boolean {
    return this.authService.currentUser()?.roles?.includes('TICOM') ?? false;
  }

  get isEncriptado(): boolean {
    return this.authService.currentUser()?.roles?.includes('ENCRIPTADO') ?? false;
  }

  connect(): void {
    if (this.socket && !this.socket.connected) {
      this.socket.removeAllListeners();
      this.socket = null;
    }
    if (this.socket) return;
    this.socket = io('/mail', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    this.socket.on('new_email', (payload: Pick<Email, 'id' | 'subject' | 'fromAddress' | 'folder' | 'date' | 'mailCode'>) => {
      this.loadUnreadCounts();
      // Durante una búsqueda activa no contaminar la lista de resultados
      if (this.isSearchActive()) return;
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

    // Banderita puesta o sacada por alguien de TICOM (solo les llega a ellos).
    this.socket.on('mail_flag', (payload: { emailId: string; flag: MailFlag | null }) => {
      this.emails.update((list) => list.map((e) => (e.id === payload.emailId ? { ...e, flag: payload.flag } : e)));
      this.flagChanges.next(payload);
    });
  }

  /** Cambios de banderita en vivo (para el MTO abierto y la vista agrupada). */
  readonly flagChanges = new Subject<{ emailId: string; flag: MailFlag | null }>();

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.emails.set([]);
    this.totalEmails.set(0);
    this.unreadCount.set(0);
    this.unreadCounts.set({ total: 0, informativos: 0, ejecutivos: 0, redgen: 0, tx: 0 });
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  exitSearch(): void {
    this.isSearchActive.set(false);
  }

  loadEmails(
    folder?: MailFolder,
    page = 1,
    limit = PAGE_SIZE,
    historical = false,
    advanced?: { q?: string; dateFrom?: string; dateTo?: string; year?: number; unread?: boolean },
  ): void {
    let params = new HttpParams().set('limit', limit);
    if (advanced?.unread) params = params.set('unread', 'true');
    if (folder) params = params.set('folder', folder);
    if (historical) params = params.set('historical', 'true');
    if (advanced?.q?.trim()) params = params.set('q', advanced.q.trim());
    if (advanced?.dateFrom) params = params.set('dateFrom', advanced.dateFrom);
    if (advanced?.dateTo) params = params.set('dateTo', advanced.dateTo);
    if (advanced?.year) params = params.set('year', advanced.year);
    this.startList(params, page);
  }

  // ─── Lista con scroll infinito ─────────────────────────────────────────────

  /** Pedidos de la lista que se está mostrando (carpeta, búsqueda…), sin la página. */
  private listParams: HttpParams | null = null;
  /** Páginas ya traídas del servidor (las de PAGE_SIZE). */
  private loadedPages = 0;
  /** Cambia con cada lista nueva (otra carpeta, otra búsqueda): la vista vuelve arriba. */
  readonly listVersion = signal(0);
  /** Trayendo la página siguiente al llegar al final de la lista. */
  readonly loadingMore = signal(false);
  /** Quedan MTO por traer en el servidor. */
  readonly hasMore = signal(false);

  private startList(params: HttpParams, pages = 1): void {
    this.listParams = params;
    this.loadedPages = 0;
    this.loading.set(true);
    this.loadingMore.set(false);
    this.listVersion.update((v) => v + 1);
    const version = this.listVersion();
    // Si se pide más de una página de una vez (volver a la misma lista), se trae todo junto.
    const limit = Number(params.get('limit') ?? PAGE_SIZE) * Math.max(1, pages);
    this.http.get<EmailListResponse>('/api/mail/emails', { params: params.set('page', 1).set('limit', limit) }).subscribe({
      next: (res) => {
        if (version !== this.listVersion()) return;
        this.emails.set(res.data);
        this.totalEmails.set(res.total);
        this.searchListing.set(res.listing ?? null);
        this.loadedPages = Math.max(1, pages);
        this.hasMore.set(res.data.length < res.total);
        this.loading.set(false);
      },
      error: () => {
        if (version === this.listVersion()) this.loading.set(false);
      },
    });
  }

  /** La página siguiente de la misma lista, al final (sin repetir los que ya están). */
  loadMore(): void {
    if (!this.listParams || this.loading() || this.loadingMore() || !this.hasMore()) return;
    const version = this.listVersion();
    const limit = Number(this.listParams.get('limit') ?? PAGE_SIZE);
    const page = this.loadedPages + 1;
    this.loadingMore.set(true);
    this.http.get<EmailListResponse>('/api/mail/emails', { params: this.listParams.set('page', page) }).subscribe({
      next: (res) => {
        if (version !== this.listVersion()) return;
        this.loadedPages = page;
        this.emails.update((list) => {
          const seen = new Set(list.map((e) => e.id));
          return [...list, ...res.data.filter((e) => !seen.has(e.id))];
        });
        this.totalEmails.set(res.total);
        this.hasMore.set(page * limit < res.total && res.data.length > 0);
        this.loadingMore.set(false);
      },
      error: () => {
        if (version === this.listVersion()) this.loadingMore.set(false);
      },
    });
  }

  /** Qué está mostrando la búsqueda si es "todos los de un código o una unidad". */
  readonly searchListing = signal<MailSearchListing | null>(null);

  getGroupedBySender(folder?: MailFolder, historical = false): Observable<{ sender: string; count: number; lastDate: string }[]> {
    let params = new HttpParams();
    if (folder) params = params.set('folder', folder);
    if (historical) params = params.set('historical', 'true');
    return this.http.get<{ sender: string; count: number; lastDate: string }[]>('/api/mail/emails/grouped-by-sender', { params });
  }

  loadEmailsBySender(sender: string, folder?: MailFolder, page = 1, historical = false): Observable<EmailListResponse> {
    let params = new HttpParams().set('sender', sender).set('page', page).set('limit', 30);
    if (folder) params = params.set('folder', folder);
    if (historical) params = params.set('historical', 'true');
    return this.http.get<EmailListResponse>('/api/mail/emails', { params });
  }

  /** Todo lo que llegó hasta ahora pasa a leído (las 4 carpetas en cero) y se actualiza la lista. */
  markAllRead(): Observable<MailUnreadCounts> {
    return this.http.post<MailUnreadCounts>('/api/mail/mark-all-read', {}).pipe(
      tap((counts) => {
        this.unreadCounts.set(counts);
        this.emails.update((list) =>
          list.map((e) => (e.readStatuses?.[0]?.isRead ? e : { ...e, readStatuses: [{ isRead: true }] })),
        );
      }),
    );
  }

  setFlag(id: string): Observable<MailFlag | null> {
    return this.http.post<MailFlag | null>(`/api/mail/emails/${id}/flag`, {});
  }

  clearFlag(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/mail/emails/${id}/flag`);
  }

  // ─── Seguir un MTO y "Mis alertas" ─────────────────────────────────────────

  follow(id: string): Observable<{ following: boolean }> {
    return this.http.post<{ following: boolean }>(`/api/mail/emails/${id}/follow`, {});
  }

  unfollow(id: string): Observable<{ following: boolean }> {
    return this.http.delete<{ following: boolean }>(`/api/mail/emails/${id}/follow`);
  }

  /** Corre mis alertas contra un MTO ya guardado, como si acabara de llegar (manda el aviso de prueba). */
  testAlerts(id: string): Observable<{ reasons: string[]; matched: boolean; notified: boolean }> {
    return this.http.post<{ reasons: string[]; matched: boolean; notified: boolean }>(`/api/mail/emails/${id}/test-alerts`, {});
  }

  followedMtos(): Observable<FollowedMto[]> {
    return this.http.get<FollowedMto[]>('/api/mail/follows');
  }

  alertTerms(): Observable<AlertTerm[]> {
    return this.http.get<AlertTerm[]>('/api/mail/alert-terms');
  }

  addAlertTerm(term: string, allWords: boolean): Observable<AlertTerm> {
    return this.http.post<AlertTerm>('/api/mail/alert-terms', { term, allWords });
  }

  updateAlertTerm(id: string, term: string, allWords: boolean): Observable<AlertTerm> {
    return this.http.patch<AlertTerm>(`/api/mail/alert-terms/${id}`, { term, allWords });
  }

  removeAlertTerm(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/mail/alert-terms/${id}`);
  }

  loadUnreadCounts(): void {
    this.http.get<MailUnreadCounts>('/api/mail/unread-counts').subscribe({
      next: (counts) => {
        this.unreadCounts.set(counts);
        this.unreadCount.set(counts.total);
      },
      error: () => {},
    });
  }

  decrementUnread(folder: MailFolder): void {
    this.unreadCounts.update((c) => {
      const prev = c[folder];
      if (prev <= 0) return c;
      return { ...c, [folder]: prev - 1, total: Math.max(0, c.total - 1) };
    });
    this.unreadCount.update((n) => Math.max(0, n - 1));
  }

  search(q: string): void {
    if (!q.trim()) return;
    this.isSearchActive.set(true);
    this.emails.set([]);
    this.startList(new HttpParams().set('q', q.trim()).set('limit', PAGE_SIZE));
  }

  getEmail(id: string): Observable<Email> {
    return this.http.get<Email>(`/api/mail/emails/${id}`);
  }

  getTree(id: string): Observable<MailTreeNode[]> {
    return this.http.get<MailTreeNode[]>(`/api/mail/emails/${id}/tree`);
  }

  /** Quiénes abrieron el MTO y cuándo, del primero al último. */
  getViewers(id: string): Observable<MtoViewer[]> {
    return this.http.get<MtoViewer[]>(`/api/mail/emails/${id}/viewers`);
  }

  markRead(id: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`/api/mail/emails/${id}/read`, {});
  }

  sendEmail(dto: SendEmailDto, files: File[] = []): Observable<Email> {
    const fd = new FormData();
    dto.to.forEach((t) => fd.append('to', t));
    dto.cc?.forEach((c) => fd.append('cc', c));
    dto.bcc?.forEach((b) => fd.append('bcc', b));
    fd.append('subject', dto.subject);
    fd.append('bodyText', dto.bodyText);
    if (dto.bodyHtml) fd.append('bodyHtml', dto.bodyHtml);
    files.forEach((f) => fd.append('files', f, f.name));
    return this.http.post<Email>('/api/mail/emails/send', fd);
  }

  searchRecipients(q: string): Observable<MailRecipient[]> {
    return this.http.get<MailRecipient[]>('/api/mail/bridge/recipients', {
      params: new HttpParams().set('q', q),
    });
  }

  downloadAttachment(emailId: string, attachmentId: string, filename: string): void {
    this.http
      .get(`/api/mail/emails/${emailId}/attachments/${attachmentId}`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        error: () => {
          console.error(`No se pudo descargar el adjunto: ${filename}`);
        },
      });
  }

  /** Sube uno o varios desencriptados de un adjunto .~NN (se suman a los que ya hay). */
  uploadDecrypted(emailId: string, attachmentId: string, files: File[]): Observable<DecryptedFile[]> {
    const fd = new FormData();
    for (const file of files) fd.append('files', file, file.name);
    return this.http.post<DecryptedFile[]>(
      `/api/mail/emails/${emailId}/attachments/${attachmentId}/decrypted`,
      fd,
    );
  }

  deleteDecrypted(emailId: string, attachmentId: string, decryptedId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/mail/emails/${emailId}/attachments/${attachmentId}/decrypted/${decryptedId}`);
  }

  /** Sube uno o varios archivos SIENA (se suman a los que ya hay). */
  uploadSienaFiles(emailId: string, files: File[]): Observable<SienaFile[]> {
    const fd = new FormData();
    for (const file of files) fd.append('files', file, file.name);
    return this.http.post<SienaFile[]>(`/api/mail/emails/${emailId}/siena-files`, fd);
  }

  downloadSienaFile(emailId: string, fileId: string, filename: string): void {
    this.http
      .get(`/api/mail/emails/${emailId}/siena-files/${fileId}`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        error: () => console.error('No se pudo descargar el archivo SIENA'),
      });
  }

  deleteSienaFile(emailId: string, fileId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/mail/emails/${emailId}/siena-files/${fileId}`);
  }

}
