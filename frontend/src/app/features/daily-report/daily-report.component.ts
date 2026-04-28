import {
  Component, inject, signal, computed, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  DailyReportService,
  SituationType,
  DailyReport,
  DailyReportEntry,
  ActiveSituation,
  DashboardResult,
  CountdownInfo,
} from '../../core/services/daily-report.service';
import { AuthService } from '../../core/services/auth.service';

// ─── Constants ───────────────────────────────────────────────────────────────

const RANK_ORDER: Record<string, number> = {
  'CTE GRL': 1, 'CTE MY': 2,
  'CTE PR': 10, 'CTE': 11,
  '2DO CTE': 20, '1ER ALF': 21, 'ALF': 22, 'SUBALF': 23,
  'SMY': 30, 'SPR': 31, 'SAY': 32, 'SRO': 33,
  'SARG': 40, 'CRO': 41, 'CBO': 42,
  'GEND': 50, 'GEND II': 51,
};
const RANK_CATEGORY_LABELS: Record<string, string> = {
  'of_sup': 'Oficiales Superiores', 'of_jef': 'Jefes', 'of_sub': 'Oficiales Subalternos',
  'subof_sup': 'Suboficiales Superiores', 'subof_sub': 'Suboficiales Subalternos',
  'tropa': 'Tropa', 'civil': 'Personal Civil',
};
const OFFICE_GROUPS = [
  'TICOM', 'CENEDIS', 'LEGAL Y TÉCNICA', 'AYUDANTIADIREDTOS',
  'AYUDANTIARECTORADO', 'DOCENTES', 'CURSOS', 'PERSONAL',
  'SAF', 'LOGISTICA', 'CAMAREROS', 'DESARROLLO',
];

function getRankSortOrder(rank: string): number {
  return RANK_ORDER[rank?.toUpperCase()] ?? 999;
}

interface OfficeMember {
  username: string;
  fullName: string;
  rank: string;
  rankCategory: string;
  sortOrder: number;
}

interface FormEntry extends DailyReportEntry {
  daysInSituation?: number | null;
}

