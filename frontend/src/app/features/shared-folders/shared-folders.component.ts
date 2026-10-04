import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import {
  FolderScope,
  OfficesInfo,
  ShareEntry,
  ShareRole,
  SharedFile,
  SharedFoldersService,
  SharedWithMe,
} from '../../core/services/shared-folders.service';
import {
  AttachmentPreviewModalComponent,
  AttachmentPreviewRequest,
} from '../../shared/attachment-preview-modal/attachment-preview-modal.component';

const LAST_TAB_KEY = 'pac_shared_folders_office';
/** Pestaña "Compartidos conmigo" (no puede coincidir con un grupo del AD). */
const SHARED_TAB = '__compartidos__';
/** Igual al límite del backend. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MENU_WIDTH = 220;
const MENU_HEIGHT = 250;

type IconKind = 'folder' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'image' | 'archive' | 'file';
type MenuAction = 'open' | 'google' | 'download' | 'share' | 'rename' | 'delete';

interface Crumb { id: string; name: string; }
interface NameDialog { mode: 'folder' | 'rename'; file?: SharedFile; value: string; }
/** Una fila: un archivo o carpeta y, en "Compartidos conmigo", el permiso que lo trae. */
interface Row { file: SharedFile; item?: SharedWithMe; }
interface ContextMenu { x: number; y: number; row: Row; }
interface UserHit { username: string; displayName: string; }

