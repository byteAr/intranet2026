import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ReservationsService, Reservation, CreateReservationDto, BlockedPeriod, CreateBlockedPeriodDto } from '../../core/services/reservations.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Creator cancel confirmation modal -->
    @if (showCancelConfirmModal()) {
      <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <svg class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <div>
              <h3 class="text-sm font-semibold text-gray-800">¿Cancelar esta solicitud?</h3>
              <p class="text-xs text-gray-500 mt-0.5">El horario quedará libre para que otro usuario pueda reservarlo.</p>
            </div>
          </div>
          <div class="flex gap-3 justify-end pt-1">
            <button (click)="showCancelConfirmModal.set(false)"
              class="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors">
              Volver
            </button>
            <button (click)="cancelOwnReservation()" [disabled]="actionLoading()"
              class="px-4 py-2 bg-gray-700 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40">
              @if (actionLoading()) { Cancelando... } @else { Sí, cancelar solicitud }
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Error modal -->
    @if (errorMessage()) {
      <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg class="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h3 class="text-sm font-semibold text-gray-800">Ocurrió un error</h3>
              <p class="text-xs text-gray-500 mt-0.5">{{ errorMessage() }}</p>
            </div>
          </div>
          <div class="flex justify-end">
            <button (click)="errorMessage.set('')"
              class="px-4 py-2 bg-gray-700 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
              Entendido
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Block success toast -->
    @if (blockSuccess()) {
      <div class="fixed top-4 right-4 z-50 px-4 py-3 bg-orange-600 text-white text-sm font-medium rounded-lg shadow-lg max-w-sm">
        {{ blockSuccess() }}
      </div>
    }

    <!-- TICOM cancel modal -->
    @if (showTicomCancelModal()) {
      <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
          <h3 class="text-sm font-semibold text-gray-800">Cancelar videoconferencia</h3>
          <p class="text-sm text-gray-500">Indica el motivo técnico de la cancelación. El solicitante y Ayudantía serán notificados. <strong>Esta acción es definitiva e irreversible.</strong></p>
          <textarea [(ngModel)]="ticomCancelReason" rows="3"
            placeholder="Ej: El equipo de videoconferencia presenta un desperfecto técnico que impide su uso..."
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"></textarea>
          <div class="flex gap-3 justify-end">
            <button (click)="showTicomCancelModal.set(false)"
              class="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors">
              Volver
            </button>
            <button (click)="confirmTicomCancel()" [disabled]="!ticomCancelReason.trim() || actionLoading()"
              class="px-4 py-2 bg-purple-700 text-white text-sm font-medium rounded-lg hover:bg-purple-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              @if (actionLoading()) { Cancelando... } @else { Cancelar definitivamente }
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Reject modal -->
    @if (showRejectModal()) {
      <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
          <h3 class="text-sm font-semibold text-gray-800">Rechazar solicitud</h3>
          <p class="text-sm text-gray-500">Ingresa el motivo del rechazo. El solicitante será notificado y podrá editar su pedido.</p>
          <textarea [(ngModel)]="rejectReason" rows="3"
            placeholder="Ej: El horario ya está reservado para otra actividad..."
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"></textarea>
          <div class="flex gap-3 justify-end">
            <button (click)="showRejectModal.set(false)"
              class="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button (click)="confirmReject()" [disabled]="!rejectReason.trim() || actionLoading()"
              class="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              @if (actionLoading()) {
                <svg class="h-4 w-4 animate-spin inline mr-1" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              Rechazar
            </button>
          </div>
        </div>
      </div>
    }

    <div class="flex h-[calc(100vh-8rem)] bg-white rounded-xl shadow overflow-hidden">

      <!-- Sidebar: reservation list -->
      <aside class="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col">
        <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            {{ sidebarTitle }}
          </h2>
          @if (canCreate) {
            <button (click)="openCreateForm()"
              class="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors font-medium">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Nueva
            </button>
          }
          @if (isAyudantia) {
            <button (click)="openBlockForm()"
              class="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs text-orange-700 bg-orange-50 hover:bg-orange-100 transition-colors font-medium">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              Bloquear
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
          <button (click)="filterStatus.set('confirmada')"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-green-700]="filterStatus() === 'confirmada'"
            [class.border-b-2]="filterStatus() === 'confirmada'"
            [class.border-green-500]="filterStatus() === 'confirmada'"
            [class.font-semibold]="filterStatus() === 'confirmada'"
            [class.text-gray-500]="filterStatus() !== 'confirmada'">
            Confirmadas
          </button>
          <button (click)="filterStatus.set('rechazada')"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-red-700]="filterStatus() === 'rechazada'"
            [class.border-b-2]="filterStatus() === 'rechazada'"
            [class.border-red-500]="filterStatus() === 'rechazada'"
            [class.font-semibold]="filterStatus() === 'rechazada'"
            [class.text-gray-500]="filterStatus() !== 'rechazada'">
            Rechazadas
          </button>
        </div>

        <!-- List -->
        <div class="flex-1 overflow-y-auto">
          @for (res of filteredReservations(); track res.id) {
            <button
              (click)="selectReservation(res)"
              class="w-full text-left px-4 py-3 border-b border-gray-100 transition-colors"
              [class.bg-teal-50]="selectedReservation()?.id === res.id"
              [class.hover:bg-gray-50]="selectedReservation()?.id !== res.id">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <div class="min-w-0">
                    <p class="text-sm text-gray-800 truncate">{{ formatDateShort(res.date) }} &middot; {{ res.startTime }} - {{ res.endTime }}</p>
                    <p class="text-xs text-gray-400">{{ locationLabel(res.location) }}</p>
                  </div>
                </div>
                <span class="flex-shrink-0 mt-0.5" [class]="statusBadgeClass(resolvedStatus(res))">
                  {{ statusLabel(resolvedStatus(res)) }}
                </span>
              </div>
              <p class="text-xs text-gray-400 mt-1">{{ res.creatorName }}</p>
            </button>
          } @empty {
            <div class="flex flex-col items-center justify-center h-full text-center px-6">
              <p class="text-sm text-gray-400">No hay reservas</p>
            </div>
          }
          @if (isAyudantia && blockedPeriods().length > 0) {
            <div class="border-t border-orange-100 bg-orange-50/30">
              <p class="text-xs font-semibold text-orange-600 uppercase tracking-wide px-4 py-2">Horarios bloqueados</p>
              @for (block of blockedPeriods(); track block.id) {
                <button
                  (click)="selectBlock(block)"
                  class="w-full text-left px-4 py-2.5 border-b border-orange-100 transition-colors hover:bg-orange-50"
                  [class.bg-orange-100]="selectedBlock()?.id === block.id">
                  <p class="text-xs font-medium text-orange-800">{{ formatDateShort(block.date) }} &middot; {{ block.startTime }} – {{ block.endTime }}</p>
                  <p class="text-xs text-orange-600 truncate mt-0.5">{{ block.reason }}</p>
                </button>
              }
            </div>
          }
        </div>
      </aside>

      <!-- Detail / Create panel -->
      <div class="flex-1 flex flex-col">
        @if (showCreateForm()) {
          <!-- Create / Edit form -->
          <div class="px-5 py-3 border-b border-gray-200 flex-shrink-0">
            <h3 class="text-sm font-semibold text-gray-800">
              {{ editingReservationId() ? 'Editar solicitud rechazada' : 'Nueva reserva' }}
            </h3>
          </div>
          <div class="flex-1 overflow-y-auto p-6">
            <div class="max-w-2xl space-y-5">

              @if (editingReservationId()) {
                <div class="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <svg class="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p class="text-sm text-amber-700">Estás editando una solicitud rechazada. Al guardar, volverá a enviarse para aprobación.</p>
                </div>
              }

              <!-- Date & Time -->
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                  <input type="date" [(ngModel)]="formDate" [min]="todayStr"
                    (ngModelChange)="onFormChange()"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Hora de inicio</label>
                  <input type="time" [(ngModel)]="formStartTime" step="1800"
                    (ngModelChange)="onFormChange()"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>
              </div>

              <!-- Duration -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Duración estimada</label>
                <div class="flex flex-wrap gap-2">
                  @for (d of durations; track d.value) {
                    <button (click)="formDuration = d.value; onFormChange()"
                      class="px-4 py-2 rounded-full text-sm font-medium transition-colors border"
                      [class.bg-teal-600]="formDuration === d.value"
                      [class.text-white]="formDuration === d.value"
                      [class.border-teal-600]="formDuration === d.value"
                      [class.bg-white]="formDuration !== d.value"
                      [class.text-gray-700]="formDuration !== d.value"
                      [class.border-gray-300]="formDuration !== d.value"
                      [class.hover:bg-gray-50]="formDuration !== d.value">
                      {{ d.label }}
                    </button>
                  }
                </div>
              </div>

              <!-- Location -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Sala</label>
                <div class="grid grid-cols-2 gap-3">
                  <button (click)="formLocation = 'piso_8'; onFormChange()"
                    class="p-4 rounded-xl border-2 text-left transition-colors"
                    [class.border-teal-600]="formLocation === 'piso_8'"
                    [class.bg-teal-50]="formLocation === 'piso_8'"
                    [class.border-gray-200]="formLocation !== 'piso_8'">
                    <svg class="h-8 w-8 mb-2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" [attr.stroke]="formLocation === 'piso_8' ? '#0d9488' : '#9ca3af'" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10">
                      <path d="M21.5.5h-20v13h20zm-16 19l-2 1l-2-1V17l2-1l2 1zm1 4l-1-2h-4l-1 2zm7-4l-2 1l-2-1V17l2-1l2 1zm1 4l-1-2h-4l-1 2zm7-4l-2 1l-2-1V17l2-1l2 1zm1 4l-1-2h-4l-1 2z"/>
                      <path d="m14.5 8l-3 1.5l-3-1.5V4l3-1.5l3 1.5z"/>
                      <path d="M8.5 4L11 5.5h3.5m2 8V12l-5-1.5l-5 1.5v1.5"/>
                    </svg>
                    <p class="text-sm font-semibold" [class.text-teal-700]="formLocation === 'piso_8'" [class.text-gray-800]="formLocation !== 'piso_8'">Sala de conferencias</p>
                    <p class="text-xs" [class.text-teal-500]="formLocation === 'piso_8'" [class.text-gray-400]="formLocation !== 'piso_8'">Piso 8</p>
                  </button>
                  <button (click)="formLocation = 'piso_6'; onFormChange()"
                    class="p-4 rounded-xl border-2 text-left transition-colors"
                    [class.border-teal-600]="formLocation === 'piso_6'"
                    [class.bg-teal-50]="formLocation === 'piso_6'"
                    [class.border-gray-200]="formLocation !== 'piso_6'">
                    <svg class="h-8 w-8 mb-2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" [attr.stroke]="formLocation === 'piso_6' ? '#0d9488' : '#9ca3af'" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10">
                      <path d="M21.5.5h-20v13h20zm-16 19l-2 1l-2-1V17l2-1l2 1zm1 4l-1-2h-4l-1 2zm7-4l-2 1l-2-1V17l2-1l2 1zm1 4l-1-2h-4l-1 2zm7-4l-2 1l-2-1V17l2-1l2 1zm1 4l-1-2h-4l-1 2z"/>
                      <path d="m14.5 8l-3 1.5l-3-1.5V4l3-1.5l3 1.5z"/>
                      <path d="M8.5 4L11 5.5h3.5m2 8V12l-5-1.5l-5 1.5v1.5"/>
                    </svg>
                    <p class="text-sm font-semibold" [class.text-teal-700]="formLocation === 'piso_6'" [class.text-gray-800]="formLocation !== 'piso_6'">Sala de conferencias</p>
                    <p class="text-xs" [class.text-teal-500]="formLocation === 'piso_6'" [class.text-gray-400]="formLocation !== 'piso_6'">Piso 6</p>
                  </button>
                </div>
              </div>

              <!-- Equipment type -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Tipo de equipo</label>
                <div class="grid grid-cols-2 gap-3">
                  <button (click)="formEquipment = 'notebook'; onFormChange()"
                    class="p-4 rounded-xl border-2 text-left transition-colors"
                    [class.border-teal-600]="formEquipment === 'notebook'"
                    [class.bg-teal-50]="formEquipment === 'notebook'"
                    [class.border-gray-200]="formEquipment !== 'notebook'">
                    <svg class="h-8 w-8 mb-2" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="none" [attr.stroke]="formEquipment === 'notebook' ? '#0d9488' : '#9ca3af'" stroke-linecap="round" stroke-linejoin="round" stroke-width="4">
                      <path d="M8 8h32v20H8zm0 20L4 41h40l-4-13"/>
                      <path d="M19.9 35h8.2l1.9 6H18z"/>
                    </svg>
                    <p class="text-sm font-semibold" [class.text-teal-700]="formEquipment === 'notebook'" [class.text-gray-800]="formEquipment !== 'notebook'">Notebook</p>
                    <p class="text-xs" [class.text-teal-500]="formEquipment === 'notebook'" [class.text-gray-400]="formEquipment !== 'notebook'">Videoconferencia simple</p>
                  </button>
                  <button (click)="formEquipment = 'equipo_completo'; onFormChange()"
                    class="p-4 rounded-xl border-2 text-left transition-colors"
                    [class.border-teal-600]="formEquipment === 'equipo_completo'"
                    [class.bg-teal-50]="formEquipment === 'equipo_completo'"
                    [class.border-gray-200]="formEquipment !== 'equipo_completo'">
                    <div class="flex items-center gap-1 mb-2">
                      <svg class="h-8 w-8" viewBox="0 0 1024 640" xmlns="http://www.w3.org/2000/svg" [attr.fill]="formEquipment === 'equipo_completo' ? '#0d9488' : '#9ca3af'">
                        <path d="M896 576h-64q0 26-18.5 45t-45 19t-45.5-19t-19-45H320q0 26-18.5 45t-45 19t-45.5-19t-19-45h-64q-53 0-90.5-37.5T0 448V256q0-53 37.5-90.5T128 128h22q27-58 81.5-93T352 0t120.5 35t81.5 93h342q53 0 90.5 37.5T1024 256v192q0 53-37.5 90.5T896 576M352 64q-66 0-113 47t-47 113t47 113t113 47t113-47t47-113t-47-113t-113-47m384 192q-13 0-22.5 9.5T704 288t9.5 22.5T736 320t22.5-9.5T768 288t-9.5-22.5T736 256m128 0q-13 0-22.5 9.5T832 288t9.5 22.5T864 320t22.5-9.5T896 288t-9.5-22.5T864 256"/>
                      </svg>
                      <svg class="h-8 w-8" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" [attr.fill]="formEquipment === 'equipo_completo' ? '#0d9488' : '#9ca3af'">
                        <path d="M20 2H4c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1h1v9h6v2.59l-4.21 4.2l1.42 1.42l2.79-2.8V22h2v-2.59l2.79 2.8l1.42-1.42l-4.21-4.2V14h6V5h1c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1m-3 10H7V5h10z"/>
                      </svg>
                      <svg class="h-8 w-8" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="none" [attr.stroke]="formEquipment === 'equipo_completo' ? '#0d9488' : '#9ca3af'" stroke-linecap="round" stroke-linejoin="round" stroke-width="4">
                        <path d="M8 8h32v20H8zm0 20L4 41h40l-4-13"/>
                        <path d="M19.9 35h8.2l1.9 6H18z"/>
                      </svg>
                    </div>
                    <p class="text-sm font-semibold" [class.text-teal-700]="formEquipment === 'equipo_completo'" [class.text-gray-800]="formEquipment !== 'equipo_completo'">Equipo completo</p>
                    <p class="text-xs" [class.text-teal-500]="formEquipment === 'equipo_completo'" [class.text-gray-400]="formEquipment !== 'equipo_completo'">Notebook + proyector, mic, pantalla</p>
                  </button>
                </div>
              </div>

              <!-- Conference URL -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">URL de videoconferencia (opcional)</label>
                <input type="url" [(ngModel)]="formConferenceUrl"
                  placeholder="https://meet.google.com/... o https://teams.microsoft.com/..."
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
              </div>

              <!-- Availability check -->
              @if (availabilityChecked()) {
                @if (isAvailable()) {
                  <div class="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                    <svg class="h-5 w-5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span class="text-sm text-green-700">Horario disponible</span>
                  </div>
                } @else {
                  <div class="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                    <svg class="h-5 w-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <span class="text-sm text-red-700">{{ conflictMessage() }}</span>
                  </div>
                }
              }

              <!-- Submit -->
              <div class="flex gap-3 pt-2">
                <button (click)="submitReservation()" [disabled]="!canSubmit()"
                  class="px-6 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  @if (submitting()) {
                    <svg class="h-4 w-4 animate-spin inline mr-2" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    {{ editingReservationId() ? 'Guardando...' : 'Reservando...' }}
                  } @else {
                    {{ editingReservationId() ? 'Guardar y reenviar' : 'Crear reserva' }}
                  }
                </button>
                <button (click)="cancelCreate()"
                  class="px-6 py-2.5 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          </div>

        } @else if (showBlockForm()) {
          <div class="px-5 py-3 border-b border-gray-200 flex-shrink-0">
            <h3 class="text-sm font-semibold text-gray-800">Bloquear horario</h3>
          </div>
          <div class="flex-1 overflow-y-auto p-6">
            <div class="max-w-2xl space-y-5">
              <div class="flex items-start gap-2 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg">
                <svg class="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p class="text-sm text-orange-700">
                  Bloquearás el horario del <strong>{{ isAyudantiaDiredtos ? 'Piso 8' : 'Piso 6' }}</strong>.
                  Las reservas activas en ese rango serán <strong>canceladas automáticamente</strong> y sus solicitantes recibirán un correo con el motivo.
                </p>
              </div>

              <div class="grid grid-cols-1 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                  <input type="date" [(ngModel)]="blockDate" [min]="todayStr"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Hora inicio</label>
                    <input type="time" [(ngModel)]="blockStartTime" step="1800"
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Hora fin</label>
                    <input type="time" [(ngModel)]="blockEndTime" step="1800"
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                  </div>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Motivo del bloqueo</label>
                  <textarea [(ngModel)]="blockReason" rows="3" placeholder="Ej: Reunión de directores, evento institucional..."
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"></textarea>
                </div>
              </div>

              @if (errorMessage()) {
                <div class="px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                  <p class="text-sm text-red-700">{{ errorMessage() }}</p>
                </div>
              }

              <div class="flex gap-3 pt-2">
                <button (click)="submitBlock()"
                  [disabled]="blockSubmitting() || !blockDate || !blockStartTime || !blockEndTime || !blockReason.trim()"
                  class="px-6 py-2.5 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  @if (blockSubmitting()) {
                    <svg class="h-4 w-4 animate-spin inline mr-2" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Bloqueando...
                  } @else {
                    Confirmar bloqueo
                  }
                </button>
                <button (click)="cancelBlockForm()"
                  class="px-6 py-2.5 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          </div>

        } @else if (selectedBlock()) {
          <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <h3 class="text-sm font-semibold text-gray-800">Horario bloqueado</h3>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Bloqueado</span>
          </div>
          <div class="flex-1 overflow-y-auto p-6">
            <div class="max-w-2xl space-y-5">
              <div class="px-4 py-4 bg-orange-50 border border-orange-200 rounded-lg space-y-3">
                <div class="flex items-center gap-2">
                  <svg class="h-5 w-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  <span class="text-sm font-semibold text-orange-800">
                    {{ selectedBlock()!.location === 'piso_8' ? 'Sala Piso 8' : 'Sala Piso 6' }}
                  </span>
                </div>
                <table class="w-full text-sm">
                  <tr><td class="py-1 text-gray-500 font-medium w-28">Fecha</td><td class="py-1 text-gray-800">{{ formatDateShort(selectedBlock()!.date) }}</td></tr>
                  <tr><td class="py-1 text-gray-500 font-medium">Horario</td><td class="py-1 text-gray-800">{{ selectedBlock()!.startTime }} – {{ selectedBlock()!.endTime }}</td></tr>
                  <tr><td class="py-1 text-gray-500 font-medium">Bloqueado por</td><td class="py-1 text-gray-800">{{ selectedBlock()!.createdByName }} ({{ selectedBlock()!.createdByGroup }})</td></tr>
                  <tr><td class="py-1 text-orange-600 font-semibold">Motivo</td><td class="py-1 text-orange-800">{{ selectedBlock()!.reason }}</td></tr>
                </table>
              </div>

              @if (errorMessage()) {
                <div class="px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                  <p class="text-sm text-red-700">{{ errorMessage() }}</p>
                </div>
              }

              <div class="flex gap-3">
                <button (click)="deleteBlock(selectedBlock()!.id)"
                  class="px-5 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors">
                  Eliminar bloqueo
                </button>
              </div>
            </div>
          </div>

        } @else if (selectedReservation()) {
          <!-- Detail view -->
          <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <h3 class="text-sm font-semibold text-gray-800">Detalle de reserva</h3>
            <span [class]="statusBadgeClass(resolvedStatus(selectedReservation()!)) + ' text-xs'">
              {{ statusLabel(resolvedStatus(selectedReservation()!)) }}
            </span>
          </div>
          <div class="flex-1 overflow-y-auto p-6">
            <div class="max-w-2xl space-y-5">

              <!-- Status banner — message adapts to the viewer's role -->
              @if (resolvedStatus(selectedReservation()!) === 'pendiente_ayudantia') {
                <div class="flex items-start gap-3 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <svg class="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    @if (isTicom) {
                      <p class="text-sm font-medium text-yellow-800">Pendiente de aprobación por Ayudantía</p>
                      <p class="text-xs text-yellow-600 mt-0.5">
                        <strong>{{ selectedReservation()!.location === 'piso_8' ? 'AYUDANTIADIREDTOS' : 'AYUDANTIARECTORADO' }}</strong>
                        debe aprobar o rechazar esta solicitud. Una vez aprobada llegará a TICOM para confirmación.
                      </p>
                    } @else if (isAyudantia) {
                      <p class="text-sm font-medium text-yellow-800">Pendiente de tu aprobación</p>
                      <p class="text-xs text-yellow-600 mt-0.5">
                        Debes aprobar o rechazar esta solicitud para que el solicitante sea notificado.
                      </p>
                    } @else {
                      <p class="text-sm font-medium text-yellow-800">Pendiente de aprobación</p>
                      <p class="text-xs text-yellow-600 mt-0.5">
                        Tu solicitud está esperando la aprobación de
                        <strong>{{ selectedReservation()!.location === 'piso_8' ? 'AYUDANTIADIREDTOS' : 'AYUDANTIARECTORADO' }}</strong>.
                        Recibirás un correo cuando sea procesada.
                      </p>
                    }
                  </div>
                </div>
              }
              @if (resolvedStatus(selectedReservation()!) === 'pendiente_ticom') {
                <div class="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <svg class="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    @if (isTicom) {
                      <p class="text-sm font-medium text-blue-800">Pendiente de tu confirmación</p>
                      <p class="text-xs text-blue-600 mt-0.5">
                        Aprobada por <strong>{{ selectedReservation()!.ayudantiaApprovedByName }}</strong>
                        ({{ selectedReservation()!.ayudantiaApprovedByGroup }}){{ selectedReservation()!.ayudantiaApprovedAt ? ' el ' + formatDateTime(selectedReservation()!.ayudantiaApprovedAt!) : '' }}.
                        Confirma la disponibilidad del equipamiento para notificar al solicitante.
                      </p>
                    } @else if (isAyudantia) {
                      <p class="text-sm font-medium text-blue-800">Aprobada — esperando confirmación de TICOM</p>
                      <p class="text-xs text-blue-600 mt-0.5">
                        Aprobaste esta solicitud{{ selectedReservation()!.ayudantiaApprovedAt ? ' el ' + formatDateTime(selectedReservation()!.ayudantiaApprovedAt!) : '' }}.
                        TICOM debe confirmar la disponibilidad del equipamiento para completar el proceso.
                      </p>
                    } @else {
                      <p class="text-sm font-medium text-blue-800">Aprobada — esperando confirmación de TICOM</p>
                      <p class="text-xs text-blue-600 mt-0.5">
                        Aprobada por <strong>{{ selectedReservation()!.ayudantiaApprovedByName }}</strong>
                        ({{ selectedReservation()!.ayudantiaApprovedByGroup }}){{ selectedReservation()!.ayudantiaApprovedAt ? ' el ' + formatDateTime(selectedReservation()!.ayudantiaApprovedAt!) : '' }}.
                        TICOM confirmará la disponibilidad del equipamiento. Recibirás un correo al finalizar.
                      </p>
                    }
                  </div>
                </div>
              }
              @if (resolvedStatus(selectedReservation()!) === 'rechazada') {
                <div class="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                  <svg class="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    @if (isTicom) {
                      <p class="text-sm font-medium text-red-800">
                        Rechazada por <strong>{{ selectedReservation()!.rejectedByName }}</strong> ({{ selectedReservation()!.rejectedByGroup }}){{ selectedReservation()!.rejectedAt ? ' el ' + formatDateTime(selectedReservation()!.rejectedAt!) : '' }}
                      </p>
                      <p class="text-xs text-red-600 mt-0.5"><strong>Motivo:</strong> {{ selectedReservation()!.rejectionReason }}</p>
                      <p class="text-xs text-red-400 mt-1">El solicitante fue notificado y puede editar y reenviar su pedido.</p>
                    } @else if (isAyudantia) {
                      <p class="text-sm font-medium text-red-800">
                        Rechazada por <strong>{{ selectedReservation()!.rejectedByName }}</strong> ({{ selectedReservation()!.rejectedByGroup }}){{ selectedReservation()!.rejectedAt ? ' el ' + formatDateTime(selectedReservation()!.rejectedAt!) : '' }}
                      </p>
                      <p class="text-xs text-red-600 mt-0.5"><strong>Motivo indicado:</strong> {{ selectedReservation()!.rejectionReason }}</p>
                      <p class="text-xs text-red-400 mt-1">El solicitante fue notificado por correo y puede editar y reenviar su pedido.</p>
                    } @else {
                      <p class="text-sm font-medium text-red-800">
                        Rechazada por <strong>{{ selectedReservation()!.rejectedByName }}</strong> ({{ selectedReservation()!.rejectedByGroup }}){{ selectedReservation()!.rejectedAt ? ' el ' + formatDateTime(selectedReservation()!.rejectedAt!) : '' }}
                      </p>
                      <p class="text-xs text-red-600 mt-0.5"><strong>Motivo:</strong> {{ selectedReservation()!.rejectionReason }}</p>
                      <p class="text-xs text-red-400 mt-1">Puedes editar tu solicitud y volver a enviarla para reiniciar el proceso.</p>
                    }
                  </div>
                </div>
              }
              @if (resolvedStatus(selectedReservation()!) === 'cancelada') {
                <div class="flex items-start gap-3 px-4 py-3 rounded-lg"
                  [class]="selectedReservation()!.ticomCancelledByName ? 'bg-purple-50 border border-purple-200' : selectedReservation()!.blockCancelledByName ? 'bg-orange-50 border border-orange-200' : 'bg-gray-50 border border-gray-200'">
                  <svg class="h-5 w-5 flex-shrink-0 mt-0.5" [class]="selectedReservation()!.ticomCancelledByName ? 'text-purple-500' : selectedReservation()!.blockCancelledByName ? 'text-orange-500' : 'text-gray-400'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  <div>
                    @if (selectedReservation()!.ticomCancelledByName) {
                      <!-- Cancelled by TICOM -->
                      @if (isTicom) {
                        <p class="text-sm font-medium text-purple-800">
                          Cancelada por <strong>{{ selectedReservation()!.ticomCancelledByName }}</strong> (TICOM){{ selectedReservation()!.ticomCancelledAt ? ' el ' + formatDateTime(selectedReservation()!.ticomCancelledAt!) : '' }}
                        </p>
                        <p class="text-xs text-purple-600 mt-0.5"><strong>Motivo:</strong> {{ selectedReservation()!.ticomCancellationReason }}</p>
                        <p class="text-xs text-purple-400 mt-1">El solicitante y Ayudantía fueron notificados. La cancelación es definitiva.</p>
                      } @else if (isAyudantia) {
                        <p class="text-sm font-medium text-purple-800">
                          Cancelada por TICOM — <strong>{{ selectedReservation()!.ticomCancelledByName }}</strong>{{ selectedReservation()!.ticomCancelledAt ? ' el ' + formatDateTime(selectedReservation()!.ticomCancelledAt!) : '' }}
                        </p>
                        <p class="text-xs text-purple-600 mt-0.5"><strong>Motivo técnico:</strong> {{ selectedReservation()!.ticomCancellationReason }}</p>
                        <p class="text-xs text-purple-400 mt-1">El solicitante fue notificado. La cancelación es definitiva.</p>
                      } @else {
                        <p class="text-sm font-medium text-purple-800">
                          Videoconferencia cancelada por TICOM{{ selectedReservation()!.ticomCancelledAt ? ' el ' + formatDateTime(selectedReservation()!.ticomCancelledAt!) : '' }}
                        </p>
                        <p class="text-xs text-purple-600 mt-0.5"><strong>Motivo:</strong> {{ selectedReservation()!.ticomCancellationReason }}</p>
                        <p class="text-xs text-purple-400 mt-1">Esta cancelación es definitiva. Si necesitas coordinar la videoconferencia, crea una nueva solicitud en otra fecha u horario.</p>
                      }
                    } @else if (selectedReservation()!.blockCancelledByName) {
                      <!-- Cancelled by AYUDANTIA block -->
                      <p class="text-sm font-medium text-orange-800">
                        Cancelada por bloqueo de horario — <strong>{{ selectedReservation()!.blockCancelledByName }}</strong>
                        ({{ selectedReservation()!.blockCancelledByGroup }}){{ selectedReservation()!.blockCancelledAt ? ' el ' + formatDateTime(selectedReservation()!.blockCancelledAt!) : '' }}
                      </p>
                      <p class="text-xs text-orange-700 mt-0.5"><strong>Motivo:</strong> {{ selectedReservation()!.blockCancellationReason }}</p>
                      @if (!isOwnReservation(selectedReservation()!)) {
                        <p class="text-xs text-orange-400 mt-1">El solicitante fue notificado por correo.</p>
                      }
                    } @else {
                      <!-- Cancelled by creator -->
                      @if (isOwnReservation(selectedReservation()!)) {
                        <p class="text-sm font-medium text-gray-700">Cancelaste esta solicitud{{ selectedReservation()!.creatorCancelledAt ? ' el ' + formatDateTime(selectedReservation()!.creatorCancelledAt!) : '' }}</p>
                        <p class="text-xs text-gray-500 mt-0.5">El horario quedó libre para otros usuarios.</p>
                      } @else {
                        <p class="text-sm font-medium text-gray-700">Cancelada por el solicitante{{ selectedReservation()!.creatorCancelledAt ? ' el ' + formatDateTime(selectedReservation()!.creatorCancelledAt!) : '' }}</p>
                        <p class="text-xs text-gray-500 mt-0.5">El solicitante canceló su propia reserva.</p>
                      }
                    }
                  </div>
                </div>
              }
              @if (resolvedStatus(selectedReservation()!) === 'confirmada' || resolvedStatus(selectedReservation()!) === 'finalizada') {
                <div class="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                  <svg class="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    @if (isTicom) {
                      <p class="text-sm font-medium text-green-800">Confirmaste esta solicitud</p>
                      <p class="text-xs text-green-600 mt-0.5">
                        Confirmada por <strong>{{ selectedReservation()!.ticomConfirmedByName }}</strong> (TICOM){{ selectedReservation()!.ticomConfirmedAt ? ' el ' + formatDateTime(selectedReservation()!.ticomConfirmedAt!) : '' }}.
                        El solicitante fue notificado por correo.
                      </p>
                    } @else if (isAyudantia) {
                      <p class="text-sm font-medium text-green-800">Solicitud confirmada por TICOM</p>
                      <p class="text-xs text-green-600 mt-0.5">
                        Aprobada por <strong>{{ selectedReservation()!.ayudantiaApprovedByName }}</strong> ({{ selectedReservation()!.ayudantiaApprovedByGroup }})
                        y confirmada por <strong>{{ selectedReservation()!.ticomConfirmedByName }}</strong> (TICOM){{ selectedReservation()!.ticomConfirmedAt ? ' el ' + formatDateTime(selectedReservation()!.ticomConfirmedAt!) : '' }}.
                        El solicitante fue notificado.
                      </p>
                    } @else {
                      <p class="text-sm font-medium text-green-800">Videoconferencia confirmada</p>
                      <p class="text-xs text-green-600 mt-0.5">
                        Aprobada por <strong>{{ selectedReservation()!.ayudantiaApprovedByName }}</strong> ({{ selectedReservation()!.ayudantiaApprovedByGroup }})
                        y confirmada por <strong>{{ selectedReservation()!.ticomConfirmedByName }}</strong> (TICOM){{ selectedReservation()!.ticomConfirmedAt ? ' el ' + formatDateTime(selectedReservation()!.ticomConfirmedAt!) : '' }}.
                        El equipamiento estará listo para tu videoconferencia.
                      </p>
                    }
                  </div>
                </div>
              }

              <!-- Creator -->
              <div class="flex items-center gap-3">
                @if (selectedReservation()!.creatorAvatar) {
                  <img [src]="selectedReservation()!.creatorAvatar" class="h-10 w-10 rounded-full object-cover" alt="" />
                } @else {
                  <span class="h-10 w-10 rounded-full bg-teal-600 flex items-center justify-center text-white text-sm font-bold">
                    {{ initials(selectedReservation()!.creatorName) }}
                  </span>
                }
                <div>
                  <p class="text-sm font-medium text-gray-800">{{ selectedReservation()!.creatorName }}</p>
                  <p class="text-xs text-gray-400">Creada el {{ formatDateTime(selectedReservation()!.createdAt) }}</p>
                </div>
              </div>

              <!-- Date/Time/Duration -->
              <div class="bg-gray-50 rounded-lg p-4 grid grid-cols-3 gap-4">
                <div>
                  <p class="text-xs text-gray-500 uppercase font-semibold">Fecha</p>
                  <p class="text-sm text-gray-800 font-medium mt-0.5">{{ formatDateFull(selectedReservation()!.date) }}</p>
                </div>
                <div>
                  <p class="text-xs text-gray-500 uppercase font-semibold">Horario</p>
                  <p class="text-sm text-gray-800 font-medium mt-0.5">{{ selectedReservation()!.startTime }} - {{ selectedReservation()!.endTime }}</p>
                </div>
                <div>
                  <p class="text-xs text-gray-500 uppercase font-semibold">Duración</p>
                  <p class="text-sm text-gray-800 font-medium mt-0.5">{{ durationLabel(selectedReservation()!.durationHours) }}</p>
                </div>
              </div>

              <!-- Location & Equipment -->
              <div class="grid grid-cols-2 gap-4">
                <div class="bg-gray-50 rounded-lg p-4 flex items-center gap-3">
                  <svg class="h-6 w-6 text-teal-600 flex-shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10">
                    <path d="M21.5.5h-20v13h20zm-16 19l-2 1l-2-1V17l2-1l2 1zm1 4l-1-2h-4l-1 2zm7-4l-2 1l-2-1V17l2-1l2 1zm1 4l-1-2h-4l-1 2zm7-4l-2 1l-2-1V17l2-1l2 1zm1 4l-1-2h-4l-1 2z"/>
                    <path d="m14.5 8l-3 1.5l-3-1.5V4l3-1.5l3 1.5z"/>
                    <path d="M8.5 4L11 5.5h3.5m2 8V12l-5-1.5l-5 1.5v1.5"/>
                  </svg>
                  <p class="text-sm font-medium text-gray-800">{{ locationLabel(selectedReservation()!.location) }}</p>
                </div>
                <div class="bg-gray-50 rounded-lg p-4 flex items-center gap-3">
                  @if (selectedReservation()!.equipmentType === 'notebook') {
                    <svg class="h-6 w-6 text-teal-600 flex-shrink-0" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4">
                      <path d="M8 8h32v20H8zm0 20L4 41h40l-4-13"/>
                      <path d="M19.9 35h8.2l1.9 6H18z"/>
                    </svg>
                  } @else {
                    <div class="flex items-center gap-1 flex-shrink-0">
                      <svg class="h-6 w-6 text-teal-600" viewBox="0 0 1024 640" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                        <path d="M896 576h-64q0 26-18.5 45t-45 19t-45.5-19t-19-45H320q0 26-18.5 45t-45 19t-45.5-19t-19-45h-64q-53 0-90.5-37.5T0 448V256q0-53 37.5-90.5T128 128h22q27-58 81.5-93T352 0t120.5 35t81.5 93h342q53 0 90.5 37.5T1024 256v192q0 53-37.5 90.5T896 576M352 64q-66 0-113 47t-47 113t47 113t113 47t113-47t47-113t-47-113t-113-47m384 192q-13 0-22.5 9.5T704 288t9.5 22.5T736 320t22.5-9.5T768 288t-9.5-22.5T736 256m128 0q-13 0-22.5 9.5T832 288t9.5 22.5T864 320t22.5-9.5T896 288t-9.5-22.5T864 256"/>
                      </svg>
                      <svg class="h-6 w-6 text-teal-600" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                        <path d="M20 2H4c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1h1v9h6v2.59l-4.21 4.2l1.42 1.42l2.79-2.8V22h2v-2.59l2.79 2.8l1.42-1.42l-4.21-4.2V14h6V5h1c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1m-3 10H7V5h10z"/>
                      </svg>
                      <svg class="h-6 w-6 text-teal-600" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4">
                        <path d="M8 8h32v20H8zm0 20L4 41h40l-4-13"/>
                        <path d="M19.9 35h8.2l1.9 6H18z"/>
                      </svg>
                    </div>
                  }
                  <p class="text-sm font-medium text-gray-800">{{ equipmentLabel(selectedReservation()!.equipmentType) }}</p>
                </div>
              </div>

              <!-- Conference URL -->
              @if (selectedReservation()!.conferenceUrl) {
                <div>
                  <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">URL de videoconferencia</h4>
                  <a [href]="selectedReservation()!.conferenceUrl" target="_blank" rel="noopener"
                    class="text-sm text-teal-600 hover:underline break-all">{{ selectedReservation()!.conferenceUrl }}</a>
                </div>
              }

              <!-- Historial de gestión -->
              @if (selectedReservation()!.ayudantiaApprovedByName || selectedReservation()!.rejectedByName || selectedReservation()!.ticomConfirmedByName || selectedReservation()!.ticomCancelledByName || selectedReservation()!.creatorCancelledAt || selectedReservation()!.blockCancelledByName) {
                <div class="border-t border-gray-100 pt-4 space-y-3">
                  <h4 class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Historial de gestión</h4>

                  @if (selectedReservation()!.ayudantiaApprovedByName) {
                    <div class="flex items-start gap-3">
                      <div class="h-7 w-7 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg class="h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p class="text-sm font-medium text-gray-800">Aprobada por Ayudantía</p>
                        <p class="text-xs text-gray-600">{{ selectedReservation()!.ayudantiaApprovedByName }} <span class="text-gray-400">({{ selectedReservation()!.ayudantiaApprovedByGroup }})</span></p>
                        @if (selectedReservation()!.ayudantiaApprovedAt) {
                          <p class="text-xs text-gray-400 mt-0.5">{{ formatDateTime(selectedReservation()!.ayudantiaApprovedAt!) }}</p>
                        }
                      </div>
                    </div>
                  }

                  @if (selectedReservation()!.ticomConfirmedByName) {
                    <div class="flex items-start gap-3">
                      <div class="h-7 w-7 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg class="h-3.5 w-3.5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4" />
                        </svg>
                      </div>
                      <div>
                        <p class="text-sm font-medium text-gray-800">Confirmada por TICOM</p>
                        <p class="text-xs text-gray-600">{{ selectedReservation()!.ticomConfirmedByName }} <span class="text-gray-400">(TICOM)</span></p>
                        @if (selectedReservation()!.ticomConfirmedAt) {
                          <p class="text-xs text-gray-400 mt-0.5">{{ formatDateTime(selectedReservation()!.ticomConfirmedAt!) }}</p>
                        }
                      </div>
                    </div>
                  }

                  @if (selectedReservation()!.rejectedByName) {
                    <div class="flex items-start gap-3">
                      <div class="h-7 w-7 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg class="h-3.5 w-3.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                      <div>
                        <p class="text-sm font-medium text-gray-800">Rechazada por Ayudantía</p>
                        <p class="text-xs text-gray-600">{{ selectedReservation()!.rejectedByName }} <span class="text-gray-400">({{ selectedReservation()!.rejectedByGroup }})</span></p>
                        @if (selectedReservation()!.rejectedAt) {
                          <p class="text-xs text-gray-400 mt-0.5">{{ formatDateTime(selectedReservation()!.rejectedAt!) }}</p>
                        }
                        <p class="text-xs text-red-500 mt-1"><strong>Motivo:</strong> {{ selectedReservation()!.rejectionReason }}</p>
                      </div>
                    </div>
                  }

                  @if (selectedReservation()!.creatorCancelledAt) {
                    <div class="flex items-start gap-3">
                      <div class="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg class="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                      <div>
                        <p class="text-sm font-medium text-gray-800">Cancelada por el solicitante</p>
                        <p class="text-xs text-gray-600">{{ selectedReservation()!.creatorName }}</p>
                        <p class="text-xs text-gray-400 mt-0.5">{{ formatDateTime(selectedReservation()!.creatorCancelledAt!) }}</p>
                      </div>
                    </div>
                  }

                  @if (selectedReservation()!.ticomCancelledByName) {
                    <div class="flex items-start gap-3">
                      <div class="h-7 w-7 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg class="h-3.5 w-3.5 text-purple-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </div>
                      <div>
                        <p class="text-sm font-medium text-gray-800">Cancelada por TICOM <span class="text-xs font-normal text-purple-600">(definitiva)</span></p>
                        <p class="text-xs text-gray-600">{{ selectedReservation()!.ticomCancelledByName }} <span class="text-gray-400">(TICOM)</span></p>
                        @if (selectedReservation()!.ticomCancelledAt) {
                          <p class="text-xs text-gray-400 mt-0.5">{{ formatDateTime(selectedReservation()!.ticomCancelledAt!) }}</p>
                        }
                        <p class="text-xs text-purple-600 mt-1"><strong>Motivo:</strong> {{ selectedReservation()!.ticomCancellationReason }}</p>
                      </div>
                    </div>
                  }

                  @if (selectedReservation()!.blockCancelledByName) {
                    <div class="flex items-start gap-3">
                      <div class="h-7 w-7 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg class="h-3.5 w-3.5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </div>
                      <div>
                        <p class="text-sm font-medium text-gray-800">Cancelada por bloqueo de horario <span class="text-xs font-normal text-orange-600">(Ayudantía)</span></p>
                        <p class="text-xs text-gray-600">{{ selectedReservation()!.blockCancelledByName }} <span class="text-gray-400">({{ selectedReservation()!.blockCancelledByGroup }})</span></p>
                        @if (selectedReservation()!.blockCancelledAt) {
                          <p class="text-xs text-gray-400 mt-0.5">{{ formatDateTime(selectedReservation()!.blockCancelledAt!) }}</p>
                        }
                        <p class="text-xs text-orange-600 mt-1"><strong>Motivo:</strong> {{ selectedReservation()!.blockCancellationReason }}</p>
                      </div>
                    </div>
                  }

                </div>
              }

              <!-- Action buttons -->
              <div class="flex flex-wrap gap-3 pt-1">

                <!-- AYUDANTIA approve/reject (for pendiente_ayudantia reservations of their location) -->
                @if (canApproveOrReject(selectedReservation()!)) {
                  <button (click)="approveReservation()" [disabled]="actionLoading()"
                    class="px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-40">
                    @if (actionLoading()) {
                      <svg class="h-4 w-4 animate-spin inline mr-1" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    }
                    Aprobar
                  </button>
                  <button (click)="openRejectModal()" [disabled]="actionLoading()"
                    class="px-5 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40">
                    Rechazar
                  </button>
                }

                <!-- TICOM confirm (only for pendiente_ticom) -->
                @if (isTicom && selectedReservation()!.status === 'pendiente_ticom') {
                  <button (click)="confirmReservation()" [disabled]="actionLoading()"
                    class="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40">
                    @if (actionLoading()) {
                      <svg class="h-4 w-4 animate-spin inline mr-1" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    }
                    Confirmar reserva
                  </button>
                }
                <!-- TICOM cancel by technical reason (pendiente_ticom or confirmada) -->
                @if (isTicom && (selectedReservation()!.status === 'pendiente_ticom' || selectedReservation()!.status === 'confirmada')) {
                  <button (click)="openTicomCancelModal()" [disabled]="actionLoading()"
                    class="px-5 py-2.5 bg-purple-700 text-white text-sm font-medium rounded-lg hover:bg-purple-800 transition-colors disabled:opacity-40">
                    Cancelar por impedimento técnico
                  </button>
                }

                <!-- Creator edit rejected reservation -->
                @if (isOwnReservation(selectedReservation()!) && selectedReservation()!.status === 'rechazada') {
                  <button (click)="editReservation(selectedReservation()!)"
                    class="px-5 py-2.5 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors">
                    Editar y reenviar
                  </button>
                }

                <!-- Creator cancel own reservation (any active status) -->
                @if (isOwnReservation(selectedReservation()!) && (selectedReservation()!.status === 'pendiente_ayudantia' || selectedReservation()!.status === 'pendiente_ticom' || selectedReservation()!.status === 'confirmada')) {
                  <button (click)="showCancelConfirmModal.set(true)" [disabled]="actionLoading()"
                    class="px-5 py-2.5 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40">
                    Cancelar solicitud
                  </button>
                }

              </div>
            </div>
          </div>

        } @else {
          <!-- Empty state -->
          <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <svg class="h-12 w-12 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p class="text-sm text-gray-400">
              {{ canCreate ? 'Selecciona una reserva o crea una nueva' : isAyudantia ? 'Selecciona una reserva o bloquea un horario' : 'Selecciona una reserva para ver su detalle' }}
            </p>
          </div>
        }
      </div>
    </div>
  `,
})
export class ReservationsComponent implements OnInit {
  readonly reservationsService = inject(ReservationsService);
  private readonly authService = inject(AuthService);

  readonly selectedReservation = signal<Reservation | null>(null);
  readonly showCreateForm = signal(false);
  readonly filterStatus = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly actionLoading = signal(false);
  readonly availabilityChecked = signal(false);
  readonly isAvailable = signal(false);
  readonly conflictMessage = signal('');
  readonly showRejectModal = signal(false);
  readonly showTicomCancelModal = signal(false);
  readonly showCancelConfirmModal = signal(false);
  readonly errorMessage = signal('');
  readonly editingReservationId = signal<string | null>(null);

  readonly showBlockForm = signal(false);
  readonly selectedBlock = signal<BlockedPeriod | null>(null);
  readonly blockedPeriods = signal<BlockedPeriod[]>([]);
  readonly blockSubmitting = signal(false);
  readonly blockSuccess = signal('');

  // Block form fields
  blockDate = '';
  blockStartTime = '';
  blockEndTime = '';
  blockReason = '';

  // Form fields
  formDate = '';
  formStartTime = '';
  formDuration = 0;
  formLocation: 'piso_8' | 'piso_6' | '' = '';
  formEquipment: 'notebook' | 'equipo_completo' | '' = '';
  formConferenceUrl = '';
  rejectReason = '';
  ticomCancelReason = '';

  readonly todayStr = new Date().toISOString().split('T')[0];

  readonly durations = [
    { value: 1, label: '1 h' },
    { value: 1.5, label: '1½ h' },
    { value: 2, label: '2 h' },
    { value: 2.5, label: '2½ h' },
    { value: 3, label: '3 h' },
    { value: 3.5, label: '3½ h' },
    { value: 4, label: '4 h' },
  ];

  get isTicom(): boolean {
    return this.reservationsService.isTicom;
  }

  get isAyudantiaDiredtos(): boolean {
    return this.reservationsService.isAyudantiaDiredtos;
  }

  get isAyudantiaRectorado(): boolean {
    return this.reservationsService.isAyudantiaRectorado;
  }

  get isAyudantia(): boolean {
    return this.reservationsService.isAyudantia;
  }

  /** Regular users can create; staff roles only view/approve/confirm */
  get canCreate(): boolean {
    return !this.isTicom && !this.isAyudantia;
  }

  get sidebarTitle(): string {
    if (this.isTicom) return 'Reservas';
    if (this.isAyudantiaDiredtos) return 'Reservas - Piso 8';
    if (this.isAyudantiaRectorado) return 'Reservas - Piso 6';
    return 'Mis reservas';
  }

  readonly filteredReservations = computed(() => {
    const status = this.filterStatus();
    const all = this.reservationsService.reservations();
    if (!status) return all;
    // "pendiente" tab matches both pending statuses
    if (status === 'pendiente') {
      return all.filter((r) => {
        const s = this.resolvedStatus(r);
        return s === 'pendiente_ayudantia' || s === 'pendiente_ticom';
      });
    }
    return all.filter((r) => this.resolvedStatus(r) === status);
  });

  canSubmit(): boolean {
    return (
      !this.submitting() &&
      !!this.formDate &&
      !!this.formStartTime &&
      this.formDuration > 0 &&
      !!this.formLocation &&
      !!this.formEquipment &&
      this.availabilityChecked() &&
      this.isAvailable()
    );
  }

  constructor() {
    effect(() => {
      const selected = this.selectedReservation();
      if (!selected) return;
      const updated = this.reservationsService.reservations().find((r) => r.id === selected.id);
      if (updated && updated !== selected) {
        this.selectedReservation.set(updated);
      }
    });
  }

  ngOnInit(): void {
    if (!this.reservationsService.isConnected()) {
      this.reservationsService.connect();
    }
    this.reservationsService.loadReservations();
    if (this.isAyudantia) {
      this.loadBlockedPeriods();
    }
  }

  selectReservation(res: Reservation): void {
    this.selectedReservation.set(res);
    this.showCreateForm.set(false);
    this.showBlockForm.set(false);
    this.selectedBlock.set(null);
  }

  openCreateForm(): void {
    this.showCreateForm.set(true);
    this.selectedReservation.set(null);
    this.selectedBlock.set(null);
    this.showBlockForm.set(false);
    this.editingReservationId.set(null);
    this.resetForm();
  }

  cancelCreate(): void {
    this.showCreateForm.set(false);
    this.editingReservationId.set(null);
    this.resetForm();
  }

  openBlockForm(): void {
    this.showBlockForm.set(true);
    this.showCreateForm.set(false);
    this.selectedReservation.set(null);
    this.selectedBlock.set(null);
    this.blockDate = '';
    this.blockStartTime = '';
    this.blockEndTime = '';
    this.blockReason = '';
    this.blockSuccess.set('');
    this.errorMessage.set('');
  }

  cancelBlockForm(): void {
    this.showBlockForm.set(false);
  }

  selectBlock(block: BlockedPeriod): void {
    this.selectedBlock.set(block);
    this.showBlockForm.set(false);
    this.showCreateForm.set(false);
    this.selectedReservation.set(null);
  }

  loadBlockedPeriods(): void {
    if (!this.isAyudantia) return;
    const location = this.isAyudantiaDiredtos ? 'piso_8' : 'piso_6';
    this.reservationsService.getBlockedPeriods(location).subscribe({
      next: (blocks) => this.blockedPeriods.set(blocks),
    });
  }

  submitBlock(): void {
    if (this.blockSubmitting()) return;
    this.blockSubmitting.set(true);
    this.errorMessage.set('');
    const dto: CreateBlockedPeriodDto = {
      date: this.blockDate,
      startTime: this.blockStartTime,
      endTime: this.blockEndTime,
      reason: this.blockReason.trim(),
    };
    this.reservationsService.createBlockedPeriod(dto).subscribe({
      next: ({ cancelledCount }) => {
        this.blockSubmitting.set(false);
        this.showBlockForm.set(false);
        this.loadBlockedPeriods();
        this.blockSuccess.set(
          cancelledCount > 0
            ? `Bloqueo creado. Se cancelaron ${cancelledCount} reserva${cancelledCount > 1 ? 's' : ''} afectada${cancelledCount > 1 ? 's' : ''}.`
            : 'Bloqueo de horario creado correctamente.'
        );
        setTimeout(() => this.blockSuccess.set(''), 5000);
      },
      error: (err) => {
        this.blockSubmitting.set(false);
        this.errorMessage.set(err?.error?.message ?? 'Error al crear el bloqueo');
      },
    });
  }

  deleteBlock(id: string): void {
    this.reservationsService.deleteBlockedPeriod(id).subscribe({
      next: () => {
        this.selectedBlock.set(null);
        this.loadBlockedPeriods();
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message ?? 'Error al eliminar el bloqueo');
      },
    });
  }

  editReservation(res: Reservation): void {
    this.editingReservationId.set(res.id);
    this.formDate = res.date;
    this.formStartTime = res.startTime;
    this.formDuration = Number(res.durationHours);
    this.formLocation = res.location;
    this.formEquipment = res.equipmentType;
    this.formConferenceUrl = res.conferenceUrl ?? '';
    this.showCreateForm.set(true);
    this.selectedReservation.set(null);
    this.checkAvailability();
  }

  onFormChange(): void {
    this.availabilityChecked.set(false);
    this.isAvailable.set(false);
    this.conflictMessage.set('');
    if (this.formDate && this.formStartTime && this.formDuration > 0 && this.formLocation && this.formEquipment) {
      this.checkAvailability();
    }
  }

  checkAvailability(): void {
    forkJoin({
      reservations: this.reservationsService.checkAvailability(this.formDate),
      blocks: this.reservationsService.getBlockedPeriods(this.formLocation || undefined, this.formDate),
    }).subscribe({
      next: ({ reservations, blocks }) => {
        const endTime = this.computeEndTime(this.formStartTime, this.formDuration);
        const editId = this.editingReservationId();
        const filteredExisting = editId ? reservations.filter((r) => r.id !== editId) : reservations;
        const reservationConflict = this.findConflict(filteredExisting, this.formStartTime, endTime, this.formLocation);
        const blockConflict = blocks.find((b) => b.startTime < endTime && b.endTime > this.formStartTime);

        this.availabilityChecked.set(true);
        if (blockConflict) {
          this.isAvailable.set(false);
          this.conflictMessage.set(
            `Horario bloqueado por ${blockConflict.createdByGroup}: ${blockConflict.reason} (${blockConflict.startTime}–${blockConflict.endTime})`
          );
        } else if (reservationConflict) {
          this.isAvailable.set(false);
          this.conflictMessage.set(reservationConflict);
        } else {
          this.isAvailable.set(true);
          this.conflictMessage.set('');
        }
      },
      error: () => {
        this.availabilityChecked.set(true);
        this.isAvailable.set(true);
      },
    });
  }

  private findConflict(
    existing: Reservation[],
    startTime: string,
    endTime: string,
    location: string,
  ): string | null {
    for (const r of existing) {
      if (r.location === location) {
        if (r.startTime < endTime && r.endTime > startTime) {
          return `Horario ocupado en ${this.locationLabel(r.location)} (${r.startTime} - ${r.endTime})`;
        }
      } else {
        const endTimePlus30 = this.addMinutes(endTime, 30);
        const rEndPlus30 = this.addMinutes(r.endTime, 30);
        if (r.startTime < endTimePlus30 && rEndPlus30 > startTime) {
          return `Se requieren 30 min de margen con la reserva de ${this.locationLabel(r.location)} (${r.startTime} - ${r.endTime}) para trasladar equipos`;
        }
      }
    }
    return null;
  }

  submitReservation(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    const dto: CreateReservationDto = {
      date: this.formDate,
      startTime: this.formStartTime,
      durationHours: this.formDuration,
      location: this.formLocation as 'piso_8' | 'piso_6',
      equipmentType: this.formEquipment as 'notebook' | 'equipo_completo',
      conferenceUrl: this.formConferenceUrl.trim() || undefined,
    };

    const editId = this.editingReservationId();
    const obs = editId
      ? this.reservationsService.updateReservation(editId, dto)
      : this.reservationsService.createReservation(dto);

    obs.subscribe({
      next: () => {
        this.submitting.set(false);
        this.cancelCreate();
        this.reservationsService.loadReservations();
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err?.error?.message ?? 'Error al guardar la reserva');
      },
    });
  }

  approveReservation(): void {
    const res = this.selectedReservation();
    if (!res) return;
    this.actionLoading.set(true);
    this.reservationsService.approveReservation(res.id).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.selectedReservation.set(updated);
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.errorMessage.set(err?.error?.message ?? 'No se pudo aprobar la reserva');
      },
    });
  }

  openRejectModal(): void {
    this.rejectReason = '';
    this.showRejectModal.set(true);
  }

  confirmReject(): void {
    const res = this.selectedReservation();
    if (!res || !this.rejectReason.trim()) return;
    this.actionLoading.set(true);
    this.reservationsService.rejectReservation(res.id, this.rejectReason.trim()).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.showRejectModal.set(false);
        this.selectedReservation.set(updated);
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.errorMessage.set(err?.error?.message ?? 'No se pudo rechazar la reserva');
      },
    });
  }

  cancelOwnReservation(): void {
    const res = this.selectedReservation();
    if (!res) return;
    this.actionLoading.set(true);
    this.showCancelConfirmModal.set(false);
    this.reservationsService.cancelReservation(res.id).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.selectedReservation.set(updated);
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.errorMessage.set(err?.error?.message ?? 'No se pudo cancelar la solicitud');
      },
    });
  }

  openTicomCancelModal(): void {
    this.ticomCancelReason = '';
    this.showTicomCancelModal.set(true);
  }

  confirmTicomCancel(): void {
    const res = this.selectedReservation();
    if (!res || !this.ticomCancelReason.trim()) return;
    this.actionLoading.set(true);
    this.reservationsService.ticomCancelReservation(res.id, this.ticomCancelReason.trim()).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.showTicomCancelModal.set(false);
        this.selectedReservation.set(updated);
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.errorMessage.set(err?.error?.message ?? 'No se pudo cancelar la reserva');
      },
    });
  }

  confirmReservation(): void {
    const res = this.selectedReservation();
    if (!res) return;
    this.actionLoading.set(true);
    this.reservationsService.confirmReservation(res.id).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.selectedReservation.set(updated);
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.errorMessage.set(err?.error?.message ?? 'No se pudo confirmar la reserva');
      },
    });
  }

  /** Returns true if the current user can approve or reject this reservation */
  canApproveOrReject(res: Reservation): boolean {
    if (res.status !== 'pendiente_ayudantia') return false;
    if (this.isAyudantiaDiredtos && res.location === 'piso_8') return true;
    if (this.isAyudantiaRectorado && res.location === 'piso_6') return true;
    return false;
  }

  isOwnReservation(res: Reservation): boolean {
    return res.creatorId === this.authService.currentUser()?.id;
  }

  // Helpers
  private resetForm(): void {
    this.formDate = '';
    this.formStartTime = '';
    this.formDuration = 0;
    this.formLocation = '';
    this.formEquipment = '';
    this.formConferenceUrl = '';
    this.availabilityChecked.set(false);
    this.isAvailable.set(false);
    this.conflictMessage.set('');
  }

  private computeEndTime(startTime: string, durationHours: number): string {
    return this.addMinutes(startTime, durationHours * 60);
  }

  private addMinutes(time: string, minutes: number): string {
    const [h, m] = time.split(':').map(Number);
    let total = h * 60 + m + minutes;
    if (total < 0) total = 0;
    const endH = Math.floor(total / 60) % 24;
    const endM = total % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  }

  locationLabel(loc: string): string {
    return loc === 'piso_8' ? 'Sala de conferencias - Piso 8' : 'Sala de conferencias - Piso 6';
  }

  equipmentLabel(eq: string): string {
    return eq === 'notebook' ? 'Notebook' : 'Equipo completo';
  }

  /** Returns 'finalizada' if the reservation's end datetime has already passed */
  resolvedStatus(res: Reservation): string {
    const now = new Date();
    const endDateTime = new Date(`${res.date}T${res.endTime}`);
    if (endDateTime < now && res.status === 'confirmada') return 'finalizada';
    return res.status;
  }

  statusLabel(status: string): string {
    if (status === 'pendiente_ayudantia') return 'Pend. aprobación';
    if (status === 'pendiente_ticom') return 'Pend. TICOM';
    if (status === 'confirmada') return 'Confirmada';
    if (status === 'rechazada') return 'Rechazada';
    if (status === 'cancelada') return 'Cancelada';
    if (status === 'finalizada') return 'Finalizada';
    return status;
  }

  statusBadgeClass(status: string): string {
    if (status === 'pendiente_ayudantia') return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700';
    if (status === 'pendiente_ticom') return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700';
    if (status === 'confirmada') return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700';
    if (status === 'rechazada') return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700';
    if (status === 'cancelada') return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700';
    return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500';
  }

  durationLabel(hours: number): string {
    const h = Math.floor(hours);
    const m = (hours - h) * 60;
    if (m === 0) return `${h} h`;
    return `${h}h ${m}min`;
  }

  formatDateShort(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
  }

  formatDateFull(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