@Component({
  selector: 'app-daily-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="space-y-6">

  <!-- Header -->
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">Parte Diario</h1>
      <p class="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
        @if (userOfficeGroup()) { Oficina: <span class="font-semibold">{{ userOfficeGroup() }}</span> }
        @if (isPersonal()) { <span class="text-purple-600 dark:text-purple-400 font-semibold">Panel PERSONAL</span> }
      </p>
    </div>

    <!-- Countdown -->
    @if (countdown()) {
      <div class="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium"
           [class]="countdownClass()">
        <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        @if (countdown()!.isNonWorkingDay) {
          <span>Día no laborable</span>
        } @else if (countdown()!.isAfterDeadline) {
          <span>Plazo vencido (07:45)</span>
        } @else {
          <span>Tiempo restante: {{ formatCountdown(countdown()!.remainingMinutes) }}</span>
        }
      </div>
    }
  </div>

  <!-- Tabs (PERSONAL only) -->
  @if (isPersonal()) {
    <div class="flex gap-1 bg-gray-100 dark:bg-zinc-800 rounded-xl p-1 w-fit">
      @for (tab of personalTabs; track tab.key) {
        <button (click)="activeView.set(tab.key)"
          class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
          [class]="activeView() === tab.key
            ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-zinc-100 shadow-sm'
            : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'">
          {{ tab.label }}
        </button>
      }
    </div>
  }

  <!-- ─── LIST VIEW ───────────────────────────────────────────────────────── -->
  @if (activeView() === 'list') {
    @if (loading()) {
      <div class="flex justify-center py-16">
        <svg class="animate-spin h-8 w-8 text-teal-600" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      </div>
    } @else {

      <!-- Status cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 flex items-center gap-3">
          <div class="h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0"
               [class]="todayReport() ? 'bg-green-100 dark:bg-green-900/30' : 'bg-amber-100 dark:bg-amber-900/30'">
            <svg class="h-5 w-5" [class]="todayReport() ? 'text-green-600' : 'text-amber-600'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              @if (todayReport()) {
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              } @else {
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              }
            </svg>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-zinc-400">Parte de hoy</p>
            <p class="text-sm font-semibold" [class]="todayReport() ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">
              {{ todayReport() ? 'Enviado' : 'Pendiente' }}
            </p>
          </div>
        </div>

        <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 flex items-center gap-3">
          <div class="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <svg class="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-zinc-400">Partes enviados</p>
            <p class="text-sm font-semibold text-gray-900 dark:text-zinc-100">{{ reports().length }}</p>
          </div>
        </div>

        <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
          @if (!todayReport() && !countdown()?.isAfterDeadline && !countdown()?.isNonWorkingDay) {
            <button (click)="startNewReport()"
              [disabled]="loadingMembers()"
              class="w-full py-2 px-4 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
              @if (loadingMembers()) {
                <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Cargando personal...
              } @else {
                + Confeccionar Parte de Hoy
              }
            </button>
          } @else if (todayReport() && !todayReport()!.isLocked) {
            <button (click)="editReport(todayReport()!)"
              [disabled]="loadingMembers()"
              class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
              Editar Parte de Hoy
            </button>
          } @else {
            <p class="text-sm text-gray-400 dark:text-zinc-500 text-center py-1">
              {{ todayReport()?.isLocked ? 'Parte bloqueado' : 'No disponible' }}
            </p>
          }
        </div>
      </div>

      <!-- Reports history -->
      <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-100 dark:border-zinc-700">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Historial de Partes</h2>
        </div>
        @if (reports().length === 0) {
          <div class="py-12 text-center text-sm text-gray-400 dark:text-zinc-500">
            No hay partes diarios confeccionados aún.
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 dark:bg-zinc-800 text-xs uppercase text-gray-500 dark:text-zinc-400">
                <tr>
                  <th class="px-4 py-3 text-left">Fecha</th>
                  <th class="px-4 py-3 text-left">Confeccionado por</th>
                  <th class="px-4 py-3 text-center">Personal</th>
                  <th class="px-4 py-3 text-center">Estado</th>
                  <th class="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-zinc-700/50">
                @for (r of reports(); track r.id) {
                  <tr class="hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td class="px-4 py-3 font-medium text-gray-900 dark:text-zinc-100">{{ formatDate(r.reportDate) }}</td>
                    <td class="px-4 py-3 text-gray-600 dark:text-zinc-300">{{ r.createdBy }}</td>
                    <td class="px-4 py-3 text-center text-gray-600 dark:text-zinc-300">{{ r.entries?.length ?? '–' }}</td>
                    <td class="px-4 py-3 text-center">
                      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                            [class]="r.isLocked ? 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'">
                        {{ r.isLocked ? 'Bloqueado' : 'Editable' }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-center">
                      <button (click)="viewReport(r)"
                        class="text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 text-xs font-medium">
                        Ver
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }
  }

  <!-- ─── FORM VIEW ───────────────────────────────────────────────────────── -->
  @if (activeView() === 'form') {
    <div class="space-y-4">

      <!-- Form header -->
      <div class="flex items-center gap-3">
        <button (click)="cancelForm()"
          class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 dark:text-zinc-400 transition-colors">
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-zinc-100">
            {{ editingReportId() ? 'Editar Parte' : 'Nuevo Parte Diario' }}
          </h2>
          <p class="text-sm text-gray-500 dark:text-zinc-400">
            {{ userOfficeGroup() }} · {{ formatDate(formDate()) }}
            <span class="ml-2 text-xs">({{ formEntries().length }} integrantes)</span>
          </p>
        </div>
      </div>

      <!-- Entries -->
      @if (formEntries().length === 0) {
        <div class="py-12 text-center text-sm text-gray-400 dark:text-zinc-500 bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700">
          No hay integrantes registrados en esta oficina. Contactá a TICOM.
        </div>
      } @else {
        <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-100 dark:border-zinc-700">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Personal de la oficina</h3>
          </div>
          <div class="divide-y divide-gray-100 dark:divide-zinc-700/50">
            @for (entry of formEntries(); track entry.username; let i = $index) {
              <div class="p-4 space-y-3">
                <!-- Person header -->
                <div class="flex items-center gap-3 flex-wrap">
                  <span class="text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase w-20 flex-shrink-0">{{ entry.rank }}</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-zinc-100 flex-1">{{ entry.fullName }}</span>
                  @if (entry.daysInSituation && entry.daysInSituation > 0 && entry.situationTypeCode !== 'PRESENTE') {
                    <span class="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full flex-shrink-0">
                      {{ entry.daysInSituation }} día{{ entry.daysInSituation !== 1 ? 's' : '' }} en situación
                    </span>
                  }
                </div>

                <!-- Situation selector -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Situación</label>
                    <select [(ngModel)]="entry.situationTypeCode"
                      (ngModelChange)="onSituationChange(entry, $event)"
                      class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100">
                      @for (st of activeSituationTypes(); track st.code) {
                        <option [value]="st.code">{{ st.label }}</option>
                      }
                    </select>
                  </div>

                  @if (entry.situationTypeCode === 'TURNO') {
                    <div>
                      <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Turno (opcional)</label>
                      <select [(ngModel)]="entry.shiftType"
                        class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100">
                        <option [value]="null">Sin especificar</option>
                        <option value="mañana">Turno Mañana</option>
                        <option value="tarde">Turno Tarde</option>
                      </select>
                    </div>
                  }
                </div>

                <!-- Date fields -->
                @if (getSituationType(entry.situationTypeCode); as st) {
                  @if (st.requiresDateRange) {
                    <div class="grid grid-cols-2 gap-3">
                      <div>
                        <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Desde</label>
                        <input type="date" [(ngModel)]="entry.situationFromDate"
                          class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100" />
                      </div>
                      <div>
                        <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Hasta</label>
                        <input type="date" [(ngModel)]="entry.situationToDate"
                          class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100" />
                      </div>
                    </div>
                  } @else if (st.requiresFromDateOnly) {
                    <div class="max-w-xs">
                      <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Desde</label>
                      <input type="date" [(ngModel)]="entry.situationFromDate"
                        class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100" />
                    </div>
                  }

                  @if (st.requiresAuthorizationInfo) {
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Autorizado por</label>
                        <input type="text" [(ngModel)]="entry.authorizedBy" placeholder="Nombre / Jerarquía"
                          class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100" />
                      </div>
                      <div>
                        <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Días</label>
                        <input type="number" min="1" [(ngModel)]="entry.authorizedDays"
                          class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100" />
                      </div>
                      <div class="flex items-end pb-2">
                        <label class="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-zinc-300">
                          <input type="checkbox" [(ngModel)]="entry.authorizedChargedToLao"
                            class="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                          A cuenta de LAO
                        </label>
                      </div>
                    </div>
                  }
                }

                <!-- Notes -->
                <div>
                  <input type="text" [(ngModel)]="entry.notes" placeholder="Observaciones (opcional)"
                    class="w-full rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/50 text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500" />
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Submit -->
        <div class="flex justify-end gap-3">
          <button (click)="cancelForm()"
            class="px-5 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
            Cancelar
          </button>
          <button (click)="submitReport()" [disabled]="saving()"
            class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 transition-colors">
            {{ saving() ? 'Guardando...' : (editingReportId() ? 'Actualizar Parte' : 'Enviar Parte') }}
          </button>
        </div>
      }
    </div>
  }

  <!-- ─── REPORT VIEW ────────────────────────────────────────────────────── -->
  @if (activeView() === 'view') {
    @if (viewingReport()) {
      <div class="space-y-4">
        <div class="flex items-center gap-3 flex-wrap">
          <button (click)="closeView()"
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 dark:text-zinc-400 transition-colors">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div class="flex-1">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-zinc-100">
              Parte Diario — {{ formatDate(viewingReport()!.reportDate) }}
            </h2>
            <p class="text-sm text-gray-500 dark:text-zinc-400">{{ viewingReport()!.officeGroup }}</p>
          </div>
          <button (click)="printReport(viewingReport()!)"
            class="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white text-sm font-medium rounded-lg transition-colors">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Imprimir
          </button>
        </div>

        <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 dark:bg-zinc-800 text-xs uppercase text-gray-500 dark:text-zinc-400">
                <tr>
                  <th class="px-4 py-3 text-left">Jerarquía</th>
                  <th class="px-4 py-3 text-left">Nombre y Apellido</th>
                  <th class="px-4 py-3 text-left">Situación</th>
                  <th class="px-4 py-3 text-left">Detalle</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-zinc-700/50">
                @for (e of viewingReport()!.entries; track e.id) {
                  <tr class="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                    <td class="px-4 py-3 font-mono text-xs font-bold text-gray-600 dark:text-zinc-300">{{ e.rank }}</td>
                    <td class="px-4 py-3 font-medium text-gray-900 dark:text-zinc-100">{{ e.fullName }}</td>
                    <td class="px-4 py-3">
                      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                            [class]="getSituationBadgeClass(e.situationTypeCode)">
                        {{ getSituationLabel(e.situationTypeCode) }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-xs text-gray-500 dark:text-zinc-400">{{ formatEntryDetail(e) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }
  }

  <!-- ─── DASHBOARD VIEW (PERSONAL) ─────────────────────────────────────── -->
  @if (activeView() === 'dashboard' && isPersonal()) {
    <div class="space-y-4">

      <!-- Filters -->
      <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-zinc-100 mb-3">Filtros</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Fecha</label>
            <input type="date" [(ngModel)]="dashboardDate" (ngModelChange)="loadDashboard()"
              class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Oficina</label>
            <select [(ngModel)]="dashboardOffice" (ngModelChange)="loadDashboard()"
              class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100">
              <option value="">Todas las oficinas</option>
              @for (g of officeGroups; track g) { <option [value]="g">{{ g }}</option> }
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Situación</label>
            <select [(ngModel)]="dashboardSituation" (ngModelChange)="loadDashboard()"
              class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100">
              <option value="">Todas</option>
              @for (st of situationTypes(); track st.code) { <option [value]="st.code">{{ st.label }}</option> }
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 dark:text-zinc-400 mb-1">Buscar persona</label>
            <input type="text" [(ngModel)]="dashboardSearch" (ngModelChange)="loadDashboard()"
              placeholder="Nombre o usuario..."
              class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-zinc-100" />
          </div>
        </div>
        <div class="mt-3 flex gap-2 flex-wrap">
          @for (cat of rankCategories; track cat.key) {
            <button (click)="toggleRankFilter(cat.key)"
              class="px-3 py-1 text-xs rounded-full border transition-colors"
              [class]="dashboardRankCategory === cat.key
                ? 'bg-teal-600 border-teal-600 text-white'
                : 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800'">
              {{ cat.label }}
            </button>
          }
        </div>
      </div>

      @if (dashboardLoading()) {
        <div class="flex justify-center py-16">
          <svg class="animate-spin h-8 w-8 text-teal-600" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      } @else if (dashboard()) {

        <!-- Stats -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 text-center">
            <p class="text-2xl font-bold text-gray-900 dark:text-zinc-100">{{ dashboard()!.grandTotal.total }}</p>
            <p class="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Total personal</p>
          </div>
          <div class="bg-white dark:bg-zinc-900 rounded-xl border border-green-200 dark:border-green-900/50 p-4 text-center">
            <p class="text-2xl font-bold text-green-600 dark:text-green-400">{{ dashboard()!.grandTotal.effective }}</p>
            <p class="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Fuerza efectiva</p>
          </div>
          <div class="bg-white dark:bg-zinc-900 rounded-xl border border-blue-200 dark:border-blue-900/50 p-4 text-center">
            <p class="text-2xl font-bold text-blue-600 dark:text-blue-400">{{ dashboard()!.grandTotal.present }}</p>
            <p class="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Presentes</p>
          </div>
          <div class="bg-white dark:bg-zinc-900 rounded-xl border border-red-200 dark:border-red-900/50 p-4 text-center">
            <p class="text-2xl font-bold text-red-600 dark:text-red-400">{{ dashboard()!.grandTotal.absent }}</p>
            <p class="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Ausentes</p>
          </div>
        </div>

        <!-- By office -->
        @if (!dashboardOffice) {
          <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
            <div class="px-5 py-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Resumen por oficina</h3>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 dark:bg-zinc-800 text-xs uppercase text-gray-500 dark:text-zinc-400">
                  <tr>
                    <th class="px-4 py-2 text-left">Oficina</th>
                    <th class="px-4 py-2 text-center">Total</th>
                    <th class="px-4 py-2 text-center">F. Efectiva</th>
                    <th class="px-4 py-2 text-center">Presentes</th>
                    <th class="px-4 py-2 text-center">Ausentes</th>
                    <th class="px-4 py-2 text-center">Parte</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-zinc-700/50">
                  @for (office of dashboard()!.offices; track office.officeGroup) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                      <td class="px-4 py-2 font-medium text-gray-900 dark:text-zinc-100">{{ office.officeGroup }}</td>
                      <td class="px-4 py-2 text-center">{{ dashboard()!.byOffice[office.officeGroup]?.total ?? 0 }}</td>
                      <td class="px-4 py-2 text-center text-green-600 dark:text-green-400 font-medium">{{ dashboard()!.byOffice[office.officeGroup]?.effective ?? 0 }}</td>
                      <td class="px-4 py-2 text-center text-blue-600 dark:text-blue-400">{{ dashboard()!.byOffice[office.officeGroup]?.present ?? 0 }}</td>
                      <td class="px-4 py-2 text-center text-red-600 dark:text-red-400">{{ dashboard()!.byOffice[office.officeGroup]?.absent ?? 0 }}</td>
                      <td class="px-4 py-2 text-center">
                        @if (office.hasReport) {
                          <span class="text-xs text-green-600 dark:text-green-400 font-medium">Enviado</span>
                        } @else {
                          <span class="text-xs text-amber-600 dark:text-amber-400">Pendiente</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- Full entries table -->
        <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-100 dark:border-zinc-700 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Personal ({{ dashboard()!.entries.length }})</h3>
            <button (click)="printDashboard()"
              class="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-900 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white text-xs font-medium rounded-lg transition-colors">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Generar Reporte
            </button>
          </div>
          @if (dashboard()!.entries.length === 0) {
            <div class="py-12 text-center text-sm text-gray-400 dark:text-zinc-500">No hay datos para los filtros seleccionados.</div>
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 dark:bg-zinc-800 text-xs uppercase text-gray-500 dark:text-zinc-400">
                  <tr>
                    <th class="px-4 py-2 text-left">Jerarquía</th>
                    <th class="px-4 py-2 text-left">Nombre y Apellido</th>
                    <th class="px-4 py-2 text-left">Oficina</th>
                    <th class="px-4 py-2 text-left">Situación</th>
                    <th class="px-4 py-2 text-center">Días</th>
                    <th class="px-4 py-2 text-left">Detalle</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-zinc-700/50">
                  @for (e of dashboard()!.entries; track e.username + (e.officeGroup ?? '')) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                      <td class="px-4 py-2 font-mono text-xs font-bold text-gray-500 dark:text-zinc-400">{{ e.rank }}</td>
                      <td class="px-4 py-2 font-medium text-gray-900 dark:text-zinc-100">{{ e.fullName }}</td>
                      <td class="px-4 py-2 text-xs text-gray-500 dark:text-zinc-400">{{ e.officeGroup }}</td>
                      <td class="px-4 py-2">
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                              [class]="getSituationBadgeClass(e.situationTypeCode)">
                          {{ getSituationLabel(e.situationTypeCode) }}
                        </span>
                      </td>
                      <td class="px-4 py-2 text-center">
                        @if (e.daysInSituation) {
                          <span class="text-xs font-semibold" [class]="e.daysInSituation > 30 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-zinc-300'">
                            {{ e.daysInSituation }}
                          </span>
                        } @else { <span class="text-gray-300 dark:text-zinc-600">—</span> }
                      </td>
                      <td class="px-4 py-2 text-xs text-gray-500 dark:text-zinc-400">{{ formatEntryDetail(e) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }
    </div>
  }

  <!-- Toasts -->
  @if (error()) {
    <div class="fixed bottom-6 right-6 z-50 bg-red-600 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2">
      <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
      </svg>
      {{ error() }}
    </div>
  }
  @if (success()) {
    <div class="fixed bottom-6 right-6 z-50 bg-green-700 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2">
      <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
      </svg>
      {{ success() }}
    </div>
  }

</div>
  `,
})
export class DailyReportComponent implements OnInit {
  private readonly svc = inject(DailyReportService);
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  // ─── State ────────────────────────────────────────────────────────────────
  readonly activeView = signal<'list' | 'form' | 'view' | 'dashboard'>('list');
  readonly loading = signal(true);
  readonly loadingMembers = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly situationTypes = signal<SituationType[]>([]);
  readonly activeSituationTypes = computed(() => this.situationTypes().filter(s => s.isActive));
  readonly countdown = signal<CountdownInfo | null>(null);
  readonly countdownClass = computed(() => {
    const c = this.countdown();
    if (!c) return '';
    if (c.isNonWorkingDay) return 'bg-gray-100 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-400';
    if (c.isAfterDeadline) return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400';
    if (c.remainingMinutes <= 30) return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400';
    return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400';
  });

  readonly reports = signal<DailyReport[]>([]);
  readonly todayReport = computed(() => {
    const today = new Date().toLocaleDateString('en-CA');
    return this.reports().find(r => r.reportDate === today) ?? null;
  });
  readonly activeSituations = signal<Map<string, ActiveSituation>>(new Map());
  readonly officeMembers = signal<OfficeMember[]>([]);

  readonly formEntries = signal<FormEntry[]>([]);
  readonly formDate = signal(new Date().toLocaleDateString('en-CA'));
  readonly editingReportId = signal<number | null>(null);

  readonly viewingReport = signal<DailyReport | null>(null);

  // Dashboard
  readonly dashboard = signal<DashboardResult | null>(null);
  readonly dashboardLoading = signal(false);
  dashboardDate = new Date().toLocaleDateString('en-CA');
  dashboardOffice = '';
  dashboardSituation = '';
  dashboardSearch = '';
  dashboardRankCategory = '';

  readonly isPersonal = computed(() => this.authService.currentUser()?.roles?.includes('PERSONAL') ?? false);
  readonly userOfficeGroup = computed(() => {
    const roles = this.authService.currentUser()?.roles ?? [];
    return roles.find((r: string) => OFFICE_GROUPS.includes(r.toUpperCase())) ?? null;
  });

  readonly personalTabs = [
    { key: 'list' as const, label: 'Mi Oficina' },
    { key: 'dashboard' as const, label: 'Panel General' },
  ];
  readonly rankCategories = Object.entries(RANK_CATEGORY_LABELS).map(([key, label]) => ({ key, label }));
  readonly officeGroups = OFFICE_GROUPS;

  private situationMap = new Map<string, SituationType>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.svc.getSituationTypes().subscribe({
      next: (types) => {
        this.situationTypes.set(types);
        this.situationMap = new Map(types.map(s => [s.code, s]));
      },
    });
    this.svc.getCountdown().subscribe({ next: (c) => this.countdown.set(c) });

    const office = this.userOfficeGroup();
    if (office) {
      this.svc.listReports(office).subscribe({
        next: (r) => { this.reports.set(r); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
      this.svc.getActiveSituations(office).subscribe({
        next: (sits) => this.activeSituations.set(new Map(sits.map(s => [s.username, s]))),
      });
      // Pre-load office members in background for faster form open
      this.svc.getOfficeMembers(office).subscribe({
        next: (members) => this.officeMembers.set(members),
      });
    } else {
      this.loading.set(false);
    }

    if (this.isPersonal()) this.loadDashboard();
  }

  loadDashboard(): void {
    this.dashboardLoading.set(true);
    this.svc.getDashboard({
      date: this.dashboardDate || undefined,
      officeGroup: this.dashboardOffice || undefined,
      situationTypeCode: this.dashboardSituation || undefined,
      username: this.dashboardSearch || undefined,
      rankCategory: this.dashboardRankCategory || undefined,
    }).subscribe({
      next: (d) => { this.dashboard.set(d); this.dashboardLoading.set(false); },
      error: () => this.dashboardLoading.set(false),
    });
  }

  toggleRankFilter(cat: string): void {
    this.dashboardRankCategory = this.dashboardRankCategory === cat ? '' : cat;
    this.loadDashboard();
  }

  // ─── Form ─────────────────────────────────────────────────────────────────

  startNewReport(): void {
    const office = this.userOfficeGroup();
    if (!office) return;

    this.editingReportId.set(null);
    this.formDate.set(new Date().toLocaleDateString('en-CA'));

    const buildEntries = (members: OfficeMember[]) => {
      const entries: FormEntry[] = members.map(m => {
        const activeSit = this.activeSituations().get(m.username);
        return {
          username: m.username,
          fullName: m.fullName,
          rank: m.rank,
          rankCategory: m.rankCategory,
          situationTypeCode: activeSit?.situationTypeCode ?? 'PRESENTE',
          situationFromDate: activeSit?.fromDate ?? null,
          situationToDate: activeSit?.toDate ?? null,
          authorizedBy: activeSit?.authorizedBy ?? null,
          authorizedDays: activeSit?.authorizedDays ?? null,
          authorizedChargedToLao: activeSit?.authorizedChargedToLao ?? false,
          shiftType: activeSit?.shiftType ?? null,
          notes: activeSit?.notes ?? null,
          daysInSituation: activeSit ? this.calcDaysInSituation(activeSit.fromDate) : null,
        };
      });
      this.formEntries.set(entries);
      this.activeView.set('form');
      this.loadingMembers.set(false);
    };

    // Use cached members if available, otherwise fetch
    if (this.officeMembers().length > 0) {
      buildEntries(this.officeMembers());
    } else {
      this.loadingMembers.set(true);
      this.svc.getOfficeMembers(office).subscribe({
        next: (members) => { this.officeMembers.set(members); buildEntries(members); },
        error: () => { this.loadingMembers.set(false); this.showError('Error al cargar el personal de la oficina'); },
      });
    }
  }

  editReport(report: DailyReport): void {
    this.svc.getReport(report.id).subscribe({
      next: (r) => {
        this.editingReportId.set(r.id);
        this.formDate.set(r.reportDate);
        // Use saved entries from the report (already has all people and their situations)
        const entries: FormEntry[] = (r.entries ?? []).map(e => ({
          ...e,
          daysInSituation: this.calcDaysInSituationByUsername(e.username),
        }));
        this.formEntries.set(entries);
        this.activeView.set('form');
      },
      error: () => this.showError('Error al cargar el parte'),
    });
  }

  onSituationChange(entry: FormEntry, code: string): void {
    const st = this.situationMap.get(code);
    if (!st) return;
    if (!st.requiresDateRange && !st.requiresFromDateOnly) {
      entry.situationFromDate = null;
      entry.situationToDate = null;
    }
    if (!st.requiresAuthorizationInfo) {
      entry.authorizedBy = null;
      entry.authorizedDays = null;
      entry.authorizedChargedToLao = false;
    }
    if (code !== 'TURNO') entry.shiftType = null;
  }

  submitReport(): void {
    if (this.formEntries().length === 0) return;
    const office = this.userOfficeGroup();
    if (!office) return;

    this.saving.set(true);
    const dto = {
      officeGroup: office,
      reportDate: this.formDate(),
      entries: this.formEntries().map(e => ({
        username: e.username,
        fullName: e.fullName,
        rank: e.rank,
        rankCategory: e.rankCategory,
        situationTypeCode: e.situationTypeCode,
        situationFromDate: e.situationFromDate ?? undefined,
        situationToDate: e.situationToDate ?? undefined,
        authorizedBy: e.authorizedBy ?? undefined,
        authorizedDays: e.authorizedDays ?? undefined,
        authorizedChargedToLao: e.authorizedChargedToLao ?? false,
        shiftType: e.shiftType ?? undefined,
        notes: e.notes ?? undefined,
      })),
    };

    const obs = this.editingReportId()
      ? this.svc.updateReport(this.editingReportId()!, dto)
      : this.svc.createReport(dto);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.showSuccess('Parte guardado correctamente');
        this.svc.listReports(office).subscribe({ next: (r) => this.reports.set(r) });
        this.svc.getActiveSituations(office).subscribe({
          next: (sits) => this.activeSituations.set(new Map(sits.map(s => [s.username, s]))),
        });
        this.activeView.set('list');
      },
      error: (err) => {
        this.saving.set(false);
        this.showError(err?.error?.message ?? 'Error al guardar el parte');
      },
    });
  }

  cancelForm(): void {
    this.activeView.set('list');
    this.formEntries.set([]);
    this.editingReportId.set(null);
  }

  // ─── View ─────────────────────────────────────────────────────────────────

  viewReport(report: DailyReport): void {
    this.svc.getReport(report.id).subscribe({
      next: (r) => { this.viewingReport.set(r); this.activeView.set('view' as any); },
    });
  }

  closeView(): void {
    this.viewingReport.set(null);
    this.activeView.set('list');
  }

  // ─── Print ────────────────────────────────────────────────────────────────

  printReport(report: DailyReport): void {
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = (report.entries ?? [])
      .map(e => `<tr><td>${e.rank}</td><td>${e.fullName}</td><td>${this.getSituationLabel(e.situationTypeCode)}</td><td>${this.formatEntryDetail(e)}</td></tr>`)
      .join('');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Parte Diario ${report.reportDate}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;text-align:center}h2{font-size:13px;text-align:center;color:#555}
      table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#f0f0f0;border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:11px}
      td{border:1px solid #ddd;padding:5px 8px}@media print{button{display:none}}</style></head><body>
      <h1>PARTE DIARIO</h1><h2>Oficina: ${report.officeGroup} — Fecha: ${this.formatDate(report.reportDate)}</h2>
      <table><thead><tr><th>Jerarquía</th><th>Nombre y Apellido</th><th>Situación</th><th>Detalle</th></tr></thead>
      <tbody>${rows}</tbody></table><script>window.print();<\/script></body></html>`);
    win.document.close();
  }

  printDashboard(): void {
    const d = this.dashboard();
    if (!d) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = d.entries
      .map(e => `<tr><td>${e.rank}</td><td>${e.fullName}</td><td>${e.officeGroup ?? ''}</td><td>${this.getSituationLabel(e.situationTypeCode)}</td><td>${e.daysInSituation ?? ''}</td><td>${this.formatEntryDetail(e)}</td></tr>`)
      .join('');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte ${d.date}</title>
      <style>body{font-family:Arial,sans-serif;font-size:11px;margin:16px}h1{font-size:15px;text-align:center}.summary{margin:10px 0;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#f0f0f0;border:1px solid #ccc;padding:5px 7px;text-align:left;font-size:10px}
      td{border:1px solid #ddd;padding:4px 7px}@media print{button{display:none}}</style></head><body>
      <h1>REPORTE PARTE DIARIO — ${d.date}</h1>
      <div class="summary">Total: ${d.grandTotal.total} | F. Efectiva: ${d.grandTotal.effective} | Presentes: ${d.grandTotal.present} | Ausentes: ${d.grandTotal.absent}</div>
      <table><thead><tr><th>Jerarquía</th><th>Nombre y Apellido</th><th>Oficina</th><th>Situación</th><th>Días</th><th>Detalle</th></tr></thead>
      <tbody>${rows}</tbody></table><script>window.print();<\/script></body></html>`);
    win.document.close();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  getSituationType(code: string): SituationType | undefined {
    return this.situationMap.get(code);
  }

  getSituationLabel(code: string): string {
    return this.situationMap.get(code)?.label ?? code;
  }

  getSituationBadgeClass(code: string): string {
    const st = this.situationMap.get(code);
    if (!st) return 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300';
    if (st.isEffective) return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
    if (!st.isAbsent) return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  }

  formatEntryDetail(e: DailyReportEntry): string {
    const parts: string[] = [];
    if (e.situationFromDate) parts.push(`Desde: ${this.formatDate(e.situationFromDate)}`);
    if (e.situationToDate) parts.push(`Hasta: ${this.formatDate(e.situationToDate)}`);
    if (e.authorizedBy) parts.push(`Aut: ${e.authorizedBy}`);
    if (e.authorizedDays) parts.push(`${e.authorizedDays} días`);
    if (e.authorizedChargedToLao) parts.push('c/LAO');
    if (e.shiftType) parts.push(e.shiftType);
    if (e.notes) parts.push(e.notes);
    return parts.join(' · ') || '–';
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  formatCountdown(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  private calcDaysInSituation(fromDate: string): number | null {
    if (!fromDate) return null;
    const from = new Date(fromDate);
    const today = new Date();
    return Math.max(1, Math.floor((today.getTime() - from.getTime()) / 86400000) + 1);
  }

  private calcDaysInSituationByUsername(username: string): number | null {
    const sit = this.activeSituations().get(username);
    return sit ? this.calcDaysInSituation(sit.fromDate) : null;
  }

  private showError(msg: string): void {
    this.error.set(msg);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.error.set(null), 4000);
  }

  private showSuccess(msg: string): void {
    this.success.set(msg);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.success.set(null), 3500);
  }
}
