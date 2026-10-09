import { Component, HostListener, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { NgClass } from '@angular/common';
import { AppNotification, NotificationsService } from '../../core/services/notifications.service';
import { NewBadgeComponent } from '../new-badge/new-badge.component';

/**
 * Campanita del encabezado: anuncios y archivos compartidos con el usuario.
 * Al tocar un anuncio lo muestra en un modal; al tocar algo compartido lleva
 * a "Compartidos conmigo" con ese elemento resaltado.
 */
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [NgClass, NewBadgeComponent],
  template: `
<div class="relative flex items-center gap-1.5">
  <app-new-badge feature="notificaciones" />
  <button (click)="toggle(); $event.stopPropagation()"
    class="relative h-9 w-9 flex items-center justify-center rounded-lg transition-colors text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-800 dark:hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    [ngClass]="{ 'bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-100': open() }"
    [attr.aria-label]="notifications.unread() ? 'Notificaciones, ' + notifications.unread() + ' sin leer' : 'Notificaciones'"
    aria-haspopup="dialog" [attr.aria-expanded]="open()">
    <svg class="h-5 w-5" [class.bell-ring]="ringing()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 003.4 0" />
    </svg>
    @if (notifications.unread() > 0) {
      <span class="badge-pop absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
        {{ notifications.unread() > 99 ? '99+' : notifications.unread() }}
      </span>
    }
  </button>

  @if (open()) {
    <!-- Por encima del cartel de anuncios (z-[99998]) -->
    <div class="panel-in absolute right-0 top-full mt-2 w-[23rem] max-w-[calc(100vw-2rem)] z-[99999] overflow-hidden rounded-2xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl"
         (click)="$event.stopPropagation()" role="dialog" aria-label="Notificaciones">
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Notificaciones</h2>
        @if (notifications.unread() > 0) {
          <button (click)="notifications.markAllRead()" class="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline">
            Marcar todas como leídas
          </button>
        }
      </div>

      @if (!notifications.items().length) {
        <div class="py-12 px-6 text-center">
          <svg class="h-12 w-12 mx-auto text-gray-300 dark:text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 003.4 0" />
          </svg>
          <p class="mt-3 text-sm font-medium text-gray-700 dark:text-zinc-300">No tenés notificaciones</p>
          <p class="text-xs text-gray-500 dark:text-zinc-400">Acá van a aparecer los anuncios y los avisos de MTO que pediste en «Mis alertas».</p>
        </div>
      } @else {
        <ul class="max-h-[26rem] overflow-y-auto divide-y divide-gray-100 dark:divide-zinc-800">
          @for (n of notifications.items(); track n.id) {
            <li>
              <button (click)="openItem(n)" class="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/70"
                      [ngClass]="{ 'bg-teal-50/60 dark:bg-teal-950/20': !n.read }">
                @if (n.type === 'announcement') {
                  <span class="h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                    <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM16 8a5 5 0 010 8M19 5a9 9 0 010 14" />
                    </svg>
                  </span>
                } @else if (n.type === 'upload') {
                  <span class="h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
                    <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
                    </svg>
                  </span>
                } @else if (n.type === 'mto') {
                  <!-- MTO seguido o que coincide con "Mis alertas" -->
                  <span class="h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                    <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path [attr.d]="MTO_ICON" />
                    </svg>
                  </span>
                } @else if (n.type === 'scan') {
                  <!-- Escaneo de una impresora -->
                  <span class="h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                    <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 13h10M8 17v4h8v-4" />
                    </svg>
                  </span>
                } @else {
                  <span class="h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
                    <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 15l2 2 4-4" />
                    </svg>
                  </span>
                }
                <span class="min-w-0 flex-1">
                  <span class="block text-sm text-gray-900 dark:text-zinc-100" [class.font-semibold]="!n.read">{{ n.title }}</span>
                  <!-- Sin "block": pisaría el display de line-clamp y se vería el texto entero -->
                  <span class="text-xs text-gray-600 dark:text-zinc-400 line-clamp-2 mt-0.5">{{ n.body }}</span>
                  <span class="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-zinc-500 mt-1">
                    {{ timeAgo(n.createdAt) }}
                    @if (n.type === 'announcement') {
                      <span aria-hidden="true">·</span>
                      <span class="font-medium text-amber-600 dark:text-amber-400">Ver anuncio completo</span>
                    }
                  </span>
                </span>
                @if (!n.read) {
                  <span class="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-teal-500" aria-label="Sin leer"></span>
                }
              </button>
            </li>
          }
        </ul>
      }
    </div>
  }
</div>

<!-- Modal con el anuncio -->
@if (notifications.openAnnouncement(); as a) {
  <div class="fixed inset-0 z-[100001] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" (click)="notifications.openAnnouncement.set(null)">
    <div class="modal-in w-full max-w-lg overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-gray-100 dark:border-zinc-700"
         (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="announcement-title">
      <div class="flex items-center gap-3 px-6 py-4 bg-amber-500 text-white">
        <span class="h-10 w-10 flex-shrink-0 rounded-full bg-white/20 flex items-center justify-center">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM16 8a5 5 0 010 8M19 5a9 9 0 010 14" />
          </svg>
        </span>
        <div class="min-w-0">
          <h2 id="announcement-title" class="text-base font-semibold">Anuncio{{ a.senderName ? ' de ' + a.senderName : '' }}</h2>
          <p class="text-xs opacity-90">{{ fullDate(a.sentAt) }}</p>
        </div>
      </div>
      <p class="px-6 py-5 text-sm leading-relaxed text-gray-800 dark:text-zinc-200 whitespace-pre-line">{{ a.message }}</p>
      <div class="px-6 pb-5 flex justify-end">
        <button (click)="notifications.openAnnouncement.set(null)"
          class="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600">Cerrar</button>
      </div>
    </div>
  </div>
}
  `,
  styles: [`
    /* La campanita se sacude cuando llega algo */
    .bell-ring { transform-origin: 50% 2px; animation: ring 1s ease-in-out; }
    @keyframes ring {
      0%, 100% { transform: rotate(0); }
      10% { transform: rotate(18deg); } 20% { transform: rotate(-16deg); }
      30% { transform: rotate(13deg); } 40% { transform: rotate(-10deg); }
      50% { transform: rotate(7deg); } 60% { transform: rotate(-4deg); } 70% { transform: rotate(2deg); }
    }
    .badge-pop { animation: badge-pop .35s cubic-bezier(.2, .9, .3, 1.6); }
    @keyframes badge-pop { from { transform: scale(.3); } to { transform: scale(1); } }
    .panel-in { animation: panel-in .18s ease-out; transform-origin: top right; }
    @keyframes panel-in { from { opacity: 0; transform: translateY(-6px) scale(.97); } to { opacity: 1; transform: none; } }
    .modal-in { animation: modal-in .25s cubic-bezier(.2, .9, .3, 1.2); }
    @keyframes modal-in { from { opacity: 0; transform: translateY(12px) scale(.96); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .bell-ring, .badge-pop, .panel-in, .modal-in { animation: none; }
    }
  `],
})
export class NotificationBellComponent {
  readonly notifications = inject(NotificationsService);
  private readonly router = inject(Router);
  /** Sobres (el mismo del MTO compartido en Conversaciones). */
  readonly MTO_ICON =
    'M13.021 11.17q.218.16.479.16t.479-.16L21 5.943q0-.254-.067-.559q-.067-.304-.125-.5L13.5 10.311L6.154 4.923q-.058.196-.106.492Q6 5.71 6 5.945zm-9.405 8.6q-.691 0-1.153-.463T2 18.154v-9q0-.214.143-.357t.357-.143t.357.143t.143.357v9q0 .269.173.442t.443.173h14.269q.213 0 .356.143t.144.357t-.144.357t-.356.143zm3-3q-.691 0-1.153-.463T5 15.154v-9.77q0-.69.463-1.152t1.153-.463h13.769q.69 0 1.153.463T22 5.385v9.769q0 .69-.462 1.153t-1.153.462z';

