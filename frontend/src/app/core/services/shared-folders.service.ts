import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SharedFile {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  isGoogleDoc: boolean;
  downloadable: boolean;
  size: number | null;
  modifiedTime: string | null;
  modifiedBy: string | null;
  webViewLink: string | null;
}

export interface OfficesInfo {
  configured: boolean;
  hasGoogleAccount: boolean;
  offices: string[];
}

export interface FolderListing {
  driveId: string;
  folder: { id: string; name: string };
  files: SharedFile[];
}

@Injectable({ providedIn: 'root' })
export class SharedFoldersService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/shared-folders';

  private office(office: string): string {
    return `${this.base}/${encodeURIComponent(office)}`;
  }

  offices(): Observable<OfficesInfo> {
    return this.http.get<OfficesInfo>(`${this.base}/offices`);
  }

  list(office: string, folderId?: string): Observable<FolderListing> {
    const params: Record<string, string> = folderId ? { folderId } : {};
    return this.http.get<FolderListing>(`${this.office(office)}/files`, { params });
  }

  createFolder(office: string, parentId: string, name: string): Observable<SharedFile> {
    return this.http.post<SharedFile>(`${this.office(office)}/folders`, { parentId, name });
  }

  /** Sube con eventos de progreso. */
  upload(office: string, folderId: string, files: File[]): Observable<HttpEvent<SharedFile[]>> {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    return this.http.post<SharedFile[]>(`${this.office(office)}/upload`, fd, {
      params: { folderId },
      reportProgress: true,
      observe: 'events',
    });
  }

  rename(office: string, fileId: string, name: string): Observable<SharedFile> {
    return this.http.patch<SharedFile>(`${this.office(office)}/files/${encodeURIComponent(fileId)}`, { name });
  }

  trash(office: string, fileId: string): Observable<void> {
    return this.http.delete<void>(`${this.office(office)}/files/${encodeURIComponent(fileId)}`);
  }

  /** Descarga vía blob con la sesión (nunca un <a href> directo a la API). */
  download(office: string, fileId: string): Observable<HttpEvent<Blob>> {
    return this.http.get(`${this.office(office)}/files/${encodeURIComponent(fileId)}/download`, {
      responseType: 'blob',
      reportProgress: true,
      observe: 'events',
    });
  }

  sync(): Observable<{ groupName: string; lastSyncAt: string | null; lastSyncError: string | null }[]> {
    return this.http.post<{ groupName: string; lastSyncAt: string | null; lastSyncError: string | null }[]>(
      `${this.base}/sync`,
      {},
    );
  }
}
