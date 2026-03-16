import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReservationsService, Reservation } from '../../core/services/reservations.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
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
          <button (click)="filterStatus.set('recibida')"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-green-700]="filterStatus() === 'recibida'"
            [class.border-b-2]="filterStatus() === 'recibida'"
            [class.border-green-500]="filterStatus() === 'recibida'"
            [class.font-semibold]="filterStatus() === 'recibida'"
            [class.text-gray-500]="filterStatus() !== 'recibida'">
            Recibidas
          </button>
          <button (click)="filterStatus.set('finalizada')"
            class="flex-1 py-2 text-center transition-colors"
            [class.text-gray-600]="filterStatus() === 'finalizada'"
            [class.border-b-2]="filterStatus() === 'finalizada'"
            [class.border-gray-500]="filterStatus() === 'finalizada'"
            [class.font-semibold]="filterStatus() === 'finalizada'"
            [class.text-gray-500]="filterStatus() !== 'finalizada'">
            Finalizadas
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
        </div>
      </aside>

      <!-- Detail / Create panel -->
      <div class="flex-1 flex flex-col">
        @if (showCreateForm()) {
          <!-- Create form -->
          <div class="px-5 py-3 border-b border-gray-200 flex-shrink-0">
            <h3 class="text-sm font-semibold text-gray-800">Nueva reserva</h3>
          </div>
          <div class="flex-1 overflow-y-auto p-6">
            <div class="max-w-2xl space-y-5">

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
                  <!-- Notebook -->
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
                  <!-- Equipo completo -->
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
                    Reservando...
                  } @else {
                    Crear reserva
                  }
                </button>
                <button (click)="cancelCreate()"
                  class="px-6 py-2.5 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  Cancelar
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
                  <div>
                    <p class="text-sm font-medium text-gray-800">{{ locationLabel(selectedReservation()!.location) }}</p>
                  </div>
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
                  <div>
                    <p class="text-sm font-medium text-gray-800">{{ equipmentLabel(selectedReservation()!.equipmentType) }}</p>
                  </div>
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

              <!-- Technician info -->
              @if (selectedReservation()!.technicianName) {
                <div class="bg-green-50 rounded-lg p-4">
                  <h4 class="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">Recibida por</h4>
                  <p class="text-sm text-green-800 font-medium">{{ selectedReservation()!.technicianName }}</p>
                  @if (selectedReservation()!.acknowledgedAt) {
                    <p class="text-xs text-green-500 mt-0.5">{{ formatDateTime(selectedReservation()!.acknowledgedAt!) }}</p>
                  }
                </div>
              }

              <!-- TICOM action -->
              @if (isTicom && selectedReservation()!.status === 'pendiente') {
                <button (click)="acknowledgeReservation()" [disabled]="actionLoading()"
                  class="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40">
                  @if (actionLoading()) {
                    <svg class="h-4 w-4 animate-spin inline mr-2" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  }
                  Recibir reserva
                </button>
              }
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
              {{ canCreate ? 'Selecciona una reserva o crea una nueva' : 'Selecciona una reserva para ver su detalle' }}
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

  // Form fields
  formDate = '';
  formStartTime = '';
  formDuration = 0;
  formLocation: 'piso_8' | 'piso_6' | '' = '';
  formEquipment: 'notebook' | 'equipo_completo' | '' = '';
  formConferenceUrl = '';

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

  get isAyudantia(): boolean {
    return this.reservationsService.isAyudantia;
  }

  /** Regular users can create; TICOM and AYUDANTIA only view */
  get canCreate(): boolean {
    return !this.isTicom && !this.isAyudantia;
  }

  get sidebarTitle(): string {
    if (this.isTicom) return 'Reservas';
    if (this.isAyudantia) return 'Reservas - Piso 8';
    return 'Mis reservas';
  }

  readonly filteredReservations = computed(() => {
    const status = this.filterStatus();
    const all = this.reservationsService.reservations();
    if (!status) return all;
    return all.filter((r) => this.resolvedStatus(r) === status);
  });

  readonly canSubmit = computed(() => {
    const submitting = this.submitting();
    const checked = this.availabilityChecked();
    const available = this.isAvailable();
    return !submitting &&
      !!this.formDate &&
      !!this.formStartTime &&
      this.formDuration > 0 &&
      !!this.formLocation &&
      !!this.formEquipment &&
      checked &&
      available;
  });

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
    // TICOM sees all, AYUDANTIA sees piso_8 (backend filters), regular users see own
    this.reservationsService.loadReservations(this.reservationsService.hasPrivilegedView ? false : true);
  }

  selectReservation(res: Reservation): void {
    this.selectedReservation.set(res);
    this.showCreateForm.set(false);
  }

  openCreateForm(): void {
    this.showCreateForm.set(true);
    this.selectedReservation.set(null);
    this.resetForm();
  }

  cancelCreate(): void {
    this.showCreateForm.set(false);
    this.resetForm();
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
    this.reservationsService
      .checkAvailability(this.formDate)
      .subscribe({
        next: (existing) => {
          const endTime = this.computeEndTime(this.formStartTime, this.formDuration);
          const conflict = this.findConflict(existing, this.formStartTime, endTime, this.formLocation);
          this.availabilityChecked.set(true);
          this.isAvailable.set(!conflict);
          if (conflict) {
            this.conflictMessage.set(conflict);
          }
        },
        error: (err) => {
          console.error('Error checking availability:', err);
          this.availabilityChecked.set(true);
          this.isAvailable.set(true);
        },
      });
  }

  /**
   * Equipment is shared across rooms. Notebook is always involved (equipo_completo includes it).
   * 30-min buffer required when reservations are in different rooms.
   */
  private findConflict(
    existing: Reservation[],
    startTime: string,
    endTime: string,
    location: string,
  ): string | null {
    for (const r of existing) {
      if (r.location === location) {
        // Same room: direct time overlap
        if (r.startTime < endTime && r.endTime > startTime) {
          return `Horario ocupado en ${this.locationLabel(r.location)} (${r.startTime} - ${r.endTime})`;
        }
      } else {
        // Different room: 30-min buffer for equipment transport
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
    this.reservationsService
      .createReservation({
        date: this.formDate,
        startTime: this.formStartTime,
        durationHours: this.formDuration,
        location: this.formLocation as 'piso_8' | 'piso_6',
        equipmentType: this.formEquipment as 'notebook' | 'equipo_completo',
        conferenceUrl: this.formConferenceUrl.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.cancelCreate();
          this.reservationsService.loadReservations(true);
        },
        error: (err) => {
          this.submitting.set(false);
          alert(err?.error?.message ?? 'Error al crear la reserva');
        },
      });
  }

  acknowledgeReservation(): void {
    const res = this.selectedReservation();
    if (!res) return;
    this.actionLoading.set(true);
    this.reservationsService.acknowledgeReservation(res.id).subscribe({
      next: (updated) => {
        this.actionLoading.set(false);
        this.selectedReservation.set(updated);
      },
      error: (err) => {
        this.actionLoading.set(false);
        alert(err?.error?.message ?? 'No se pudo recibir la reserva');
      },
    });
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
    if (endDateTime < now) return 'finalizada';
    return res.status;
  }

  statusLabel(status: string): string {
    if (status === 'pendiente') return 'Pendiente';
    if (status === 'recibida') return 'Recibida';
    return 'Finalizada';
  }

  statusBadgeClass(status: string): string {
    if (status === 'pendiente') return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700';
    if (status === 'recibida') return 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700';
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