@Component({
  selector: 'app-shared-folders',
  standalone: true,
  imports: [CommonModule, FormsModule, AttachmentPreviewModalComponent],
  template: `
<div class="space-y-5">

  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">Carpetas compartidas</h1>
    <p class="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">Archivos de tu oficina y lo que otros compartieron con vos.</p>
  </div>

  @if (loadingInfo()) {
    <div class="flex justify-center py-16">
      <svg class="animate-spin h-8 w-8 text-teal-600" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
    </div>
  } @else if (!info()?.configured) {
    <div class="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-6 text-sm text-amber-800 dark:text-amber-300">
      Las carpetas compartidas todavía no están configuradas. Avisá a TICOM.
    </div>
  } @else {

    <!-- Pestañas: oficinas + Compartidos conmigo -->
    <div class="flex gap-1 bg-gray-100 dark:bg-zinc-800 rounded-xl p-1 w-fit max-w-full overflow-x-auto" role="tablist">
      @for (o of info()!.offices; track o) {
        <button (click)="selectTab(o)" role="tab" [attr.aria-selected]="tab() === o"
          class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          [class]="tab() === o ? tabOn : tabOff">
          {{ o }}
        </button>
      }
      <button (click)="selectTab(SHARED_TAB)" role="tab" [attr.aria-selected]="isSharedTab()"
        class="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
        [class]="isSharedTab() ? tabOn : tabOff">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-4-6"/>
        </svg>
        Compartidos conmigo
        @if (folders.unseenShares() > 0) {
          <span class="bg-red-500 text-white text-xs font-semibold rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none"
                [attr.aria-label]="folders.unseenShares() + ' nuevos'">
            {{ folders.unseenShares() }}
          </span>
        }
      </button>
    </div>

    <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-sm relative"
         (dragover)="onDragOver($event)" (dragleave)="onDragLeave($event)" (drop)="onDrop($event)">

      <!-- Barra: ruta + acciones -->
      <div class="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
        <nav class="flex items-center gap-1 text-sm min-w-0 flex-wrap" aria-label="Ruta">
          @for (c of path(); track $index; let last = $last; let first = $first) {
            @if (!first) {
              <svg class="h-4 w-4 text-gray-300 dark:text-zinc-600 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd"/>
              </svg>
            }
            @if (last) {
              <span class="font-semibold text-gray-900 dark:text-zinc-100 truncate max-w-[16rem]">{{ c.name }}</span>
            } @else {
              <button (click)="goTo($index)" class="text-teal-700 dark:text-teal-400 hover:underline truncate max-w-[12rem]">{{ c.name }}</button>
            }
          }
          @if (!atSharedRoot() && !canWrite()) {
            <span class="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">Solo lectura</span>
          }
        </nav>

        <div class="flex items-center gap-2">
          <div class="relative">
            <input [ngModel]="filter()" (ngModelChange)="filter.set($event)" placeholder="Filtrar…" aria-label="Filtrar en esta carpeta"
              class="w-40 sm:w-52 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800
                     text-sm text-gray-900 dark:text-zinc-100 pl-8 pr-3 py-1.5 focus:border-teal-500 focus:ring-teal-500" />
            <svg class="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd"/>
            </svg>
          </div>
          @if (!atSharedRoot() && canWrite()) {
            <button (click)="openNewFolder()" [disabled]="busy()"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-zinc-700
                     text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/><path d="M12 11v5M9.5 13.5h5"/>
              </svg>
              <span class="hidden sm:inline">Nueva carpeta</span>
            </button>
            <label class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white shadow-sm cursor-pointer transition-opacity hover:opacity-90"
                   [class.opacity-50]="busy()" [class.pointer-events-none]="busy()"
                   style="background: linear-gradient(to right, #14B8A5, #22C562)">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>
              </svg>
              Subir
              <input type="file" multiple class="hidden" (change)="onFilesPicked($event)" />
            </label>
          }
        </div>
      </div>

      <!-- Progreso de subida -->
      @if (uploadProgress() !== null) {
        <div class="px-4 py-2.5 border-b border-gray-100 dark:border-zinc-800 bg-teal-50/60 dark:bg-teal-950/20">
          <div class="flex justify-between text-xs font-medium text-teal-800 dark:text-teal-300 mb-1.5">
            <span>{{ uploadLabel() }}</span>
            <span class="tabular-nums">{{ uploadProgress() }}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-teal-100 dark:bg-teal-900/50 overflow-hidden">
            <div class="h-full bg-teal-500 transition-all duration-300" [style.width.%]="uploadProgress()"></div>
          </div>
        </div>
      }

      @if (error()) {
        <div class="mx-4 mt-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <span class="flex-1">{{ error() }}</span>
          <button (click)="error.set(null)" class="text-red-400 hover:text-red-600" aria-label="Cerrar">✕</button>
        </div>
      }

      <!-- Lista -->
      @if (loading()) {
        <div class="flex justify-center py-16">
          <svg class="animate-spin h-7 w-7 text-teal-600" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      } @else if (!rows().length) {
        <div class="py-16 text-center px-4">
          <svg class="h-12 w-12 mx-auto text-gray-300 dark:text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
          </svg>
          @if (filter().trim()) {
            <p class="mt-3 text-sm text-gray-500 dark:text-zinc-400">Nada coincide con "{{ filter().trim() }}".</p>
          } @else if (atSharedRoot()) {
            <p class="mt-3 text-sm font-medium text-gray-700 dark:text-zinc-300">Todavía nadie compartió nada con vos</p>
            <p class="text-sm text-gray-500 dark:text-zinc-400">Cuando alguien te comparta un archivo o una carpeta, va a aparecer acá.</p>
          } @else {
            <p class="mt-3 text-sm font-medium text-gray-700 dark:text-zinc-300">Esta carpeta está vacía</p>
            @if (canWrite()) {
              <p class="text-sm text-gray-500 dark:text-zinc-400">Arrastrá archivos acá o usá el botón Subir.</p>
            }
          }
        </div>
      } @else {
        <ul class="divide-y divide-gray-100 dark:divide-zinc-800">
          @for (row of rows(); track row.item?.shareId ?? row.file.id) {
            <li class="group flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/60 cursor-default"
                [ngClass]="{ 'bg-teal-50 dark:bg-zinc-800': menu()?.row === row }"
                (contextmenu)="openMenu($event, row)">
              <button (click)="open(row)" class="flex items-center gap-3 min-w-0 flex-1 text-left"
                      [title]="row.file.isFolder ? 'Abrir carpeta' : (row.file.previewable ? 'Ver' : 'Descargar')">
                <span class="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0" [class]="iconBg(row.file)">
                  @switch (iconKind(row.file)) {
                    @case ('folder') {
                      <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                    }
                    @case ('image') {
                      <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                    }
                    @default {
                      <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>
                    }
                  }
                </span>
                <span class="min-w-0">
                  <span class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-900 dark:text-zinc-100 truncate">{{ row.file.name }}</span>
                    @if (row.item?.isNew) {
                      <span class="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500 text-white">Nuevo</span>
                    }
                  </span>
                  <span class="block text-xs text-gray-500 dark:text-zinc-400 truncate">
                    @if (row.item; as item) {
                      {{ item.sharedByName }} · {{ item.groupName }} · {{ item.role === 'writer' ? 'Puede editar' : 'Puede ver' }}
                    } @else {
                      {{ typeLabel(row.file) }}@if (row.file.size !== null) { · {{ formatSize(row.file.size) }} }
                    }
                  </span>
                </span>
              </button>

              <span class="hidden md:block w-56 text-xs text-gray-500 dark:text-zinc-400 truncate text-right">
                @if (row.item; as item) {
                  Compartido el {{ formatDate(item.sharedAt) }}
                } @else {
                  @if (row.file.modifiedTime) { {{ formatDate(row.file.modifiedTime) }} }
                  @if (row.file.modifiedBy) { <span class="block truncate">{{ row.file.modifiedBy }}</span> }
                }
              </span>

              @if (googleUrlFor(row.file)) {
                <button (click)="openInGoogle(row.file)"
                  class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors"
                  [class]="editorClass(row.file)"
                  [title]="'Abrir en ' + editorName(row.file) + ' para trabajar en conjunto'">
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
                  {{ canEditInGoogle(row) ? 'Editar' : 'Abrir' }}
                </button>
              }

              <button (click)="openMenu($event, row); $event.stopPropagation()"
                class="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                title="Más opciones" aria-label="Más opciones" aria-haspopup="menu">
                <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="4" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="10" cy="16" r="1.6"/></svg>
              </button>
            </li>
          }
        </ul>
      }

      <!-- Zona de arrastre -->
      @if (dragOver()) {
        <div class="absolute inset-0 rounded-2xl border-2 border-dashed border-teal-500 bg-teal-50/90 dark:bg-teal-950/80
                    flex flex-col items-center justify-center pointer-events-none">
          <svg class="h-10 w-10 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>
          </svg>
          <p class="mt-2 text-sm font-semibold text-teal-800 dark:text-teal-200">Soltá para subir a «{{ path()[path().length - 1].name }}»</p>
        </div>
      }
    </div>
  }
</div>

<!-- Menú contextual (clic derecho o ⋮) -->
@if (menu(); as m) {
  <div class="fixed z-[1000] w-[220px] py-1.5 bg-white dark:bg-zinc-800 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-700"
       [style.left.px]="m.x" [style.top.px]="m.y" role="menu" (click)="$event.stopPropagation()">
    @for (a of menuActions(m.row); track a) {
      @if (a === 'delete') { <div class="my-1 border-t border-gray-100 dark:border-zinc-700"></div> }
      <button (click)="runAction(a, m.row)" role="menuitem"
        class="w-full flex items-center gap-3 px-3.5 py-2 text-sm text-left transition-colors"
        [class]="a === 'delete'
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
          : 'text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-700'">
        @switch (a) {
          @case ('open') {
            <svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
            {{ m.row.file.isFolder ? 'Abrir' : 'Ver' }}
          }
          @case ('google') {
            <svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
            {{ canEditInGoogle(m.row) ? 'Editar' : 'Abrir' }} en {{ editorName(m.row.file) }}
          }
          @case ('download') {
            <svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>
            Descargar
          }
          @case ('share') {
            <svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M19 8v6M16 11h6"/></svg>
            Compartir
          }
          @case ('rename') {
            <svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
            Cambiar nombre
          }
          @case ('delete') {
            <svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
            Borrar
          }
        }
      </button>
    }
  </div>
}

<!-- Diálogo: compartir -->
@if (shareDialog(); as file) {
  <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" (click)="closeShare()">
    <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 dark:border-zinc-700"
         (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div class="px-6 pt-6 pb-4">
        <h2 id="share-title" class="text-base font-semibold text-gray-900 dark:text-zinc-100 truncate">Compartir «{{ file.name }}»</h2>
        <p class="text-xs text-gray-500 dark:text-zinc-400 mt-1">
          Los integrantes de {{ tab() }} ya tienen acceso.{{ file.isFolder ? ' Se comparte la carpeta con todo su contenido.' : '' }}
        </p>

        <div class="mt-4 flex gap-2">
          <div class="relative flex-1">
            <input [ngModel]="shareQuery()" (ngModelChange)="onShareQuery($event)" placeholder="Nombre o usuario…" autocomplete="off"
              aria-label="Buscar usuario de la intranet"
              class="block w-full rounded-lg border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800
                     text-gray-900 dark:text-zinc-100 text-sm focus:border-teal-500 focus:ring-teal-500" />
            @if (shareResults().length) {
              <ul class="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-gray-200 dark:border-zinc-700">
                @for (u of shareResults(); track u.username) {
                  <li>
                    <button (click)="selectTarget(u)" class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-zinc-700">
                      <span class="h-7 w-7 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {{ initials(u.displayName) }}
                      </span>
                      <span class="min-w-0">
                        <span class="block text-sm text-gray-900 dark:text-zinc-100 truncate">{{ u.displayName }}</span>
                        <span class="block text-xs text-gray-500 dark:text-zinc-400">{{ u.username }}</span>
                      </span>
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
          <select [ngModel]="shareRole()" (ngModelChange)="shareRole.set($event)" aria-label="Permiso"
            class="rounded-lg border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 text-sm focus:border-teal-500 focus:ring-teal-500">
            <option value="reader">Puede ver</option>
            <option value="writer">Puede editar</option>
          </select>
        </div>

        @if (shareError()) {
          <p class="mt-2 text-sm text-red-600 dark:text-red-400">{{ shareError() }}</p>
        }

        <button (click)="submitShare()" [disabled]="!shareTarget() || shareSaving()"
          class="mt-3 w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style="background: linear-gradient(to right, #14B8A5, #22C562)">
          {{ shareTarget() ? 'Compartir con ' + shareTarget()!.displayName : 'Elegí un usuario' }}
        </button>
      </div>

      <div class="px-6 py-4 border-t border-gray-100 dark:border-zinc-800">
        <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-2">Compartido con</p>
        @if (shareLoading()) {
          <p class="text-sm text-gray-400">Cargando…</p>
        } @else if (!shareEntries().length) {
          <p class="text-sm text-gray-500 dark:text-zinc-400">Nadie fuera de la oficina todavía.</p>
        } @else {
          <ul class="space-y-1.5 max-h-48 overflow-y-auto">
            @for (e of shareEntries(); track e.id) {
              <li class="flex items-center gap-2.5">
                <span class="h-7 w-7 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {{ initials(e.name) }}
                </span>
                <span class="flex-1 min-w-0 text-sm text-gray-800 dark:text-zinc-200 truncate" [title]="'Compartido por ' + e.sharedByName">{{ e.name }}</span>
                <select [ngModel]="e.role" (ngModelChange)="changeRole(e, $event)" [disabled]="shareSaving()" aria-label="Permiso"
                  class="rounded-md border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 text-xs py-1 pl-2 pr-7">
                  <option value="reader">Puede ver</option>
                  <option value="writer">Puede editar</option>
                </select>
                <button (click)="removeShare(e)" [disabled]="shareSaving()" class="p-1 rounded text-gray-400 hover:text-red-600" title="Dejar de compartir" aria-label="Dejar de compartir">✕</button>
              </li>
            }
          </ul>
        }
      </div>

      <div class="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex justify-end">
        <button (click)="closeShare()" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800">Listo</button>
      </div>
    </div>
  </div>
}

<!-- Diálogo: nueva carpeta / cambiar nombre -->
@if (nameDialog(); as d) {
  <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" (click)="nameDialog.set(null)">
    <form class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-100 dark:border-zinc-700 p-6"
          (click)="$event.stopPropagation()" (ngSubmit)="submitName()">
      <h2 class="text-base font-semibold text-gray-900 dark:text-zinc-100">
        {{ d.mode === 'folder' ? 'Nueva carpeta' : 'Cambiar nombre' }}
      </h2>
      <input name="name" [(ngModel)]="d.value" maxlength="255" autofocus
        class="mt-4 block w-full rounded-lg border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800
               text-gray-900 dark:text-zinc-100 text-sm focus:border-teal-500 focus:ring-teal-500" />
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" (click)="nameDialog.set(null)"
          class="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800">Cancelar</button>
        <button type="submit" [disabled]="!d.value.trim() || busy()"
          class="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style="background: linear-gradient(to right, #14B8A5, #22C562)">
          {{ d.mode === 'folder' ? 'Crear' : 'Guardar' }}
        </button>
      </div>
    </form>
  </div>
}

<!-- Diálogo: confirmar borrado -->
@if (toDelete(); as f) {
  <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" (click)="toDelete.set(null)">
    <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-100 dark:border-zinc-700 p-6"
         (click)="$event.stopPropagation()" role="alertdialog" aria-modal="true">
      <h2 class="text-base font-semibold text-gray-900 dark:text-zinc-100">¿Borrar {{ f.isFolder ? 'la carpeta' : 'el archivo' }}?</h2>
      <p class="mt-2 text-sm text-gray-600 dark:text-zinc-400">
        «{{ f.name }}»{{ f.isFolder ? ' y todo su contenido' : '' }} va a la papelera. TICOM puede recuperarlo durante 30 días.
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <button (click)="toDelete.set(null)"
          class="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800">Cancelar</button>
        <button (click)="confirmDelete(f)" [disabled]="busy()"
          class="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">Borrar</button>
      </div>
    </div>
  </div>
}

<!-- Vista previa, el mismo visor de los adjuntos de MTO -->
<app-attachment-preview-modal [request]="previewRequest()" (closed)="previewRequest.set(null)" />
  `,
})
export class SharedFoldersComponent implements OnInit {
  readonly folders = inject(SharedFoldersService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly SHARED_TAB = SHARED_TAB;
  readonly tabOn = 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-zinc-100 shadow-sm';
  readonly tabOff = 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200';

  readonly info = signal<OfficesInfo | null>(null);
  readonly loadingInfo = signal(true);
  /** Pestaña activa: nombre de una oficina o SHARED_TAB. */
  readonly tab = signal<string | null>(null);
  /** Dónde se está navegando; null = la lista de "Compartidos conmigo". */
  readonly scope = signal<FolderScope | null>(null);
  readonly path = signal<Crumb[]>([]);
  readonly files = signal<SharedFile[]>([]);
  readonly sharedItems = signal<SharedWithMe[]>([]);
  readonly canWrite = signal(false);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly uploadProgress = signal<number | null>(null);
  readonly uploadLabel = signal('');
  readonly dragOver = signal(false);
  readonly filter = signal('');
  readonly menu = signal<ContextMenu | null>(null);
  readonly nameDialog = signal<NameDialog | null>(null);
  readonly toDelete = signal<SharedFile | null>(null);
  readonly previewRequest = signal<AttachmentPreviewRequest | null>(null);

  // Compartir
  readonly shareDialog = signal<SharedFile | null>(null);
  readonly shareEntries = signal<ShareEntry[]>([]);
  readonly shareLoading = signal(false);
  readonly shareSaving = signal(false);
  readonly shareQuery = signal('');
  readonly shareResults = signal<UserHit[]>([]);
  readonly shareTarget = signal<UserHit | null>(null);
  readonly shareRole = signal<ShareRole>('reader');
  readonly shareError = signal<string | null>(null);
  private readonly shareSearch$ = new Subject<string>();

  readonly isSharedTab = computed(() => this.tab() === SHARED_TAB);
  readonly atSharedRoot = computed(() => this.isSharedTab() && this.scope() === null);
  readonly currentFolderId = computed(() => this.path().at(-1)?.id ?? null);

  readonly rows = computed<Row[]>(() => {
    const q = this.filter().trim().toLowerCase();
    const match = (f: SharedFile) => !q || f.name.toLowerCase().includes(q);
    return this.atSharedRoot()
      ? this.sharedItems().filter((i) => match(i.file)).map((item) => ({ file: item.file, item }))
      : this.files().filter(match).map((file) => ({ file }));
  });

  constructor() {
    this.shareSearch$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) =>
          q.trim().length < 2
            ? of([] as UserHit[])
            : this.http.get<UserHit[]>('/api/users/search', { params: { q: q.trim() } }).pipe(catchError(() => of([] as UserHit[]))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((hits) => {
        const already = new Set(this.shareEntries().map((e) => e.username.toLowerCase()));
        this.shareResults.set(this.shareTarget() ? [] : hits.filter((h) => !already.has(h.username.toLowerCase())));
      });
  }

  ngOnInit(): void {
    this.folders.refreshCounts();
    this.folders.offices().subscribe({
      next: (info) => {
        this.info.set(info);
        this.loadingInfo.set(false);
        if (!info.configured) return;
        let last: string | null = null;
        try { last = localStorage.getItem(LAST_TAB_KEY); } catch { /* sin storage */ }
        const valid = last === SHARED_TAB || (!!last && info.offices.includes(last));
        this.selectTab(valid ? last! : info.offices[0] ?? SHARED_TAB);
      },
      error: () => {
        this.info.set({ configured: false, offices: [], googleEmail: null });
        this.loadingInfo.set(false);
      },
    });
  }

  // ─── Navegación ─────────────────────────────────────────────────────────────

  selectTab(tab: string): void {
    this.tab.set(tab);
    try { localStorage.setItem(LAST_TAB_KEY, tab); } catch { /* sin storage */ }
    this.filter.set('');
    if (tab === SHARED_TAB) {
      this.scope.set(null);
      this.path.set([{ id: '', name: 'Compartidos conmigo' }]);
      this.loadShared();
    } else {
      this.scope.set({ kind: 'office', office: tab });
      this.path.set([]);
      this.load();
    }
  }

  goTo(index: number): void {
    if (this.isSharedTab() && index === 0) {
      this.selectTab(SHARED_TAB);
      return;
    }
    this.path.update((p) => p.slice(0, index + 1));
    this.load(this.path()[index].id);
  }

  open(row: Row): void {
    const f = row.file;
    if (f.isFolder) {
      if (row.item) this.scope.set({ kind: 'share', shareId: row.item.shareId });
      this.path.update((p) => [...p, { id: f.id, name: f.name }]);
      this.filter.set('');
      this.load(f.id);
    } else if (f.previewable) {
      this.previewRequest.set({
        url: this.folders.previewUrl(this.scopeFor(row), f.id),
        filename: f.name,
        // Google guarda el archivo al cerrarlo o al rato: mientras alguien lo
        // edita, lo último puede no verse todavía (comprobado en staging).
        note: f.googleUrl
          ? `Si alguien lo está editando en ${this.editorName(f)}, los últimos cambios aparecen acá unos minutos después de que cierre el documento.`
          : undefined,
      });
    } else if (f.downloadable) {
      this.download(row);
    }
  }

  /** Ámbito de una fila: en "Compartidos conmigo" cada una trae el suyo. */
  private scopeFor(row: Row): FolderScope {
    return row.item ? { kind: 'share', shareId: row.item.shareId } : this.scope()!;
  }

  private load(folderId?: string): void {
    const scope = this.scope();
    if (!scope) return;
    this.loading.set(true);
    this.error.set(null);
    this.folders.list(scope, folderId).subscribe({
      next: (res) => {
        this.files.set(res.files);
        this.canWrite.set(res.canWrite);
        // La raíz de la oficina se nombra con la oficina; lo demás ya está en la ruta.
        if (!this.path().length) this.path.set([{ id: res.folder.id, name: this.tab() ?? res.folder.name }]);
        this.loading.set(false);
      },
      error: (err) => {
        this.files.set([]);
        this.loading.set(false);
        void this.showError(err);
      },
    });
  }

  private loadShared(): void {
    this.loading.set(true);
    this.error.set(null);
    this.canWrite.set(false);
    this.folders.sharedWithMe().subscribe({
      next: (items) => {
        this.sharedItems.set(items);
        this.loading.set(false);
        // Lo nuevo queda marcado en esta vista; el badge se apaga.
        if (items.some((i) => i.isNew) || this.folders.unseenShares() > 0) this.folders.markSeen();
      },
      error: (err) => {
        this.sharedItems.set([]);
        this.loading.set(false);
        void this.showError(err);
      },
    });
  }

  // ─── Menú contextual ────────────────────────────────────────────────────────

  openMenu(event: MouseEvent, row: Row): void {
    event.preventDefault();
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - 8));
    this.menu.set({ x, y, row });
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  @HostListener('window:resize')
  @HostListener('window:wheel')
  closeMenu(): void {
    if (this.menu()) this.menu.set(null);
  }

