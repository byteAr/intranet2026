import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { OfficesInfo, SharedFile, SharedFoldersService } from '../../core/services/shared-folders.service';

const LAST_OFFICE_KEY = 'pac_shared_folders_office';
/** Igual al límite del backend. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

type IconKind = 'folder' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'image' | 'archive' | 'file';

interface Crumb { id: string; name: string; }
interface NameDialog { mode: 'folder' | 'rename'; file?: SharedFile; value: string; }

@Component({
  selector: 'app-shared-folders',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="space-y-5">

  <!-- Header -->
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">Carpetas compartidas</h1>
      <p class="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
        Archivos de tu oficina, guardados en Google Drive.
      </p>
    </div>
    @if (office() && info()?.hasGoogleAccount && currentFolderId()) {
      <a [href]="'https://drive.google.com/drive/folders/' + currentFolderId()" target="_blank" rel="noopener"
         class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-zinc-700
                text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
        </svg>
        Abrir en Google Drive
      </a>
    }
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
  } @else if (!info()!.offices.length) {
    <div class="rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-8 text-center">
      <p class="text-gray-700 dark:text-zinc-300 font-medium">No pertenecés a ninguna oficina.</p>
      <p class="text-sm text-gray-500 dark:text-zinc-400 mt-1">Las carpetas se asignan según la oficina de tu usuario. Si es un error, avisá a TICOM.</p>
    </div>
  } @else {

    <!-- Oficinas (solo si hay más de una) -->
    @if (info()!.offices.length > 1) {
      <div class="flex gap-1 bg-gray-100 dark:bg-zinc-800 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        @for (o of info()!.offices; track o) {
          <button (click)="selectOffice(o)"
            class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            [class]="office() === o
              ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-zinc-100 shadow-sm'
              : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'">
            {{ o }}
          </button>
        }
      </div>
    }

    <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-sm relative"
         (dragover)="onDragOver($event)" (dragleave)="onDragLeave($event)" (drop)="onDrop($event)">

      <!-- Barra: ruta + acciones -->
      <div class="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
        <nav class="flex items-center gap-1 text-sm min-w-0 flex-wrap" aria-label="Ruta">
          @for (c of path(); track c.id; let last = $last; let first = $first) {
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
      } @else if (!visibleFiles().length) {
        <div class="py-16 text-center px-4">
          <svg class="h-12 w-12 mx-auto text-gray-300 dark:text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
          </svg>
          @if (filter().trim()) {
            <p class="mt-3 text-sm text-gray-500 dark:text-zinc-400">Nada coincide con "{{ filter().trim() }}" en esta carpeta.</p>
          } @else {
            <p class="mt-3 text-sm font-medium text-gray-700 dark:text-zinc-300">Esta carpeta está vacía</p>
            <p class="text-sm text-gray-500 dark:text-zinc-400">Arrastrá archivos acá o usá el botón Subir.</p>
          }
        </div>
      } @else {
        <ul class="divide-y divide-gray-100 dark:divide-zinc-800">
          @for (f of visibleFiles(); track f.id) {
            <li class="group flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/60">
              <button (click)="open(f)" class="flex items-center gap-3 min-w-0 flex-1 text-left"
                      [title]="f.isFolder ? 'Abrir carpeta' : (f.isGoogleDoc && info()!.hasGoogleAccount ? 'Abrir en Google' : 'Descargar')">
                <span class="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0" [class]="iconBg(f)">
                  @switch (iconKind(f)) {
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
                  <span class="block text-sm font-medium text-gray-900 dark:text-zinc-100 truncate">{{ f.name }}</span>
                  <span class="block text-xs text-gray-500 dark:text-zinc-400 truncate">
                    {{ typeLabel(f) }}@if (f.size !== null) { · {{ formatSize(f.size) }} }
                  </span>
                </span>
              </button>

              <span class="hidden md:block w-56 text-xs text-gray-500 dark:text-zinc-400 truncate text-right">
                @if (f.modifiedTime) { {{ formatDate(f.modifiedTime) }} }
                @if (f.modifiedBy) { <span class="block truncate">{{ f.modifiedBy }}</span> }
              </span>

              <div class="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                @if (f.downloadable) {
                  <button (click)="download(f)" class="p-1.5 rounded-md text-gray-500 hover:text-teal-700 hover:bg-teal-50 dark:hover:bg-zinc-700" title="Descargar" aria-label="Descargar">
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>
                  </button>
                }
                @if (info()!.hasGoogleAccount && f.webViewLink) {
                  <a [href]="f.webViewLink" target="_blank" rel="noopener" class="p-1.5 rounded-md text-gray-500 hover:text-teal-700 hover:bg-teal-50 dark:hover:bg-zinc-700" title="Abrir en Google Drive" aria-label="Abrir en Google Drive">
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
                  </a>
                }
                <button (click)="openRename(f)" class="p-1.5 rounded-md text-gray-500 hover:text-teal-700 hover:bg-teal-50 dark:hover:bg-zinc-700" title="Cambiar nombre" aria-label="Cambiar nombre">
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
                </button>
                <button (click)="toDelete.set(f)" class="p-1.5 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-zinc-700" title="Borrar" aria-label="Borrar">
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
                </button>
              </div>
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

    @if (!info()!.hasGoogleAccount) {
      <p class="text-xs text-gray-500 dark:text-zinc-400">
        Tu usuario no tiene cuenta &#64;iugna.edu.ar: podés usar la carpeta desde acá, pero no verla en Google Drive.
      </p>
    }
  }
</div>

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
        «{{ f.name }}»{{ f.isFolder ? ' y todo su contenido' : '' }} va a la papelera de la unidad. Se puede recuperar desde Google Drive durante 30 días.
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
  `,
})
export class SharedFoldersComponent implements OnInit {
  private readonly service = inject(SharedFoldersService);

  readonly info = signal<OfficesInfo | null>(null);
  readonly loadingInfo = signal(true);
  readonly office = signal<string | null>(null);
  readonly path = signal<Crumb[]>([]);
  readonly files = signal<SharedFile[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly uploadProgress = signal<number | null>(null);
  readonly uploadLabel = signal('');
  readonly dragOver = signal(false);
  readonly nameDialog = signal<NameDialog | null>(null);
  readonly toDelete = signal<SharedFile | null>(null);
  readonly filter = signal('');

  readonly currentFolderId = computed(() => this.path().at(-1)?.id ?? null);
  readonly visibleFiles = computed(() => {
    const files = this.files();
    const q = this.filter().trim().toLowerCase();
    return q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files;
  });

  ngOnInit(): void {
    this.service.offices().subscribe({
      next: (info) => {
        this.info.set(info);
        this.loadingInfo.set(false);
        if (!info.configured || !info.offices.length) return;
        let last: string | null = null;
        try { last = localStorage.getItem(LAST_OFFICE_KEY); } catch { /* sin storage */ }
        this.selectOffice(last && info.offices.includes(last) ? last : info.offices[0]);
      },
      error: () => {
        this.info.set({ configured: false, hasGoogleAccount: false, offices: [] });
        this.loadingInfo.set(false);
      },
    });
  }

  // ─── Navegación ─────────────────────────────────────────────────────────────

  selectOffice(office: string): void {
    this.office.set(office);
    try { localStorage.setItem(LAST_OFFICE_KEY, office); } catch { /* sin storage */ }
    this.path.set([]);
    this.load();
  }

  goTo(index: number): void {
    this.path.update((p) => p.slice(0, index + 1));
    this.load(this.path()[index].id);
  }

  open(f: SharedFile): void {
    if (f.isFolder) {
      this.path.update((p) => [...p, { id: f.id, name: f.name }]);
      this.load(f.id);
    } else if (f.isGoogleDoc && this.info()?.hasGoogleAccount && f.webViewLink) {
      window.open(f.webViewLink, '_blank', 'noopener');
    } else if (f.downloadable) {
      this.download(f);
    }
  }

  private load(folderId?: string): void {
    const office = this.office();
    if (!office) return;
    this.loading.set(true);
    this.error.set(null);
    this.filter.set('');
    this.service.list(office, folderId).subscribe({
      next: (res) => {
        this.files.set(res.files);
        // La raíz se nombra con la oficina; las subcarpetas ya están en la ruta.
        if (!this.path().length) this.path.set([{ id: res.folder.id, name: office }]);
        this.loading.set(false);
      },
      error: (err) => {
        this.files.set([]);
        this.loading.set(false);
        void this.showError(err);
      },
    });
  }

  private reload(): void {
    this.load(this.currentFolderId() ?? undefined);
  }

  // ─── Subida ─────────────────────────────────────────────────────────────────

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.upload(files);
  }

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (!target.contains(event.relatedTarget as Node | null)) this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.upload(Array.from(event.dataTransfer?.files ?? []));
  }

  private upload(files: File[]): void {
    const office = this.office();
    const folderId = this.currentFolderId();
    if (!office || !folderId || !files.length || this.busy()) return;

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
    this.service.upload(office, folderId, files).subscribe({
      next: (ev) => {
        if (ev.type === HttpEventType.UploadProgress && ev.total) {
          // El 100 % llega cuando el backend termina de pasarlo a Drive, no al terminar de enviarlo.
          this.uploadProgress.set(Math.min(95, Math.round((ev.loaded / ev.total) * 95)));
        } else if (ev.type === HttpEventType.Response) {
          this.uploadProgress.set(100);
          this.finishUpload();
          this.reload();
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

  // ─── Acciones ───────────────────────────────────────────────────────────────

  download(f: SharedFile): void {
    const office = this.office();
    if (!office) return;
    this.service.download(office, f.id).subscribe({
      next: (ev) => {
        if (ev.type !== HttpEventType.Response || !ev.body) return;
        const name = filenameFrom(ev.headers.get('Content-Disposition')) ?? f.name;
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

  openRename(f: SharedFile): void {
    this.nameDialog.set({ mode: 'rename', file: f, value: f.name });
  }

  submitName(): void {
    const d = this.nameDialog();
    const office = this.office();
    const folderId = this.currentFolderId();
    const name = d?.value.trim();
    if (!d || !office || !folderId || !name) return;
    if (d.mode === 'rename' && name === d.file!.name) {
      this.nameDialog.set(null);
      return;
    }
    this.busy.set(true);
    const req = d.mode === 'folder'
      ? this.service.createFolder(office, folderId, name)
      : this.service.rename(office, d.file!.id, name);
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.nameDialog.set(null);
        this.reload();
      },
      error: (err) => {
        this.busy.set(false);
        this.nameDialog.set(null);
        void this.showError(err);
      },
    });
  }

  confirmDelete(f: SharedFile): void {
    const office = this.office();
    if (!office) return;
    this.busy.set(true);
    this.service.trash(office, f.id).subscribe({
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

  private async showError(err: unknown): Promise<void> {
    let message = 'No se pudo completar la operación.';
    if (err instanceof HttpErrorResponse) {
      let body = err.error;
      // Con responseType 'blob' el error también llega como Blob.
      if (body instanceof Blob) {
        try { body = JSON.parse(await body.text()); } catch { body = null; }
      }
      if (err.status === 413) message = 'El archivo supera el tamaño máximo (200 MB).';
      else if (typeof body?.message === 'string') message = body.message;
    }
    this.error.set(message);
  }

  // ─── Presentación ───────────────────────────────────────────────────────────

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

/** Nombre del archivo desde Content-Disposition (prefiere filename* en UTF-8). */
function filenameFrom(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try { return decodeURIComponent(utf8[1]); } catch { /* sigue con filename */ }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}