  readonly open = signal(false);
  readonly ringing = signal(false);

  constructor() {
    let first = true;
    effect(() => {
      this.notifications.ring();
      if (first) { first = false; return; }
      untracked(() => {
        this.ringing.set(false);
        // Un frame para reiniciar la animación si llegan dos seguidas.
        requestAnimationFrame(() => this.ringing.set(true));
        setTimeout(() => this.ringing.set(false), 1100);
      });
    });
  }

  toggle(): void {
    this.open.update((o) => !o);
    if (this.open()) this.notifications.load();
  }

  @HostListener('document:click')
  close(): void {
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
    this.notifications.openAnnouncement.set(null);
  }

  openItem(n: AppNotification): void {
    this.notifications.markRead(n);
    this.open.set(false);
    if (n.type === 'announcement') {
      this.notifications.showAnnouncement(n);
    } else if (n.type === 'share') {
      void this.router.navigate(['/archivos'], { queryParams: { compartido: n.data['shareId'] } });
    } else if (n.type === 'upload') {
      const fileIds = (n.data['fileIds'] as string[] | undefined) ?? [];
      void this.router.navigate(['/archivos'], {
        queryParams: { oficina: n.data['groupName'], carpeta: n.data['folderId'], archivo: fileIds[0] },
      });
    } else if (n.type === 'mto') {
      void this.router.navigate(['/correo'], { queryParams: { mto: n.data['emailId'] } });
    } else if (n.type === 'scan') {
      void this.router.navigate(['/archivos'], {
        queryParams: { escaneos: n.data['groupName'], escaneo: n.data['scanId'] },
      });
    }
  }

  timeAgo(iso: string): string {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'Recién';
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
    if (diff < 172800) return 'Ayer';
    return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  }

  fullDate(iso: string): string {
    return new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }
}