  menuActions(row: Row): MenuAction[] {
    const f = row.file;
    const actions: MenuAction[] = [];
    if (f.isFolder || f.previewable) actions.push('open');
    if (this.googleUrlFor(f)) actions.push('google');
    if (f.downloadable) actions.push('download');
    if (!this.isSharedTab()) actions.push('share');
    if (!row.item && this.canWrite()) actions.push('rename', 'delete');
    return actions;
  }

  runAction(action: MenuAction, row: Row): void {
    this.menu.set(null);
    switch (action) {
      case 'open': return this.open(row);
      case 'google': return this.openInGoogle(row.file);
      case 'download': return this.download(row);
      case 'share': return this.openShare(row.file);
      case 'rename': return this.nameDialog.set({ mode: 'rename', file: row.file, value: row.file.name });
      case 'delete': return this.toDelete.set(row.file);
    }
  }

  // ─── Documentos de Google ───────────────────────────────────────────────────

  /**
   * Enlace para trabajar el archivo en Google entre varios. Necesita que el
   * usuario tenga cuenta @iugna.edu.ar: con ella es miembro de la unidad de su
   * oficina, o recibe el permiso en Drive cuando se lo comparten.
   */
  googleUrlFor(f: SharedFile): string | null {
    const email = this.info()?.googleEmail;
    if (!f.googleUrl || !email) return null;
    // authuser hace que Google use esa cuenta aunque haya otra abierta en el navegador.
    return `${f.googleUrl}${f.googleUrl.includes('?') ? '&' : '?'}authuser=${encodeURIComponent(email)}`;
  }

