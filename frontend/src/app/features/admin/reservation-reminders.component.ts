import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CometSpinnerComponent } from '../../shared/comet-spinner/comet-spinner.component';

/**
 * Administración → Avisos de reservas (TICOM): a qué correos llega el aviso de
 * todas las videoconferencias (20:00 del día anterior y 6:30 del mismo día).
 */
@Component({
  selector: 'app-reservation-reminders',
  standalone: true,
  imports: [CommonModule, CometSpinnerComponent],
  template: `
    <div class="max-w-3xl">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Avisos de videoconferencias</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-zinc-400">
        Estos correos reciben el aviso de <strong>todas</strong> las videoconferencias reservadas:
        a las <strong>20:00 del día anterior</strong> y a las <strong>6:30 del mismo día</strong>.
      </p>

      <div class="mt-5 flex gap-2">
        <input type="email" placeholder="correo@iugna.edu.ar"
          [value]="draft()" (input)="draft.set($any($event.target).value)" (keydown.enter)="add()"
          class="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
        <button (click)="add()" [disabled]="!draft().trim() || saving()"
          class="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
          Agregar
        </button>
      </div>
      <p class="mt-1 text-xs text-gray-400 dark:text-zinc-500">Podés pegar varios separados por coma, punto y coma o espacio.</p>
      @if (error()) {
        <p class="mt-2 text-sm text-red-600">{{ error() }}</p>
      }

      <div class="mt-5 overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-700">
        @if (loading()) {
          <div class="flex justify-center py-6"><app-comet-spinner [size]="24" /></div>
        } @else {
          @for (e of emails(); track e) {
            <div class="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-zinc-700 last:border-b-0 px-4 py-2.5 text-sm">
              <span class="truncate text-gray-800 dark:text-zinc-100">{{ e }}</span>
              <button (click)="remove(e)" [disabled]="saving()"
                class="flex-shrink-0 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20">
                Quitar
              </button>
            </div>
          } @empty {
            <p class="px-4 py-5 text-sm text-gray-400 dark:text-zinc-500">
              No hay correos cargados: el aviso se envía como antes (TICOM y cada Ayudantía).
            </p>
          }
        }
      </div>
      @if (savedAt()) {
        <p class="mt-2 text-xs text-teal-600">Guardado.</p>
      }
    </div>
  `,
})
export class ReservationRemindersComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly emails = signal<string[]>([]);
  readonly draft = signal('');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedAt = signal<number | null>(null);

  ngOnInit(): void {
    this.http.get<{ emails: string[] }>('/api/reservation-reminders').subscribe({
      next: (r) => {
        this.emails.set(r.emails);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('No se pudo cargar la lista.');
      },
    });
  }

  add(): void {
    const nuevos = this.draft().split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!nuevos.length) return;
    const mal = nuevos.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (mal.length) {
      this.error.set(`Revisá: ${mal.join(', ')}`);
      return;
    }
    this.save([...new Set([...this.emails(), ...nuevos])], () => this.draft.set(''));
  }

  remove(email: string): void {
    this.save(this.emails().filter((e) => e !== email));
  }

  private save(list: string[], done?: () => void): void {
    this.saving.set(true);
    this.error.set(null);
    this.savedAt.set(null);
    this.http.put<{ emails: string[] }>('/api/reservation-reminders', { emails: list }).subscribe({
      next: (r) => {
        this.emails.set(r.emails);
        this.saving.set(false);
        this.savedAt.set(Date.now());
        done?.();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? 'No se pudo guardar. Probá de nuevo.');
      },
    });
  }
}
