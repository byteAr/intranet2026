import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SituationType {
  id: number;
  code: string;
  label: string;
  isSystem: boolean;
  requiresDateRange: boolean;
  requiresFromDateOnly: boolean;
  requiresAuthorizationInfo: boolean;
  isAbsent: boolean;
  isEffective: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface DailyReportEntry {
  id?: number;
  username: string;
  fullName: string;
  rank: string;
  rankCategory: string;
  situationTypeCode: string;
  situationFromDate?: string | null;
  situationToDate?: string | null;
  authorizedBy?: string | null;
  authorizedDays?: number | null;
  authorizedChargedToLao?: boolean;
  shiftType?: string | null;
  notes?: string | null;
  sortOrder?: number;
  // enriched on dashboard
  officeGroup?: string;
  daysInSituation?: number | null;
}

export interface DailyReport {
  id: number;
  officeGroup: string;
  reportDate: string;
  createdBy: string;
  isLocked: boolean;
  entries: DailyReportEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ActiveSituation {
  id: number;
  username: string;
  officeGroup: string;
  situationTypeCode: string;
  fromDate: string;
  toDate: string | null;
  authorizedBy: string | null;
  authorizedDays: number | null;
  authorizedChargedToLao: boolean;
  shiftType: string | null;
  notes: string | null;
}

export interface CountdownInfo {
  today: string;
  isNonWorkingDay: boolean;
  isAfterDeadline: boolean;
  remainingMinutes: number;
}

export interface DashboardResult {
  date: string;
  entries: DailyReportEntry[];
  byOffice: Record<string, { total: number; present: number; absent: number; effective: number }>;
  grandTotal: { total: number; present: number; absent: number; effective: number };
  offices: { officeGroup: string; hasReport: boolean; reportId: number; isLocked: boolean }[];
}

@Injectable({ providedIn: 'root' })
export class DailyReportService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/daily-report';

  // ─── Countdown ────────────────────────────────────────────────────────────

  getCountdown(): Observable<CountdownInfo> {
    return this.http.get<CountdownInfo>(`${this.base}/countdown`);
  }

  // ─── Situation types ──────────────────────────────────────────────────────

  getSituationTypes(): Observable<SituationType[]> {
    return this.http.get<SituationType[]>(`${this.base}/situation-types`);
  }

  createSituationType(dto: Partial<SituationType>): Observable<SituationType> {
    return this.http.post<SituationType>(`${this.base}/situation-types`, dto);
  }

  deleteSituationType(id: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.base}/situation-types/${id}`);
  }

  // ─── Non-working days ─────────────────────────────────────────────────────

  getNonWorkingDays(year: number): Observable<{ id: number; date: string; reason: string }[]> {
    return this.http.get<any[]>(`${this.base}/non-working-days`, { params: { year: year.toString() } });
  }

  // ─── Office members ───────────────────────────────────────────────────────

  getOfficeMembers(officeGroup: string): Observable<{ username: string; fullName: string; rank: string; rankCategory: string; sortOrder: number }[]> {
    return this.http.get<any[]>(`${this.base}/office-members`, { params: { officeGroup } });
  }

  // ─── Active situations ────────────────────────────────────────────────────

  getActiveSituations(officeGroup: string): Observable<ActiveSituation[]> {
    return this.http.get<ActiveSituation[]>(`${this.base}/active-situations`, { params: { officeGroup } });
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  listReports(officeGroup: string): Observable<DailyReport[]> {
    return this.http.get<DailyReport[]>(`${this.base}/reports`, { params: { officeGroup } });
  }

  getReport(id: number): Observable<DailyReport> {
    return this.http.get<DailyReport>(`${this.base}/reports/${id}`);
  }

  getReportByDate(officeGroup: string, date: string): Observable<DailyReport | null> {
    return this.http.get<DailyReport | null>(`${this.base}/reports/by-date`, { params: { officeGroup, date } });
  }

  createReport(dto: { officeGroup: string; reportDate: string; entries: DailyReportEntry[] }): Observable<DailyReport> {
    return this.http.post<DailyReport>(`${this.base}/reports`, dto);
  }

  updateReport(id: number, dto: { officeGroup: string; reportDate: string; entries: DailyReportEntry[] }): Observable<DailyReport> {
    return this.http.put<DailyReport>(`${this.base}/reports/${id}`, dto);
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  getDashboard(filters: {
    officeGroup?: string;
    situationTypeCode?: string;
    username?: string;
    date?: string;
    rankCategory?: string;
  }): Observable<DashboardResult> {
    let params = new HttpParams();
    if (filters.officeGroup) params = params.set('officeGroup', filters.officeGroup);
    if (filters.situationTypeCode) params = params.set('situationTypeCode', filters.situationTypeCode);
    if (filters.username) params = params.set('username', filters.username);
    if (filters.date) params = params.set('date', filters.date);
    if (filters.rankCategory) params = params.set('rankCategory', filters.rankCategory);
    return this.http.get<DashboardResult>(`${this.base}/dashboard`, { params });
  }
}
