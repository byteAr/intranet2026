import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IncidentsService, Incident, IncidentEvent } from '../../core/services/incidents.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-incidents',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-[calc(100vh-8rem)] bg-white rounded-xl shadow overflow-hidden">

      <!-- Sidebar: incident list -->
      <aside class="w-[28rem] flex-shrink-0 border-r border-gray-200 flex flex-col">
        <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            {{ isTicom ? 'Incidencias' : 'Mis incidencias' }}
          </h2>
          @if (!isTicom) {
            <button (click)="openCreateForm()"
              class="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors font-medium">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Nueva
            </button>
          }
        </div>

        <!-- Filter tabs -->
        <div class="flex border-b border-gray-200 text-xs">
          <button (click)="filterStatus.set(null)"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-teal-700]="filterStatus() === null"
            [class.border-b-2]="filterStatus() === null"
            [class.border-teal-600]="filterStatus() === null"
            [class.font-semibold]="filterStatus() === null"
            [class.text-gray-500]="filterStatus() !== null">
            Todas
          </button>
          <button (click)="filterStatus.set('pendiente')"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-yellow-700]="filterStatus() === 'pendiente'"
            [class.border-b-2]="filterStatus() === 'pendiente'"
            [class.border-yellow-500]="filterStatus() === 'pendiente'"
            [class.font-semibold]="filterStatus() === 'pendiente'"
            [class.text-gray-500]="filterStatus() !== 'pendiente'">
            Pendientes
          </button>
          <button (click)="filterStatus.set('en_proceso')"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-blue-700]="filterStatus() === 'en_proceso'"
            [class.border-b-2]="filterStatus() === 'en_proceso'"
            [class.border-blue-500]="filterStatus() === 'en_proceso'"
            [class.font-semibold]="filterStatus() === 'en_proceso'"
            [class.text-gray-500]="filterStatus() !== 'en_proceso'">
            En proceso
          </button>
          <button (click)="filterStatus.set('en_espera')"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-amber-700]="filterStatus() === 'en_espera'"
            [class.border-b-2]="filterStatus() === 'en_espera'"
            [class.border-amber-500]="filterStatus() === 'en_espera'"
            [class.font-semibold]="filterStatus() === 'en_espera'"
            [class.text-gray-500]="filterStatus() !== 'en_espera'">
            En espera
          </button>
          <button (click)="filterStatus.set('finalizada')"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-green-700]="filterStatus() === 'finalizada'"
            [class.border-b-2]="filterStatus() === 'finalizada'"
            [class.border-green-500]="filterStatus() === 'finalizada'"
            [class.font-semibold]="filterStatus() === 'finalizada'"
            [class.text-gray-500]="filterStatus() !== 'finalizada'">
            Finalizadas
          </button>
          <button (click)="filterStatus.set('no_resuelta')"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-red-700]="filterStatus() === 'no_resuelta'"
            [class.border-b-2]="filterStatus() === 'no_resuelta'"
            [class.border-red-500]="filterStatus() === 'no_resuelta'"
            [class.font-semibold]="filterStatus() === 'no_resuelta'"
            [class.text-gray-500]="filterStatus() !== 'no_resuelta'">
            Sin solución
          </button>
        </div>

        <!-- Incident list -->
        <div class="flex-1 overflow-y-auto">
          @for (incident of filteredIncidents(); track incident.id) {
            <button
              (click)="selectIncident(incident)"
              class="w-full text-left px-4 py-3 border-b border-gray-100 transition-colors"
              [class.bg-teal-50]="selectedIncident()?.id === incident.id"
              [class.hover:bg-gray-50]="selectedIncident()?.id !== incident.id">
              <div class="flex items-start justify-between gap-2">
                <p class="text-sm text-gray-800 line-clamp-2 flex-1">{{ incident.description }}</p>
                <span class="flex-shrink-0 mt-0.5"
                  [class]="statusBadgeClass(incident.status)">
                  {{ statusLabel(incident.status) }}
                </span>
              </div>
              <div class="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                <span>{{ incident.creatorName }}</span>
                <span>&middot;</span>
                <span>{{ formatDate(incident.createdAt) }}</span>
              </div>
              @if (incident.technicianName) {
                <p class="text-xs text-blue-500 mt-1">Técnico: {{ incident.technicianName }}</p>
              }
              @if (incident.status === 'en_espera' && incident.waitingReason) {
                <p class="text-xs text-amber-600 mt-1 truncate">Esperando: {{ incident.waitingReason }}</p>
              }
            </button>
          } @empty {
            <div class="flex flex-col items-center justify-center h-full text-center px-6">
              <p class="text-sm text-gray-400">No hay incidencias</p>
            </div>
          }
        </div>
      </aside>

      <!-- Detail / Create panel -->
      <div class="flex-1 flex flex-col">
        @if (showCreateForm()) {
          <!-- Create form -->
          <div class="px-5 py-3 border-b border-gray-200 flex-shrink-0">
            <h3 class="text-sm font-semibold text-gray-800">Nueva incidencia</h3>
          </div>
          <div class="flex-1 overflow-y-auto p-6">
            <div class="max-w-lg space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Descripción del problema</label>
                <textarea
                  [(ngModel)]="newDescription"
                  rows="5"
                  placeholder="Describe el problema que tienes..."
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"></textarea>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Imagen (opcional)</label>
                <div class="flex items-center gap-3">
                  <input #fileInput type="file" accept="image/*" class="hidden" (change)="onFileSelected($event)" />
                  <button (click)="fileInput.click()"
                    class="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                    Seleccionar imagen
                  </button>
                  @if (selectedFile()) {
                    <div class="flex items-center gap-2 text-sm text-teal-700">
                      <span class="truncate max-w-[200px]">{{ selectedFile()!.name }}</span>
                      <button (click)="selectedFile.set(null)" class="text-gray-400 hover:text-gray-600">
                        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  }
                </div>
              </div>
              <div class="flex gap-3 pt-2">
                <button (click)="submitIncident()" [disabled]="submitting() || !newDescription.trim()"
                  class="px-6 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  @if (submitting()) {
                    <svg class="h-4 w-4 animate-spin inline mr-2" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Enviando...
                  } @else {
                    Crear incidencia
                  }
                </button>
                <button (click)="cancelCreate()"
                  class="px-6 py-2.5 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        } @else if (selectedIncident()) {
          <!-- Detail view -->
          <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <h3 class="text-sm font-semibold text-gray-800">Detalle de incidencia</h3>
            <span [class]="statusBadgeClass(selectedIncident()!.status) + ' text-xs'">
              {{ statusLabel(selectedIncident()!.status) }}
            </span>
          </div>
          <div class="flex-1 overflow-y-auto p-6">
            <div class="max-w-2xl space-y-5">
              <!-- Creator info -->
              <div class="flex items-center gap-3">
                @if (selectedIncident()!.creatorAvatar) {
                  <img [src]="selectedIncident()!.creatorAvatar" class="h-10 w-10 rounded-full object-cover" alt="" />
                } @else {
                  <span class="h-10 w-10 rounded-full bg-teal-600 flex items-center justify-center text-white text-sm font-bold">
                    {{ initials(selectedIncident()!.creatorName) }}
                  </span>
                }
                <div>
                  <p class="text-sm font-medium text-gray-800">{{ selectedIncident()!.creatorName }}</p>
                  <p class="text-xs text-gray-400">{{ formatDateTime(selectedIncident()!.createdAt) }}</p>
                </div>
              </div>

              <!-- Description -->
              <div>
                <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Descripción</h4>
                <p class="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-4">{{ selectedIncident()!.description }}</p>
              </div>

              <!-- Attachment -->
              @if (selectedIncident()!.attachmentUrl) {
                <div>
                  <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Imagen adjunta</h4>
                  <a [href]="selectedIncident()!.attachmentUrl" target="_blank" class="block">
                    <img [src]="selectedIncident()!.attachmentUrl" [alt]="selectedIncident()!.attachmentName"
                      class="max-w-md rounded-lg border border-gray-200 shadow-sm hover:opacity-90 transition-opacity cursor-pointer" />
                  </a>
                </div>
              }


              <!-- Historial de procesos -->
              @if (sortedHistory().length > 0) {
                <div>
                  <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Historial de procesos</h4>
                  <ol class="relative border-l border-gray-200 space-y-4 ml-2">
                    @for (event of sortedHistory(); track event.at) {
                      <li class="ml-5">
                        <span class="absolute -left-2 flex items-center justify-center w-4 h-4 rounded-full ring-4 ring-white"
                          [class]="historyDotClass(event.type)">
                        </span>
                        <div class="flex items-start gap-2">
                          <div class="flex-1">
                            <p class="text-sm font-medium text-gray-800">{{ historyLabel(event) }}</p>
                            @if (event.detail) {
                              <p class="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{{ event.detail }}</p>
                            }
                          </div>
                          <time class="flex-shrink-0 text-xs text-gray-400">{{ formatDateTime(event.at) }}</time>
                        </div>
                      </li>
                    }
                  </ol>
                </div>
              }

              <!-- Actions for TICOM -->
              @if (isTicom) {
                @if (selectedIncident()!.status === 'pendiente') {
                  <button (click)="takeIncident()" [disabled]="actionLoading()"
                    class="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40">
                    @if (actionLoading()) {
                      <svg class="h-4 w-4 animate-spin inline mr-2" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    }
                    Tomar incidencia
                  </button>
                } @else if (selectedIncident()!.status === 'en_proceso') {
                  <div class="space-y-4">
                    <!-- Finalizar -->
                    <div class="border border-green-200 rounded-lg p-4 space-y-2">
                      <h5 class="text-xs font-semibold text-green-700 uppercase tracking-wide">Finalizar con solución</h5>
                      <textarea
                        [(ngModel)]="resolutionText"
                        rows="3"
                        placeholder="Describe la solución aplicada..."
                        class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"></textarea>
                      <button (click)="resolveIncident()" [disabled]="actionLoading() || !resolutionText.trim()"
                        class="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-40">
                        @if (actionLoading()) {
                          <svg class="h-4 w-4 animate-spin inline mr-2" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                          </svg>
                        }
                        Finalizar incidencia
                      </button>
                    </div>
                    <!-- Poner en espera -->
                    <div class="border border-amber-200 rounded-lg p-4 space-y-2">
                      <h5 class="text-xs font-semibold text-amber-700 uppercase tracking-wide">Poner en espera</h5>
                      <textarea
                        [(ngModel)]="holdReasonText"
                        rows="3"
                        placeholder="¿Qué falta para continuar? (ej: comprar tóner, esperar repuesto...)"
                        class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"></textarea>
                      <button (click)="holdIncident()" [disabled]="actionLoading() || !holdReasonText.trim()"
                        class="px-5 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-40">
                        Poner en espera
                      </button>
                    </div>
                    <!-- Cerrar sin solución -->
                    <div class="border border-red-200 rounded-lg p-4 space-y-2">
                      <h5 class="text-xs font-semibold text-red-700 uppercase tracking-wide">Cerrar sin solución</h5>
                      <textarea
                        [(ngModel)]="unresolvedReasonText"
                        rows="3"
                        placeholder="¿Por qué no se pudo resolver? (ej: hardware irreparable, fuera de alcance...)"
                        class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"></textarea>
                      <button (click)="closeUnresolvedIncident()" [disabled]="actionLoading() || !unresolvedReasonText.trim()"
                        class="px-5 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40">
                        Cerrar sin solución
                      </button>
                    </div>
                  </div>
                } @else if (selectedIncident()!.status === 'en_espera') {
                  <div class="space-y-4">
                    <!-- Reactivar -->
                    <div class="border border-blue-200 rounded-lg p-4 space-y-2">
                      <h5 class="text-xs font-semibold text-blue-700 uppercase tracking-wide">Reactivar incidencia</h5>
                      <p class="text-xs text-gray-500">El obstáculo ya fue resuelto y se puede continuar trabajando.</p>
                      <button (click)="reactivateIncident()" [disabled]="actionLoading()"
                        class="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40">
                        @if (actionLoading()) {
                          <svg class="h-4 w-4 animate-spin inline mr-2" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                          </svg>
                        }
                        Reactivar
                      </button>
                    </div>
                    <!-- Cerrar sin solución desde en_espera -->
                    <div class="border border-red-200 rounded-lg p-4 space-y-2">
                      <h5 class="text-xs font-semibold text-red-700 uppercase tracking-wide">Cerrar sin solución</h5>
                      <textarea
                        [(ngModel)]="unresolvedReasonText"
                        rows="3"
                        placeholder="¿Por qué no se pudo resolver?"
                        class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"></textarea>
                      <button (click)="closeUnresolvedIncident()" [disabled]="actionLoading() || !unresolvedReasonText.trim()"
                        class="px-5 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40">
                        Cerrar sin solución
                      </button>
                    </div>
                  </div>
                }
              }
            </div>
          </div>
        } @else {
          <!-- Empty state -->
          <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <svg class="h-12 w-12 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p class="text-sm text-gray-400">
              {{ isTicom ? 'Selecciona una incidencia para ver su detalle' : 'Selecciona una incidencia o crea una nueva' }}
            </p>
          </div>
        }
      </div>
    </div>
  `,
})
export class IncidentsComponent implements OnInit {
  readonly incidentsService = inject(IncidentsService);
  private readonly authService = inject(AuthService);

  readonly selectedIncident = signal<Incident | null>(null);
  readonly showCreateForm = signal(false);
  readonly filterStatus = signal<string | null>(null);
  readonly selectedFile = signal<File | null>(null);
  readonly submitting = signal(false);
  readonly actionLoading = signal(false);
  newDescription = '';
  resolutionText = '';
  holdReasonText = '';
  unresolvedReasonText = '';

  constructor() {
    // Keep selectedIncident in sync with real-time updates from the list
    effect(() => {
      const selected = this.selectedIncident();
      if (!selected) return;
      const updated = this.incidentsService.incidents().find((i) => i.id === selected.id);
      if (updated && updated !== selected) {
        this.selectedIncident.set(updated);
      }
    });
  }

  get isTicom(): boolean {
    return this.incidentsService.isTicom;
  }

  readonly currentUserId = computed(() => this.authService.currentUser()?.id);

  readonly sortedHistory = computed(() => {
    const history = this.selectedIncident()?.history ?? [];
    return [...history].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  });

  readonly filteredIncidents = computed(() => {
    const status = this.filterStatus();
    const all = this.incidentsService.incidents();
    if (!status) return all;
    return all.filter((i) => i.status === status);
  });

  ngOnInit(): void {
    if (!this.incidentsService.isConnected()) {
      this.incidentsService.connect();
    }
    this.incidentsService.loadIncidents(this.isTicom ? false : true);
  }

  selectIncident(incident: Incident): void {
    this.selectedIncident.set(incident);
    this.showCreateForm.set(false);
    this.resolutionText = '';
    this.holdReasonText = '';
    this.unresolvedReasonText = '';
  }

  openCreateForm(): void {
    this.showCreateForm.set(true);
    this.selectedIncident.set(null);
    this.newDescription = '';
    this.selectedFile.set(null);
  }

  cancelCreate(): void {
    this.showCreateForm.set(false);
    this.newDescription = '';
    this.selectedFile.set(null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Solo se permiten imágenes.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('La imagen no puede superar los 10 MB.');
      return;
    }
    this.selectedFile.set(file);
  }

  submitIncident(): void {
    if (!this.newDescription.trim() || this.submitting()) return;
    this.submitting.set(true);
    this.incidentsService.createIncident(this.newDescription.trim(), this.selectedFile() ?? undefined).subscribe({
      next: () => {
        this.submitting.set(false);
        this.cancelCreate();
        // Reload from REST (websocket will also add it but REST ensures consistency)
        this.incidentsService.loadIncidents(true);
      },
      error: (err) => {
        this.submitting.set(false);
        alert(err?.error?.message ?? 'Error al crear la incidencia');
      },
    });
  }

  takeIncident(): void {
    const incident = this.selectedIncident();
    if (!incident) return;
    this.actionLoading.set(true);
    this.incidentsService.assignIncident(incident.id).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.selectedIncident.set(updated);
      },
      error: (err) => {
        this.actionLoading.set(false);
        alert(err?.error?.message ?? 'No se pudo tomar la incidencia');
      },
    });
  }

  resolveIncident(): void {
    const incident = this.selectedIncident();
    if (!incident || !this.resolutionText.trim()) return;
    this.actionLoading.set(true);
    this.incidentsService.resolveIncident(incident.id, this.resolutionText.trim()).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.selectedIncident.set(updated);
        this.resolutionText = '';
      },
      error: (err) => {
        this.actionLoading.set(false);
        alert(err?.error?.message ?? 'No se pudo finalizar la incidencia');
      },
    });
  }

  holdIncident(): void {
    const incident = this.selectedIncident();
    if (!incident || !this.holdReasonText.trim()) return;
    this.actionLoading.set(true);
    this.incidentsService.holdIncident(incident.id, this.holdReasonText.trim()).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.selectedIncident.set(updated);
        this.holdReasonText = '';
      },
      error: (err) => {
        this.actionLoading.set(false);
        alert(err?.error?.message ?? 'No se pudo poner en espera la incidencia');
      },
    });
  }

  reactivateIncident(): void {
    const incident = this.selectedIncident();
    if (!incident) return;
    this.actionLoading.set(true);
    this.incidentsService.reactivateIncident(incident.id).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.selectedIncident.set(updated);
      },
      error: (err) => {
        this.actionLoading.set(false);
        alert(err?.error?.message ?? 'No se pudo reactivar la incidencia');
      },
    });
  }

  closeUnresolvedIncident(): void {
    const incident = this.selectedIncident();
    if (!incident || !this.unresolvedReasonText.trim()) return;
    this.actionLoading.set(true);
    this.incidentsService.closeUnresolvedIncident(incident.id, this.unresolvedReasonText.trim()).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.selectedIncident.set(updated);
        this.unresolvedReasonText = '';
      },
      error: (err) => {
        this.actionLoading.set(false);
        alert(err?.error?.message ?? 'No se pudo cerrar la incidencia');
      },
    });
  }

  historyLabel(event: IncidentEvent): string {
    switch (event.type) {
      case 'creada':    return `Incidencia creada por ${event.byName ?? ''}`;
      case 'tomada':    return `Tomada por ${event.byName ?? ''} (TICOM)`;
      case 'en_espera': return `Puesta en espera por ${event.byName ?? ''}`;
      case 'reactivada':return `Reactivada por ${event.byName ?? ''}`;
      case 'finalizada':return `Finalizada por ${event.byName ?? ''}`;
      case 'sin_solucion': return `Cerrada sin solución por ${event.byName ?? ''}`;
      default: return event.type;
    }
  }

  historyDotClass(type: string): string {
    switch (type) {
      case 'creada':    return 'bg-gray-300';
      case 'tomada':    return 'bg-blue-500';
      case 'en_espera': return 'bg-amber-400';
      case 'reactivada':return 'bg-blue-400';
      case 'finalizada':return 'bg-green-500';
      case 'sin_solucion': return 'bg-red-500';
      default: return 'bg-gray-300';
    }
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'pendiente': return 'Pendiente';
      case 'en_proceso': return 'En proceso';
      case 'en_espera': return 'En espera';
      case 'no_resuelta': return 'Sin solución';
      case 'finalizada': return 'Finalizada';
      default: return status;
    }
  }

  statusBadgeClass(status: string): string {
    switch (status) {
      case 'pendiente': return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700';
      case 'en_proceso': return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700';
      case 'en_espera': return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700';
      case 'no_resuelta': return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700';
      case 'finalizada': return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700';
      default: return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700';
    }
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  formatDateTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] ?? '?').toUpperCase();
  }
}
