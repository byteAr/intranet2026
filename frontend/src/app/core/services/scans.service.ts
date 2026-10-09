import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { SharedFile } from './shared-folders.service';

/** Un escaneo de una impresora en la bandeja de la oficina (se guarda en la VM, no en Drive). */
export interface ScanItem {
  id: string;
  groupName: string;
  filename: string;
  contentType: string;
  size: number;
  receivedAt: string;
  /** Cuándo se borra solo (90 días). */
  expiresAt: string;
}

/** Una bandeja que el usuario puede ver. */
export interface ScanOffice {
  groupName: string;
  /** Solo las oficinas tienen unidad en Archivos; los grupos especiales guardan en Mis archivos. */
  hasDrive: boolean;
}

/** Acceso de una oficina a la bandeja, para cargarlo en las impresoras (solo TICOM). */
export interface ScanAccount {
  groupName: string;
  configured: boolean;
  username: string | null;
  password: string | null;
  networkPath: string | null;
  ftpHost: string;
  lastScanAt: string | null;
  scanCount: number;
}

@Injectable({ providedIn: 'root' })
export class ScansService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = '/api/scans';

  get isTicom(): boolean {
    return this.auth.currentUser()?.roles?.some((r) => r.toUpperCase() === 'TICOM') ?? false;
  }

  private office(group: string): string {
    return `${this.base}/${encodeURIComponent(group)}`;
  }

  /** Las bandejas del usuario: sus oficinas y grupos especiales (AYUDANTIA); hasDrive = tiene unidad en Archivos. */
  mine(): Observable<ScanOffice[]> {
    return this.http.get<ScanOffice[]>(`${this.base}/mine`);
  }

  list(group: string): Observable<ScanItem[]> {
    return this.http.get<ScanItem[]>(this.office(group));
  }

  fileUrl(scan: ScanItem): string {
    return `${this.office(scan.groupName)}/${scan.id}/file`;
  }

  /** Lo baja con el JWT (no sirve un <a href> directo) y lo guarda con su nombre. */
  download(scan: ScanItem): void {
    this.http.get(`${this.fileUrl(scan)}?download=1`, { responseType: 'blob' }).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = scan.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  rename(scan: ScanItem, name: string): Observable<ScanItem> {
    return this.http.patch<ScanItem>(`${this.office(scan.groupName)}/${scan.id}`, { name });
  }

  remove(scan: ScanItem): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.office(scan.groupName)}/${scan.id}`);
  }

  /** Copia en Archivos: la unidad de la oficina o Mis archivos. */
  saveToDrive(scan: ScanItem, target: 'office' | 'personal'): Observable<{ target: string; file: SharedFile | null }> {
    return this.http.post<{ target: string; file: SharedFile | null }>(`${this.office(scan.groupName)}/${scan.id}/save`, { target });
  }

  accounts(): Observable<ScanAccount[]> {
    return this.http.get<ScanAccount[]>(`${this.base}/admin/accounts`);
  }

  /** Crea el acceso de la oficina o le genera una contraseña nueva. */
  createAccount(group: string): Observable<ScanAccount> {
    return this.http.post<ScanAccount>(`${this.base}/admin/accounts/${encodeURIComponent(group)}`, {});
  }
}