  openInGoogle(f: SharedFile): void {
    const url = this.googleUrlFor(f);
    if (url) window.open(url, '_blank', 'noopener');
  }

  /** En lo compartido con "Puede ver", Google lo abre en modo lectura. */
  canEditInGoogle(row: Row): boolean {
    return row.item ? row.item.role === 'writer' : this.canWrite();
  }

  editorName(f: SharedFile): string {
    switch (this.iconKind(f)) {
      case 'sheet': return 'Hojas de cálculo de Google';
      case 'slides': return 'Presentaciones de Google';
      default: return 'Documentos de Google';
    }
  }

  editorClass(f: SharedFile): string {
    switch (this.iconKind(f)) {
      case 'sheet': return 'border-green-200 text-green-700 hover:bg-green-50 dark:border-green-900 dark:text-green-400 dark:hover:bg-green-950/40';
      case 'slides': return 'border-orange-200 text-orange-700 hover:bg-orange-50 dark:border-orange-900 dark:text-orange-400 dark:hover:bg-orange-950/40';
      default: return 'border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-400 dark:hover:bg-blue-950/40';
    }
  }

  // ─── Subida ─────────────────────────────────────────────────────────────────

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.upload(files);
  }

  onDragOver(event: DragEvent): void {
    if (this.atSharedRoot() || !this.canWrite() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (!target.contains(event.relatedTarget as Node | null)) this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    if (!this.dragOver()) return;
    event.preventDefault();
    this.dragOver.set(false);
    this.upload(Array.from(event.dataTransfer?.files ?? []));
  }

  private upload(files: File[]): void {
    const scope = this.scope();
    const folderId = this.currentFolderId();
    if (!scope || !folderId || !files.length || this.busy()) return;

    const tooBig = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig.length) {
      this.error.set(`Superan el máximo de 200 MB: ${tooBig.map((f) => f.name).join(', ')}`);
      return;
    }
    if (files.length > 20) {
      this.error.set('Se pueden subir hasta 20 archivos por vez.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.uploadLabel.set(files.length === 1 ? `Subiendo ${files[0].name}` : `Subiendo ${files.length} archivos`);
    this.uploadProgress.set(0);
    this.folders.upload(scope, folderId, files).subscribe({
      next: (ev) => {
        if (ev.type === HttpEventType.UploadProgress && ev.total) {
          // El 100 % llega cuando el backend termina de pasarlo a Drive, no al terminar de enviarlo.
          this.uploadProgress.set(Math.min(95, Math.round((ev.loaded / ev.total) * 95)));
        } else if (ev.type === HttpEventType.Response) {
          this.uploadProgress.set(100);
          this.finishUpload();
          this.mergeFiles(ev.body ?? [], folderId);
        }
      },
      error: (err) => {
        this.finishUpload();
        void this.showError(err);
      },
    });
  }

  private finishUpload(): void {
    this.busy.set(false);
    setTimeout(() => this.uploadProgress.set(null), 600);
  }

  /**
   * Incorpora a la lista los archivos que devolvió una subida, una carpeta
   * nueva o un cambio de nombre. No se vuelve a pedir la lista a Drive porque
   * su búsqueda tarda unos segundos en incluir lo recién creado.
   * Si el usuario ya está en otra carpeta, no toca nada.
   */
  private mergeFiles(changed: SharedFile[], folderId: string): void {
    if (this.currentFolderId() !== folderId || !changed.length) return;
    const ids = new Set(changed.map((f) => f.id));
    this.files.update((list) =>
      [...list.filter((f) => !ids.has(f.id)), ...changed].sort(
        (a, b) =>
          Number(b.isFolder) - Number(a.isFolder) ||
          a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }),
      ),
    );
  }

  // ─── Acciones ───────────────────────────────────────────────────────────────

  download(row: Row): void {
    this.folders.download(this.scopeFor(row), row.file.id).subscribe({
      next: (ev) => {
        if (ev.type !== HttpEventType.Response || !ev.body) return;
        const name = filenameFrom(ev.headers.get('Content-Disposition')) ?? row.file.name;
        const url = URL.createObjectURL(ev.body);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      },
      error: (err) => void this.showError(err),
    });
  }

  openNewFolder(): void {
    this.nameDialog.set({ mode: 'folder', value: '' });
  }

  submitName(): void {
    const d = this.nameDialog();
    const scope = this.scope();
    const folderId = this.currentFolderId();
    const name = d?.value.trim();
    if (!d || !scope || !folderId || !name) return;
    if (d.mode === 'rename' && name === d.file!.name) {
      this.nameDialog.set(null);
      return;
    }
    this.busy.set(true);
    const req = d.mode === 'folder'
      ? this.folders.createFolder(scope, folderId, name)
      : this.folders.rename(scope, d.file!.id, name);
    req.subscribe({
      next: (file) => {
        this.busy.set(false);
        this.nameDialog.set(null);
        this.mergeFiles([file], folderId);
      },
      error: (err) => {
        this.busy.set(false);
        this.nameDialog.set(null);
        void this.showError(err);
      },
    });
  }

  confirmDelete(f: SharedFile): void {
    const scope = this.scope();
    if (!scope) return;
    this.busy.set(true);
    this.folders.trash(scope, f.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.toDelete.set(null);
        this.files.update((list) => list.filter((x) => x.id !== f.id));
      },
      error: (err) => {
        this.busy.set(false);
        this.toDelete.set(null);
        void this.showError(err);
      },
    });
  }

  // ─── Compartir ──────────────────────────────────────────────────────────────

  private openShare(file: SharedFile): void {
    const office = this.tab();
    if (!office || office === SHARED_TAB) return;
    this.shareDialog.set(file);
    this.shareEntries.set([]);
    this.shareQuery.set('');
    this.shareResults.set([]);
    this.shareTarget.set(null);
    this.shareRole.set('reader');
    this.shareError.set(null);
    this.shareLoading.set(true);
    this.folders.listShares(office, file.id).subscribe({
      next: (entries) => {
        this.shareEntries.set(entries);
        this.shareLoading.set(false);
      },
      error: async (err) => {
        this.shareLoading.set(false);
        this.shareError.set(await errorMessage(err));
      },
    });
  }

  closeShare(): void {
    this.shareDialog.set(null);
  }

  onShareQuery(value: string): void {
    this.shareQuery.set(value);
    this.shareTarget.set(null);
    this.shareError.set(null);
    this.shareSearch$.next(value);
  }

  selectTarget(user: UserHit): void {
    this.shareTarget.set(user);
    this.shareQuery.set(user.displayName);
    this.shareResults.set([]);
  }

  submitShare(): void {
    const target = this.shareTarget();
    if (!target) return;
    this.saveShare(target.username, target.displayName, this.shareRole(), () => {
      this.shareTarget.set(null);
      this.shareQuery.set('');
    });
  }

  changeRole(entry: ShareEntry, role: ShareRole): void {
    if (role !== entry.role) this.saveShare(entry.username, entry.name, role);
  }

  private saveShare(username: string, name: string, role: ShareRole, done?: () => void): void {
    const office = this.tab();
    const file = this.shareDialog();
    if (!office || !file) return;
    this.shareSaving.set(true);
    this.shareError.set(null);
    this.folders.share(office, file.id, { username, name, role }).subscribe({
      next: (entries) => {
        this.shareEntries.set(entries);
        this.shareSaving.set(false);
        done?.();
      },
      error: async (err) => {
        this.shareSaving.set(false);
        this.shareError.set(await errorMessage(err));
      },
    });
  }

  removeShare(entry: ShareEntry): void {
    const office = this.tab();
    if (!office) return;
    this.shareSaving.set(true);
    this.folders.unshare(office, entry.id).subscribe({
      next: () => {
        this.shareEntries.update((list) => list.filter((e) => e.id !== entry.id));
        this.shareSaving.set(false);
      },
      error: async (err) => {
        this.shareSaving.set(false);
        this.shareError.set(await errorMessage(err));
      },
    });
  }

  private async showError(err: unknown): Promise<void> {
    this.error.set(await errorMessage(err));
  }

  // ─── Presentación ───────────────────────────────────────────────────────────

  initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  }

  iconKind(f: SharedFile): IconKind {
    const m = f.mimeType;
    const n = f.name.toLowerCase();
    if (f.isFolder) return 'folder';
    if (m === 'application/pdf') return 'pdf';
    if (m.startsWith('image/')) return 'image';
    if (m.includes('document') || m.includes('msword') || /\.(docx?|odt|rtf)$/.test(n)) return 'doc';
    if (m.includes('spreadsheet') || m.includes('excel') || /\.(xlsx?|ods|csv)$/.test(n)) return 'sheet';
    if (m.includes('presentation') || m.includes('powerpoint') || /\.(pptx?|odp)$/.test(n)) return 'slides';
    if (/zip|rar|7z|compressed|tar/.test(m)) return 'archive';
    return 'file';
  }

  iconBg(f: SharedFile): string {
    switch (this.iconKind(f)) {
      case 'folder': return 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400';
      case 'pdf': return 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400';
      case 'doc': return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400';
      case 'sheet': return 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400';
      case 'slides': return 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400';
      case 'image': return 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400';
      case 'archive': return 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300';
      default: return 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400';
    }
  }

  typeLabel(f: SharedFile): string {
    if (f.isFolder) return 'Carpeta';
    const google: Record<string, string> = {
      'application/vnd.google-apps.document': 'Documento de Google',
      'application/vnd.google-apps.spreadsheet': 'Hoja de cálculo de Google',
      'application/vnd.google-apps.presentation': 'Presentación de Google',
      'application/vnd.google-apps.drawing': 'Dibujo de Google',
      'application/vnd.google-apps.form': 'Formulario de Google',
    };
    if (google[f.mimeType]) return google[f.mimeType];
    const ext = f.name.includes('.') ? f.name.split('.').pop()!.toUpperCase() : '';
    return ext ? `Archivo ${ext}` : 'Archivo';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toLocaleString('es-AR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString('es-AR', {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

/** Mensaje del backend; con responseType 'blob' el error también llega como Blob. */
async function errorMessage(err: unknown): Promise<string> {
  if (err instanceof HttpErrorResponse) {
    let body = err.error;
    if (body instanceof Blob) {
      try { body = JSON.parse(await body.text()); } catch { body = null; }
    }
    if (err.status === 413) return 'El archivo supera el tamaño máximo (200 MB).';
    if (typeof body?.message === 'string') return body.message;
  }
  return 'No se pudo completar la operación.';
}

/** Nombre del archivo desde Content-Disposition (prefiere filename* en UTF-8). */
function filenameFrom(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try { return decodeURIComponent(utf8[1]); } catch { /* sigue con filename */ }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}
