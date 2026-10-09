import { Component, DestroyRef, HostListener, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { filter, fromEvent, interval, merge } from 'rxjs';
import { ScanAccount, ScanItem, ScansService } from '../../core/services/scans.service';
import { NotificationsService } from '../../core/services/notifications.service';
import { AppVersionService } from '../../core/services/app-version.service';
import { FileIconComponent } from '../../shared/file-icon/file-icon.component';
import { CometSpinnerComponent } from '../../shared/comet-spinner/comet-spinner.component';
import {
  AttachmentPreviewModalComponent,
  AttachmentPreviewRequest,
} from '../../shared/attachment-preview-modal/attachment-preview-modal.component';
import { formatBytes } from '../../shared/storage-usage/storage-usage.component';

const LAST_OFFICE_KEY = 'pac_scans_office';
/** Cada cuánto se revisa la bandeja con la pestaña a la vista (por si el aviso en vivo no llegó). */
const REFRESH_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pestaña "Escaneos" de Archivos compartidos: lo que las impresoras mandan a la
 * bandeja de la oficina. Se guarda en el servidor (no ocupa el Drive), lo ven
 * solo los integrantes y se borra solo a los 90 días.
 */
@Component({
  selector: 'app-scans-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, FileIconComponent, CometSpinnerComponent, AttachmentPreviewModalComponent],
  host: { class: 'flex flex-col flex-1' },
  template: `
<div class="flex-1 flex flex-col min-h-[24rem] bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-sm relative">

  <!-- Barra: oficina + acciones -->
  <div class="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
    <div class="flex items-center gap-2 flex-wrap min-w-0">
      @if (offices().length > 1) {
        @for (o of offices(); track o) {
          <button (click)="selectOffice(o)"
            class="px-3 py-1 rounded-full text-xs font-semibold border transition-colors"
            [class]="office() === o
              ? 'bg-teal-600 border-teal-600 text-white'
              : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800'">
            {{ o }}
          </button>
        }
      } @else if (office()) {
        <span class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Escaneos de {{ office() }}</span>
      }
    </div>
    <div class="flex items-center gap-2">
      <div class="relative">
        <input [ngModel]="filter()" (ngModelChange)="filter.set($event)" placeholder="Filtrar…" aria-label="Filtrar escaneos"
          class="w-40 sm:w-52 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800
                 text-sm text-gray-900 dark:text-zinc-100 pl-8 pr-3 py-1.5 focus:border-teal-500 focus:ring-teal-500" />
        <svg class="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd"/>
        </svg>
      </div>
      <button (click)="load()" [disabled]="loading()" title="Actualizar" aria-label="Actualizar"
        class="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/>
        </svg>
      </button>
      @if (isTicom) {
        <button (click)="openAccounts()"
          class="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-teal-600 text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/30">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M8 17v4h8v-4"/>
          </svg>
          Configurar impresoras
        </button>
      }
    </div>
  </div>

  <!-- Contenido -->
  @if (!offices().length) {
    <div class="flex-1 flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p class="text-sm text-gray-500 dark:text-zinc-400">No pertenecés a ninguna oficina, así que no tenés bandeja de escaneos.</p>
    </div>
  } @else if (loading() && !scans().length) {
    <div class="flex-1 flex items-center justify-center py-16"><app-comet-spinner [size]="48" /></div>
  } @else if (error()) {
    <div class="m-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">{{ error() }}</div>
  } @else if (!rows().length) {
    <div class="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <svg class="h-14 w-14 text-gray-200 dark:text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 13h10M8 17v4h8v-4"/>
      </svg>
      @if (filter()) {
        <p class="text-sm text-gray-500 dark:text-zinc-400">Ningún escaneo coincide con «{{ filter() }}».</p>
      } @else {
        <p class="text-sm font-medium text-gray-600 dark:text-zinc-300">Todavía no llegó ningún escaneo de {{ office() }}.</p>
        <p class="text-xs text-gray-400 dark:text-zinc-500 max-w-sm">En la impresora, elegí escanear a la carpeta de tu oficina: el archivo aparece acá en unos segundos.</p>
      }
    </div>
  } @else {
    <ul class="divide-y divide-gray-100 dark:divide-zinc-800">
      @for (s of rows(); track s.id) {
        <li class="group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/60"
            [class.scan-fresh]="s.id === highlightId()"
            [attr.id]="'scan-' + s.id"
            (click)="preview(s)" title="Ver">
          <app-file-icon [file]="{ name: s.filename, mimeType: s.contentType }" [size]="36" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{{ s.filename }}</p>
            <p class="text-xs text-gray-500 dark:text-zinc-400">
              {{ formatDate(s.receivedAt) }} · {{ size(s.size) }} ·
              <span [class.text-amber-600]="daysLeft(s) <= 7" [class.font-medium]="daysLeft(s) <= 7">
                {{ daysLeft(s) <= 1 ? 'se borra mañana' : 'se borra en ' + daysLeft(s) + ' días' }}
              </span>
            </p>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0" (click)="$event.stopPropagation()">
            <button (click)="openSave($event, s)" [disabled]="savingId() === s.id"
              class="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold border border-teal-200 dark:border-teal-900 text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/30 disabled:opacity-50"
              title="Guardar una copia en Archivos (la unidad de la oficina o Mis archivos)">
              @if (savingId() === s.id) {
                <app-comet-spinner [size]="14" [thickness]="3" /> Guardando…
              } @else {
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>
                </svg>
                <span class="hidden sm:inline">Guardar en Archivos</span>
              }
            </button>
            <button (click)="scansApi.download(s)" title="Descargar" aria-label="Descargar"
              class="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>
            </button>
            <button (click)="openRename(s)" title="Cambiar el nombre" aria-label="Cambiar el nombre"
              class="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
            </button>
            <button (click)="toDelete.set(s)" title="Borrar" aria-label="Borrar"
              class="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        </li>
      }
    </ul>
  }

  @if (notice()) {
    <div class="mx-4 mb-3 mt-3 flex items-start gap-2 rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/30 px-3 py-2 text-xs text-teal-800 dark:text-teal-300">
      <span class="flex-1">{{ notice() }}</span>
      <button (click)="notice.set(null)" class="text-teal-500 hover:text-teal-700" aria-label="Cerrar">✕</button>
    </div>
  }

  <!-- Qué es esta pestaña -->
  <div class="mt-auto flex items-start gap-2.5 px-4 py-3 border-t border-gray-100 dark:border-zinc-800 rounded-b-2xl bg-gray-50/60 dark:bg-zinc-900/60">
    <svg class="h-4 w-4 mt-px flex-shrink-0 text-gray-400 dark:text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>
    </svg>
    <p class="text-xs leading-relaxed text-gray-500 dark:text-zinc-400">
      Acá llega lo que se escanea en las impresoras con el destino de {{ office() || 'tu oficina' }}. Lo ven solo sus integrantes
      y no ocupa el espacio del Drive. Se borra solo a los {{ retentionDays }} días: lo que haya que conservar, guardalo en Archivos.
    </p>
  </div>
</div>

<!-- Guardar en… -->
@if (saveMenu(); as m) {
  <div class="fixed z-[1000] w-64 py-1.5 bg-white dark:bg-zinc-800 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-700"
       [style.left.px]="m.x" [style.top.px]="m.y" role="menu" (click)="$event.stopPropagation()">
    <p class="px-3.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Guardar una copia en</p>
    <button (click)="save(m.scan, 'office')" role="menuitem"
      class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700">
      <svg class="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16M16 9h2a2 2 0 012 2v10M3 21h18M8 7h4M8 11h4M8 15h4"/>
      </svg>
      <span class="min-w-0"><span class="block truncate">Archivos de {{ m.scan.groupName }}</span>
        <span class="block text-[11px] text-gray-400">La ve toda la oficina; ocupa su espacio</span></span>
    </button>
    <button (click)="save(m.scan, 'personal')" role="menuitem" [disabled]="!googleEmail()"
      class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
      [title]="googleEmail() ? '' : 'Necesitás una cuenta @iugna.edu.ar para tener Mis archivos'">
      <svg class="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>
      </svg>
      <span class="min-w-0"><span class="block">Mis archivos</span>
        <span class="block text-[11px] text-gray-400">Solo para vos, en tu Google Drive</span></span>
    </button>
  </div>
}

<!-- Cambiar el nombre -->
@if (renameDialog(); as d) {
  <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" (click)="renameDialog.set(null)">
    <div class="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 p-5 shadow-2xl" (click)="$event.stopPropagation()" role="dialog" aria-label="Cambiar el nombre">
      <h3 class="text-base font-semibold text-gray-900 dark:text-zinc-100">Cambiar el nombre</h3>
      <input [ngModel]="d.value" (ngModelChange)="renameDialog.set({ scan: d.scan, value: $event })"
        (keydown.enter)="submitRename()" autofocus
        class="mt-3 w-full rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-gray-900 dark:text-zinc-100 focus:border-teal-500 focus:ring-teal-500" />
      <p class="mt-1.5 text-[11px] text-gray-400">Si no ponés la extensión, se mantiene la que tiene ({{ extOf(d.scan.filename) || 'ninguna' }}).</p>
      <div class="mt-4 flex justify-end gap-2">
        <button (click)="renameDialog.set(null)" class="rounded-lg border border-gray-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800">Cancelar</button>
        <button (click)="submitRename()" [disabled]="busy() || !d.value.trim()" class="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">Guardar</button>
      </div>
    </div>
  </div>
}

<!-- Borrar -->
@if (toDelete(); as s) {
  <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" (click)="toDelete.set(null)">
    <div class="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 p-5 shadow-2xl" (click)="$event.stopPropagation()" role="alertdialog" aria-label="Borrar escaneo">
      <h3 class="text-base font-semibold text-gray-900 dark:text-zinc-100">¿Borrar «{{ s.filename }}»?</h3>
      <p class="mt-2 text-sm text-red-600 dark:text-red-400">Se borra para toda la oficina y no se puede recuperar.</p>
      <div class="mt-4 flex justify-end gap-2">
        <button (click)="toDelete.set(null)" class="rounded-lg border border-gray-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800">Cancelar</button>
        <button (click)="confirmDelete(s)" [disabled]="busy()" class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">Borrar</button>
      </div>
    </div>
  </div>
}

<!-- TICOM: accesos para cargar en las impresoras -->
@if (accountsOpen()) {
  <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" (click)="accountsOpen.set(false)">
    <div class="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl" (click)="$event.stopPropagation()" role="dialog" aria-label="Configurar impresoras">
      <div class="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100 dark:border-zinc-800">
        <div>
          <h3 class="text-base font-semibold text-gray-900 dark:text-zinc-100">Configurar impresoras para escanear</h3>
          <p class="mt-1 text-xs text-gray-500 dark:text-zinc-400 max-w-3xl leading-relaxed">
            En cada impresora, agregá un destino de <strong>carpeta de red (SMB)</strong> por cada oficina que la usa, con la ruta, el usuario y la
            contraseña de esa oficina (dominio vacío o WORKGROUP). Si la impresora no soporta SMB2/3 (las HP M521dn), usá <strong>FTP</strong>:
            servidor <code class="font-mono">{{ accounts()[0]?.ftpHost ?? '10.98.40.24' }}</code>, puerto 21, el mismo usuario y contraseña, carpeta <code class="font-mono">/</code>.
          </p>
        </div>
        <div class="flex items-center gap-3 flex-shrink-0">
          <button (click)="printAccounts()" [disabled]="!configuredAccounts().length"
            class="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40"
            [title]="configuredAccounts().length ? 'Imprimir la planilla con las oficinas que tienen acceso' : 'Todavía no hay oficinas con acceso'">
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/>
            </svg>
            Imprimir planilla
          </button>
          <button (click)="accountsOpen.set(false)" class="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200" aria-label="Cerrar">✕</button>
        </div>
      </div>
      <div class="flex-1 overflow-auto px-5 py-3">
        @if (accountsLoading()) {
          <div class="flex justify-center py-10"><app-comet-spinner [size]="40" /></div>
        } @else if (accountsError()) {
          <div class="my-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">{{ accountsError() }}</div>
        } @else {
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-[11px] uppercase tracking-wide text-gray-400 dark:text-zinc-500">
                <th class="py-2 pr-3 font-semibold">Oficina</th>
                <th class="py-2 pr-3 font-semibold">Carpeta de red</th>
                <th class="py-2 pr-3 font-semibold">Usuario</th>
                <th class="py-2 pr-3 font-semibold">Contraseña</th>
                <th class="py-2 pr-3 font-semibold">Último escaneo</th>
                <th class="py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-zinc-800">
              @for (a of accounts(); track a.groupName) {
                <tr class="align-middle">
                  <td class="py-2.5 pr-3 font-medium text-gray-900 dark:text-zinc-100">{{ a.groupName }}</td>
                  @if (a.configured) {
                    <td class="py-2.5 pr-3">
                      <button (click)="copy(a.networkPath!, 'la carpeta de red de ' + a.groupName)" class="font-mono text-xs text-gray-700 dark:text-zinc-300 hover:text-teal-700" title="Copiar">{{ a.networkPath }}</button>
                    </td>
                    <td class="py-2.5 pr-3">
                      <button (click)="copy(a.username!, 'el usuario de ' + a.groupName)" class="font-mono text-xs text-gray-700 dark:text-zinc-300 hover:text-teal-700" title="Copiar">{{ a.username }}</button>
                    </td>
                    <td class="py-2.5 pr-3 whitespace-nowrap">
                      <button (click)="copy(a.password ?? '', 'la contraseña de ' + a.groupName)" class="font-mono text-xs text-gray-700 dark:text-zinc-300 hover:text-teal-700" title="Copiar">
                        {{ shownPasswords().has(a.groupName) ? a.password : '••••••••••••' }}
                      </button>
                      <button (click)="togglePassword(a.groupName)" class="ml-1 text-gray-400 hover:text-gray-700 text-xs" [attr.aria-label]="shownPasswords().has(a.groupName) ? 'Ocultar' : 'Mostrar'">
                        {{ shownPasswords().has(a.groupName) ? 'ocultar' : 'ver' }}
                      </button>
                    </td>
                    <td class="py-2.5 pr-3 text-xs text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                      {{ a.lastScanAt ? formatDate(a.lastScanAt) : 'Nunca' }}
                      @if (a.scanCount) { <span class="text-gray-400"> · {{ a.scanCount }} guardados</span> }
                    </td>
                    <td class="py-2.5 text-right">
                      <button (click)="resetPassword(a)" [disabled]="accountBusy() === a.groupName"
                        class="text-xs font-medium text-gray-500 hover:text-red-600 disabled:opacity-50">Nueva contraseña</button>
                    </td>
                  } @else {
                    <td colspan="4" class="py-2.5 pr-3 text-xs text-gray-400">Sin acceso todavía</td>
                    <td class="py-2.5 text-right">
                      <button (click)="createAccount(a)" [disabled]="accountBusy() === a.groupName"
                        class="rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50">Crear acceso</button>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
      @if (copied()) {
        <p class="px-5 pb-3 text-xs text-teal-700 dark:text-teal-400">Se copió {{ copied() }}.</p>
      }
    </div>
  </div>
}

<app-attachment-preview-modal [request]="previewRequest()" (closed)="previewRequest.set(null)" />
  `,
  styles: [`
    .scan-fresh { animation: scan-fresh 2.4s ease-out; }
    @keyframes scan-fresh { 0%, 40% { background: rgb(204 251 241 / .8); } 100% { background: transparent; } }
  `],
})
export class ScansPanelComponent implements OnInit {
  readonly scansApi = inject(ScansService);
  private readonly notifications = inject(NotificationsService);
  private readonly destroyRef = inject(DestroyRef);

  /** Oficinas del usuario. */
  readonly offices = input.required<string[]>();
  /** Cuenta @iugna.edu.ar (sin ella no hay Mis archivos). */
  readonly googleEmail = input<string | null>(null);
  /** Desde la campanita: oficina y escaneo a resaltar. */
  readonly focus = input<{ office: string; id?: string } | null>(null);
  /** Se guardó algo en Archivos (para actualizar el espacio de la oficina). */
  readonly saved = output<void>();

  readonly retentionDays = 90;
  readonly isTicom = this.scansApi.isTicom;

  readonly office = signal<string | null>(null);
  readonly scans = signal<ScanItem[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly filter = signal('');
  readonly highlightId = signal<string | null>(null);
  readonly savingId = signal<string | null>(null);
  readonly saveMenu = signal<{ x: number; y: number; scan: ScanItem } | null>(null);
  readonly renameDialog = signal<{ scan: ScanItem; value: string } | null>(null);
  readonly toDelete = signal<ScanItem | null>(null);
  readonly previewRequest = signal<AttachmentPreviewRequest | null>(null);

  readonly accountsOpen = signal(false);
  readonly accountsLoading = signal(false);
  readonly accountsError = signal<string | null>(null);
  readonly accounts = signal<ScanAccount[]>([]);
  readonly accountBusy = signal<string | null>(null);
  readonly shownPasswords = signal<ReadonlySet<string>>(new Set());
  readonly copied = signal<string | null>(null);

  private readonly sinRecarga = inject(AppVersionService).holdWhile(
    'escaneos',
    () => !!this.renameDialog() || !!this.savingId() || this.accountsOpen(),
  );

  readonly rows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    return q ? this.scans().filter((s) => s.filename.toLowerCase().includes(q)) : this.scans();
  });

  constructor() {
    // La campanita puede pedir otra oficina o escaneo con la pestaña ya abierta.
    effect(() => {
      const f = this.focus();
      if (!f) return;
      untracked(() => {
        const match = this.offices().find((o) => o.toUpperCase() === f.office.toUpperCase());
        if (match) this.selectOffice(match, f.id);
      });
    });

    // Un escaneo nuevo de la oficina abierta aparece solo: aviso en vivo (sin campanita)...
    this.notifications.signals.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ event, data }) => {
      if (event !== 'scan_arrived') return;
      const group = String(data['groupName'] ?? '');
      if (group.toUpperCase() === this.office()?.toUpperCase()) this.refreshQuietly(String(data['scanId'] ?? '') || undefined);
    });
    // ...y por si la conexión en vivo se cortó (antes había que apretar F5): cada 30 s
    // con la pestaña a la vista, y al volver a ella.
    merge(interval(REFRESH_MS), fromEvent(document, 'visibilitychange'))
      .pipe(
        filter(() => document.visibilityState === 'visible'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.refreshQuietly());
  }

  /** Vuelve a pedir la lista sin el indicador de carga; lo que no estaba se resalta un momento. */
  private refreshQuietly(highlight?: string): void {
    const office = this.office();
    if (!office || this.loading()) return;
    this.scansApi.list(office).subscribe({
      next: (list) => {
        if (this.office() !== office) return;
        const known = new Set(this.scans().map((s) => s.id));
        const fresh = highlight ?? list.find((s) => !known.has(s.id))?.id;
        this.scans.set(list);
        if (fresh && !known.has(fresh) && list.some((s) => s.id === fresh)) {
          this.highlightId.set(fresh);
          setTimeout(() => this.highlightId.set(null), 2600);
        }
      },
      error: () => { /* silencioso: lo intenta de nuevo en el próximo ciclo */ },
    });
  }

  ngOnInit(): void {
    if (this.office() || !this.offices().length) return;
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_OFFICE_KEY); } catch { /* sin storage */ }
    this.selectOffice(last && this.offices().includes(last) ? last : this.offices()[0]);
  }

  selectOffice(office: string, highlight?: string): void {
    const changed = this.office() !== office;
    this.office.set(office);
    try { localStorage.setItem(LAST_OFFICE_KEY, office); } catch { /* sin storage */ }
    if (changed) {
      this.scans.set([]);
      this.filter.set('');
    }
    this.load(highlight);
  }

  load(highlight?: string): void {
    const office = this.office();
    if (!office) return;
    this.loading.set(true);
    this.error.set(null);
    this.scansApi.list(office).subscribe({
      next: (list) => {
        if (this.office() !== office) return;
        this.scans.set(list);
        this.loading.set(false);
        if (highlight && list.some((s) => s.id === highlight)) {
          this.highlightId.set(highlight);
          setTimeout(() => document.getElementById(`scan-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
          setTimeout(() => this.highlightId.set(null), 2600);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(err.error?.message ?? 'No se pudieron cargar los escaneos.');
      },
    });
  }

  preview(s: ScanItem): void {
    const url = this.scansApi.fileUrl(s);
    this.previewRequest.set({ url, downloadUrl: `${url}?download=1`, filename: s.filename, byContentType: true });
  }

  // ─── Guardar en Archivos ───────────────────────────────────────────────────

  openSave(event: MouseEvent, s: ScanItem): void {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 256;
    const x = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const y = rect.bottom + 140 > window.innerHeight ? rect.top - 140 : rect.bottom + 4;
    this.saveMenu.set({ x, y, scan: s });
  }

  @HostListener('document:click')
  closeMenus(): void {
    this.saveMenu.set(null);
  }

  save(s: ScanItem, target: 'office' | 'personal'): void {
    this.saveMenu.set(null);
    this.savingId.set(s.id);
    this.notice.set(null);
    this.scansApi.saveToDrive(s, target).subscribe({
      next: () => {
        this.savingId.set(null);
        const where = target === 'personal' ? 'Mis archivos' : `Archivos de ${s.groupName}`;
        this.notice.set(`Se guardó una copia de «${s.filename}» en ${where}. El escaneo sigue acá hasta que venza o lo borres.`);
        this.saved.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.savingId.set(null);
        this.notice.set(err.error?.message ?? 'No se pudo guardar en Archivos. Intentá de nuevo.');
      },
    });
  }

  // ─── Cambiar el nombre y borrar ────────────────────────────────────────────

  openRename(s: ScanItem): void {
    this.renameDialog.set({ scan: s, value: s.filename });
  }

  submitRename(): void {
    const d = this.renameDialog();
    if (!d || !d.value.trim() || this.busy()) return;
    this.busy.set(true);
    this.scansApi.rename(d.scan, d.value.trim()).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.renameDialog.set(null);
        this.scans.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.notice.set(err.error?.message ?? 'No se pudo cambiar el nombre.');
      },
    });
  }

  confirmDelete(s: ScanItem): void {
    this.busy.set(true);
    this.scansApi.remove(s).subscribe({
      next: () => {
        this.busy.set(false);
        this.toDelete.set(null);
        this.scans.update((list) => list.filter((x) => x.id !== s.id));
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.toDelete.set(null);
        this.notice.set(err.error?.message ?? 'No se pudo borrar.');
      },
    });
  }

  // ─── TICOM ─────────────────────────────────────────────────────────────────

  openAccounts(): void {
    this.accountsOpen.set(true);
    this.accountsLoading.set(true);
    this.accountsError.set(null);
    this.copied.set(null);
    this.scansApi.accounts().subscribe({
      next: (list) => {
        this.accounts.set(list);
        this.accountsLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.accountsLoading.set(false);
        this.accountsError.set(err.error?.message ?? 'No se pudieron cargar los accesos.');
      },
    });
  }

  createAccount(a: ScanAccount): void {
    this.accountBusy.set(a.groupName);
    this.scansApi.createAccount(a.groupName).subscribe({
      next: (updated) => {
        this.accountBusy.set(null);
        this.accounts.update((list) => list.map((x) => (x.groupName === updated.groupName ? updated : x)));
        this.shownPasswords.update((set) => new Set(set).add(updated.groupName));
      },
      error: (err: HttpErrorResponse) => {
        this.accountBusy.set(null);
        this.accountsError.set(err.error?.message ?? `No se pudo crear el acceso de ${a.groupName}.`);
      },
    });
  }

  resetPassword(a: ScanAccount): void {
    if (!confirm(`¿Generar una contraseña nueva para ${a.groupName}? Las impresoras que tengan la anterior dejan de poder escanear hasta que les cargues la nueva.`)) return;
    this.createAccount(a);
  }

  readonly configuredAccounts = computed(() => this.accounts().filter((a) => a.configured));

  /**
   * Planilla para configurar las impresoras: oficina, carpeta de red, usuario y
   * contraseña de cada oficina con acceso. Lleva las contraseñas: se avisa al pie.
   */
  printAccounts(): void {
    const rows = this.configuredAccounts();
    if (!rows.length) return;
    const esc = (s: string | null) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const host = rows[0].ftpHost;
    const now = new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const body = rows
      .map((a) => `<tr><td>${esc(a.groupName)}</td><td class="mono">${esc(a.networkPath)}</td><td class="mono">${esc(a.username)}</td><td class="mono pw">${esc(a.password)}</td></tr>`)
      .join('');
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Escaneos - accesos de las oficinas</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11pt; }
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  .sub { color: #555; font-size: 9.5pt; margin: 0 0 5mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 2.2mm 3mm; text-align: left; vertical-align: middle; }
  th { background: #eee; font-size: 9pt; text-transform: uppercase; letter-spacing: .03em; }
  tr { page-break-inside: avoid; }
  .mono { font-family: Consolas, 'Courier New', monospace; font-size: 11pt; }
  .pw { letter-spacing: .06em; font-weight: bold; }
  .help { margin-top: 5mm; font-size: 9.5pt; line-height: 1.45; }
  .warn { margin-top: 4mm; padding: 2.5mm 3mm; border: 1px solid #b91c1c; color: #b91c1c; font-size: 9.5pt; }
</style></head><body>
<h1>Escaneo a la intranet — accesos de las oficinas</h1>
<p class="sub">Generado el ${esc(now)} · ${rows.length} ${rows.length === 1 ? 'oficina' : 'oficinas'} con acceso</p>
<table>
  <thead><tr><th>Oficina</th><th>Carpeta de red (SMB)</th><th>Usuario</th><th>Contraseña</th></tr></thead>
  <tbody>${body}</tbody>
</table>
<div class="help">
  <strong>En la impresora:</strong> un destino de <strong>carpeta de red (SMB)</strong> por cada oficina que la usa, con la ruta, el usuario y la contraseña de esa oficina. Dominio: vacío o WORKGROUP.<br>
  <strong>Si la impresora no soporta SMB2/3</strong> (HP LaserJet Pro M521dn): <strong>FTP</strong>, servidor <span class="mono">${esc(host)}</span>, puerto 21, el mismo usuario y contraseña, carpeta <span class="mono">/</span>.<br>
  Lo escaneado aparece en la intranet en Archivos compartidos → Escaneos, solo para los integrantes de esa oficina.
</div>
<div class="warn"><strong>Documento reservado:</strong> contiene contraseñas. Guardalo en un lugar seguro o destruilo después de configurar las impresoras.
Si se pierde, generá contraseñas nuevas desde la intranet (Configurar impresoras → Nueva contraseña).</div>
</body></html>`;

    // Iframe oculto: imprime sin abrir otra pestaña (y sin que lo frene el bloqueador de ventanas).
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    }, 200);
  }

  togglePassword(group: string): void {
    this.shownPasswords.update((set) => {
      const next = new Set(set);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  copy(text: string, what: string): void {
    void navigator.clipboard?.writeText(text).then(
      () => this.copied.set(what),
      () => this.copied.set(null),
    );
  }

  // ─── Formato ───────────────────────────────────────────────────────────────

  size(bytes: number): string {
    return formatBytes(bytes);
  }

  extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  }

  daysLeft(s: ScanItem): number {
    return Math.max(1, Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / DAY_MS));
  }

  /** "08/10/2026 10:32", en hora de Argentina. */
  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}
