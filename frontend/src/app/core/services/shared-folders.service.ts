import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SharedFile {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  isGoogleDoc: boolean;
  downloadable: boolean;
  previewable: boolean;
  /** Para editarlo en Documentos/Hojas/Presentaciones de Google; null si no aplica. */
  googleUrl: string | null;
  size: number | null;
  modifiedTime: string | null;
  modifiedBy: string | null;
}

export interface OfficesInfo {
  configured: boolean;
  offices: string[];
  /** Cuenta @iugna.edu.ar del usuario; sin ella no puede abrir en Google. */
  googleEmail: string | null;
}

export interface FolderListing {
  folder: { id: string; name: string };
  /** Raíz del ámbito: la unidad de la oficina o lo compartido. */
  rootId: string;
  canWrite: boolean;
  files: SharedFile[];
  /** Con withPath: carpetas desde la raíz (excluida) hasta la pedida. */
  path?: { id: string; name: string }[];
}

/** Espacio de una oficina. */
export interface OfficeUsage {
  groupName: string;
  quotaBytes: number;
  /** Papelera de Drive incluida, como lo cuenta Google. */
  usedBytes: number;
  trashedBytes: number;
  /** Integrantes habilitados del grupo en el AD (base del espacio automático). */
  memberCount: number;
  /** De dónde sale el espacio. */
  quotaRule: 'manual' | 'per-member' | 'minimum' | 'maximum';
  gbPerMember: number;
  /** El espacio lo fijó TICOM a mano. */
  manualQuota: boolean;
  /** La oficina ya abrió Archivos compartidos (tiene su unidad en Drive). */
  opened: boolean;
  updatedAt: string | null;
}

export type ShareRole = 'reader' | 'writer';

/** Algo compartido con el usuario. */
export interface SharedWithMe {
  shareId: string;
  role: ShareRole;
  groupName: string;
  sharedByName: string;
  sharedAt: string;
  isNew: boolean;
  file: SharedFile;
}

/** Con quién está compartido un archivo o carpeta de la oficina. */
export interface ShareEntry {
  id: string;
  username: string;
  name: string;
  role: ShareRole;
  sharedByName: string;
  createdAt: string;
  /** Sin cuenta @iugna.edu.ar no puede editar en Documentos de Google. */
  googleAccount: boolean;
}

/**
 * Dónde se opera: la unidad de una oficina o algo compartido con el usuario.
 * El backend expone las mismas rutas en los dos casos; solo cambia el prefijo.
 */
export type FolderScope = { kind: 'office'; office: string } | { kind: 'share'; shareId: string };

@Injectable({ providedIn: 'root' })
export class SharedFoldersService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/shared-folders';

  /** Para el badge de "Compartidos conmigo" y del menú. */
  readonly unseenShares = signal(0);
  readonly totalShares = signal(0);

  private prefix(scope: FolderScope): string {
    return scope.kind === 'office'
      ? `${this.base}/${encodeURIComponent(scope.office)}`
      : `${this.base}/shares/${encodeURIComponent(scope.shareId)}`;
  }

  private fileUrl(scope: FolderScope, fileId: string): string {
    return `${this.prefix(scope)}/files/${encodeURIComponent(fileId)}`;
  }

  offices(): Observable<OfficesInfo> {
    return this.http.get<OfficesInfo>(`${this.base}/offices`);
  }

  /** Espacio usado y disponible de las oficinas del usuario. */
  usage(fresh = false): Observable<OfficeUsage[]> {
    return this.http.get<OfficeUsage[]>(`${this.base}/usage`, { params: fresh ? { fresh: '1' } : {} });
  }

  /** Espacio de todas las oficinas (solo TICOM). */
  allUsage(): Observable<OfficeUsage[]> {
    return this.http.get<OfficeUsage[]>(`${this.base}/usage/all`);
  }

  /** TICOM fija el espacio de una oficina; null vuelve al automático por integrantes. */
  setQuota(groupName: string, gb: number | null): Observable<OfficeUsage> {
    return this.http.patch<OfficeUsage>(`${this.base}/usage/${encodeURIComponent(groupName)}`, { gb });
  }

  // ─── Archivos ───────────────────────────────────────────────────────────────

  list(scope: FolderScope, folderId?: string, withPath = false): Observable<FolderListing> {
    const params: Record<string, string> = folderId ? { folderId } : {};
    if (withPath) params['path'] = '1';
    return this.http.get<FolderListing>(`${this.prefix(scope)}/files`, { params });
  }

  createFolder(scope: FolderScope, parentId: string, name: string): Observable<SharedFile> {
    return this.http.post<SharedFile>(`${this.prefix(scope)}/folders`, { parentId, name });
  }

  /** Sube con eventos de progreso. Con quiet no avisa a la oficina (subida en tandas). */
  upload(scope: FolderScope, folderId: string, files: File[], quiet = false): Observable<HttpEvent<SharedFile[]>> {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    const params: Record<string, string> = { folderId };
    if (quiet) params['quiet'] = '1';
    return this.http.post<SharedFile[]>(`${this.prefix(scope)}/upload`, fd, {
      params,
      reportProgress: true,
      observe: 'events',
    });
  }

  /** Archivo grande: la intranet abre la subida en Drive y devuelve a dónde mandarlo. */
  startDirectUpload(scope: FolderScope, folderId: string, file: File): Observable<{ uploadUrl: string }> {
    return this.http.post<{ uploadUrl: string }>(`${this.prefix(scope)}/upload-session`, {
      folderId,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
    });
  }

  /** Cierra la subida directa: registra el espacio y, sin quiet, avisa a la oficina. */
  finishDirectUpload(scope: FolderScope, fileId: string, quiet: boolean): Observable<SharedFile> {
    return this.http.post<SharedFile>(`${this.prefix(scope)}/upload-complete`, { fileId, quiet });
  }

  /** Cierra una subida en tandas: un único aviso con lo que quedó en `folderId`. */
  notifyUploaded(scope: FolderScope, folderId: string, itemIds: string[], fileCount: number): Observable<void> {
    return this.http.post<void>(`${this.prefix(scope)}/uploaded`, { folderId, itemIds, fileCount });
  }

  rename(scope: FolderScope, fileId: string, name: string): Observable<SharedFile> {
    return this.http.patch<SharedFile>(this.fileUrl(scope, fileId), { name });
  }

  trash(scope: FolderScope, fileId: string): Observable<void> {
    return this.http.delete<void>(this.fileUrl(scope, fileId));
  }

  /**
   * Enlace de descarga de un par de minutos, para que el navegador baje el
   * archivo por su cuenta (barra de descargas, sin ocupar la memoria de la
   * página). Una carpeta baja entera, en .zip.
   */
  downloadLink(scope: FolderScope, fileId: string): Observable<{ url: string }> {
    return this.http.post<{ url: string }>(`${this.fileUrl(scope, fileId)}/download-link`, {});
  }

  /** URL para el visor de adjuntos (lo pide como blob con la sesión). */
  previewUrl(scope: FolderScope, fileId: string): string {
    return `${this.fileUrl(scope, fileId)}/preview`;
  }

  /** URL de descarga, para el botón del visor. */
  downloadUrl(scope: FolderScope, fileId: string): string {
    return `${this.fileUrl(scope, fileId)}/download`;
  }

  // ─── Compartir ──────────────────────────────────────────────────────────────

  sharedWithMe(): Observable<SharedWithMe[]> {
    return this.http.get<SharedWithMe[]>(`${this.base}/shares`);
  }

  refreshCounts(): void {
    this.http.get<{ total: number; unseen: number }>(`${this.base}/shares/count`).subscribe({
      next: (c) => {
        this.totalShares.set(c.total);
        this.unseenShares.set(c.unseen);
      },
      error: () => {
        /* sin carpetas configuradas o sin red: el badge queda como estaba */
      },
    });
  }

  markSeen(): void {
    this.unseenShares.set(0);
    this.http.post<void>(`${this.base}/shares/seen`, {}).subscribe({ error: () => this.refreshCounts() });
  }

  listShares(office: string, fileId: string): Observable<ShareEntry[]> {
    return this.http.get<ShareEntry[]>(`${this.fileUrl({ kind: 'office', office }, fileId)}/shares`);
  }

  share(office: string, fileId: string, body: { username: string; name: string; role: ShareRole }): Observable<ShareEntry[]> {
    return this.http.post<ShareEntry[]>(`${this.fileUrl({ kind: 'office', office }, fileId)}/shares`, body);
  }

  unshare(office: string, shareId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${encodeURIComponent(office)}/shares/${encodeURIComponent(shareId)}`);
  }

  sync(): Observable<{ groupName: string; lastSyncAt: string | null; lastSyncError: string | null }[]> {
    return this.http.post<{ groupName: string; lastSyncAt: string | null; lastSyncError: string | null }[]>(
      `${this.base}/sync`,
      {},
    );
  }
}
