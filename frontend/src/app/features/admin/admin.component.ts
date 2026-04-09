import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

interface Department { id: string; name: string; createdAt: string; }
interface AdminUser {
  id: string | null;
  username: string;
  email: string;
  recoveryEmail?: string | null;
  rank?: string | null;
  displayName: string;
  firstName?: string;
  lastName?: string;
  office?: string;
  title?: string;
  roles: string[];
  mustChangePassword: boolean;
  hasLoggedIn: boolean;
  enabledInAd: boolean;
  lastLoginAt?: string | null;
}
interface UsernameSuggestion { username: string; available: boolean; }

const RANK_GROUPS = [
  {
    label: 'Oficiales',
    options: [
      { value: 'SUBALF',  label: 'SUBALFEREZ' },
      { value: 'ALF',     label: 'ALFEREZ' },
      { value: '1ER ALF', label: 'PRIMER ALFEREZ' },
      { value: '2DO CTE', label: 'SEGUNDO COMANDANTE' },
      { value: 'CTE',     label: 'COMANDANTE' },
      { value: 'CTE PR',  label: 'COMANDANTE PRINCIPAL' },
      { value: 'CTE MY',  label: 'COMANDANTE MAYOR' },
      { value: 'CTE GRL', label: 'COMANDANTE GENERAL' },
    ],
  },
  {
    label: 'Suboficiales',
    options: [
      { value: 'GEND', label: 'GENDARME' },
      { value: 'CBO',  label: 'CABO' },
      { value: 'CRO',  label: 'CABO PRIMERO' },
      { value: 'SARG', label: 'SARGENTO' },
      { value: 'SRO',  label: 'SARGENTO PRIMERO' },
      { value: 'SAY',  label: 'SARGENTO AYUDANTE' },
      { value: 'SPR',  label: 'SUBOFICIAL PRINCIPAL' },
      { value: 'SMY',  label: 'SUBOFICIAL MAYOR' },
    ],
  },
];

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-6 max-w-6xl mx-auto">
      <h1 class="text-2xl font-bold text-gray-800 dark:text-white mb-6">Panel de Administración</h1>

      <!-- Tabs -->
      <div class="flex border-b border-gray-200 dark:border-zinc-700 mb-6">
        <button (click)="activeTab.set('users')"
          class="px-6 py-3 text-sm font-medium border-b-2 transition-colors"
          [class.border-teal-600]="activeTab() === 'users'"
          [class.text-teal-600]="activeTab() === 'users'"
          [class.dark:text-teal-400]="activeTab() === 'users'"
          [class.border-transparent]="activeTab() !== 'users'"
          [class.text-gray-500]="activeTab() !== 'users'">
          Usuarios
        </button>
        <button (click)="activeTab.set('departments')"
          class="px-6 py-3 text-sm font-medium border-b-2 transition-colors"
          [class.border-teal-600]="activeTab() === 'departments'"
          [class.text-teal-600]="activeTab() === 'departments'"
          [class.dark:text-teal-400]="activeTab() === 'departments'"
          [class.border-transparent]="activeTab() !== 'departments'"
          [class.text-gray-500]="activeTab() !== 'departments'">
          Áreas de trabajo
        </button>
      </div>

      <!-- ── USUARIOS ── -->
      @if (activeTab() === 'users') {
        <div>
          <div class="flex items-center justify-between mb-4">
            <input [(ngModel)]="searchQuery" (ngModelChange)="filterUsers()"
              type="text" placeholder="Buscar por nombre, usuario u oficina..."
              class="w-64 px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <button (click)="openCreateModal()"
              class="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Nuevo usuario
            </button>
          </div>

          @if (loadingUsers()) {
            <div class="flex justify-center py-12">
              <svg class="animate-spin h-8 w-8" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="url(#g1)" stroke-width="4"/>
                <path class="opacity-75" fill="url(#g1)" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                <defs><linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#0d9488"/><stop offset="100%" stop-color="#6366f1"/>
                </linearGradient></defs>
              </svg>
            </div>
          } @else {
            <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 dark:bg-zinc-800">
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Nombre</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Usuario</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Correos</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Área</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Jerarquía</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Estado</th>
                    <th class="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-zinc-700">
                  @for (user of filteredUsers(); track user.username) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-zinc-800/50"
                      [class.opacity-50]="!user.enabledInAd">
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ user.displayName }}</td>
                      <td class="px-4 py-3 text-gray-500 dark:text-zinc-400 font-mono text-xs">{{ user.username }}</td>
                      <td class="px-4 py-3 text-xs">
                        <div class="text-gray-700 dark:text-zinc-300">{{ user.email || '—' }}</div>
                        @if (user.recoveryEmail) {
                          <div class="text-gray-400 dark:text-zinc-500 mt-0.5">
                            <span class="text-gray-300 dark:text-zinc-600">↳</span> {{ user.recoveryEmail }}
                          </div>
                        } @else {
                          <div class="text-gray-300 dark:text-zinc-600 mt-0.5 italic">Sin correo de recuperación</div>
                        }
                      </td>
                      <td class="px-4 py-3 text-gray-500 dark:text-zinc-400">{{ user.office || '—' }}</td>
                      <td class="px-4 py-3 text-gray-500 dark:text-zinc-400 text-xs">{{ user.title || '—' }}</td>
                      <td class="px-4 py-3">
                        @if (!user.enabledInAd) {
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 dark:bg-zinc-700 dark:text-zinc-400">
                            Deshabilitado
                          </span>
                        } @else if (!user.hasLoggedIn) {
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-zinc-300">
                            Nunca ingresó
                          </span>
                        } @else if (user.mustChangePassword) {
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                            Sin contraseña propia
                          </span>
                        } @else {
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                            Activo
                          </span>
                        }
                      </td>
                      <td class="px-4 py-3 text-right">
                        <button (click)="openEditModal(user)"
                          class="text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-200 text-xs font-medium">
                          Editar
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400 dark:text-zinc-500">
                      No se encontraron usuarios
                    </td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }

      <!-- ── ÁREAS ── -->
      @if (activeTab() === 'departments') {
        <div>
          <div class="flex items-center gap-3 mb-4">
            <input [(ngModel)]="newDeptName" type="text" placeholder="Nombre del área nueva..."
              class="w-64 px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <button (click)="createDepartment()" [disabled]="!newDeptName.trim() || savingDept()"
              class="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              Agregar área
            </button>
          </div>

          @if (deptError()) {
            <p class="text-red-500 text-sm mb-3">{{ deptError() }}</p>
          }

          <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 divide-y divide-gray-200 dark:divide-zinc-700">
            @for (dept of departments(); track dept.id) {
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-sm font-medium text-gray-900 dark:text-white">{{ dept.name }}</span>
                <button (click)="deleteDepartment(dept.id)"
                  class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium">
                  Eliminar
                </button>
              </div>
            } @empty {
              <div class="px-4 py-8 text-center text-gray-400 dark:text-zinc-500 text-sm">No hay áreas registradas</div>
            }
          </div>
        </div>
      }
    </div>

    <!-- ── MODAL CREAR USUARIO ── -->
    @if (showCreateModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Nuevo usuario</h2>
            <button (click)="closeCreateModal()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div class="px-6 py-5 space-y-4">

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Nombre *</label>
                <input [(ngModel)]="form.firstName" (ngModelChange)="onNameChange()"
                  type="text" placeholder="Ej: Juan"
                  class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Segundo nombre</label>
                <input [(ngModel)]="form.secondName" (ngModelChange)="onNameChange()"
                  type="text" placeholder="Ej: Carlos (opcional)"
                  class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Apellido *</label>
              <input [(ngModel)]="form.lastName" (ngModelChange)="onNameChange()"
                type="text" placeholder="Ej: López"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>

            <!-- Username sugerido -->
            @if (suggestedUsername()) {
              <div class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                [class.bg-green-50]="usernameAvailable()"
                [class.dark:bg-green-900/20]="usernameAvailable()"
                [class.text-green-700]="usernameAvailable()"
                [class.dark:text-green-300]="usernameAvailable()"
                [class.bg-red-50]="!usernameAvailable()"
                [class.dark:bg-red-900/20]="!usernameAvailable()"
                [class.text-red-700]="!usernameAvailable()"
                [class.dark:text-red-300]="!usernameAvailable()">
                <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  @if (usernameAvailable()) {
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                  } @else {
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                  }
                </svg>
                <span>
                  Usuario: <strong class="font-mono">{{ suggestedUsername() }}</strong>
                  {{ usernameAvailable() ? ' — disponible' : ' — en uso (agregue segundo nombre)' }}
                </span>
              </div>
            }
            @if (loadingSuggestion()) {
              <p class="text-xs text-gray-400">Verificando nombre de usuario...</p>
            }

            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Área de trabajo *</label>
              <select [(ngModel)]="form.office"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">Seleccionar área...</option>
                @for (dept of departments(); track dept.id) {
                  <option [value]="dept.name">{{ dept.name }}</option>
                }
              </select>
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Jerarquía</label>
              <select [(ngModel)]="form.title"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">— Sin jerarquía —</option>
                @for (group of rankGroups; track group.label) {
                  <optgroup [label]="group.label">
                    @for (opt of group.options; track opt.value) {
                      <option [value]="opt.value">{{ opt.label }}</option>
                    }
                  </optgroup>
                }
              </select>
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Correo institucional * <span class="text-gray-400">(@iugna.edu.ar)</span></label>
              <input [(ngModel)]="form.email" type="email" placeholder="usuario@iugna.edu.ar"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                [class.border-red-400]="form.email && !isValidEmail(form.email)" />
              @if (form.email && !isValidEmail(form.email)) {
                <p class="text-xs text-red-500 mt-1">El correo debe ser @iugna.edu.ar</p>
              }
              @if (suggestedUsername() && usernameAvailable() && !form.email) {
                <p class="text-xs text-gray-400 mt-1">Sugerencia: {{ suggestedUsername() }}&#64;iugna.edu.ar</p>
              }
            </div>

            <div class="bg-amber-50 dark:bg-amber-900/20 rounded-lg px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              La contraseña inicial será <strong>Iugna.{{ currentYear2() }}</strong>. El usuario deberá cambiarla en su primer ingreso.
            </div>

            @if (createError()) {
              <p class="text-sm text-red-500">{{ createError() }}</p>
            }
          </div>

          <div class="px-6 py-4 border-t border-gray-200 dark:border-zinc-700 flex justify-end gap-3">
            <button (click)="closeCreateModal()"
              class="px-4 py-2 text-sm text-gray-600 dark:text-zinc-300 hover:text-gray-800 dark:hover:text-white">
              Cancelar
            </button>
            <button (click)="submitCreateUser()"
              [disabled]="!canSubmit() || saving()"
              class="px-5 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
              @if (saving()) {
                <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              }
              Crear usuario
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── MODAL EDITAR USUARIO ── -->
    @if (showEditModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
              Editar: {{ editingUser()?.displayName }}
            </h2>
            <button (click)="closeEditModal()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div class="px-6 py-5 space-y-4">
            <div class="text-sm text-gray-500 dark:text-zinc-400 font-mono">{{ editingUser()?.username }}</div>

            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Área de trabajo</label>
              <select [(ngModel)]="editForm.office"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">Sin área</option>
                @for (dept of departments(); track dept.id) {
                  <option [value]="dept.name">{{ dept.name }}</option>
                }
              </select>
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Jerarquía</label>
              <select [(ngModel)]="editForm.title"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">— Sin jerarquía —</option>
                @for (group of rankGroups; track group.label) {
                  <optgroup [label]="group.label">
                    @for (opt of group.options; track opt.value) {
                      <option [value]="opt.value">{{ opt.label }}</option>
                    }
                  </optgroup>
                }
              </select>
            </div>

            @if (editError()) {
              <p class="text-sm text-red-500">{{ editError() }}</p>
            }
          </div>

          <div class="px-6 py-4 border-t border-gray-200 dark:border-zinc-700 flex justify-end gap-3">
            <button (click)="closeEditModal()"
              class="px-4 py-2 text-sm text-gray-600 dark:text-zinc-300 hover:text-gray-800 dark:hover:text-white">
              Cancelar
            </button>
            <button (click)="submitEditUser()" [disabled]="saving()"
              class="px-5 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
              @if (saving()) {
                <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              }
              Guardar cambios
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Toast -->
    @if (toastMsg()) {
      <div class="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all"
        [class.bg-green-600]="toastType() === 'success'"
        [class.bg-red-600]="toastType() === 'error'">
        {{ toastMsg() }}
      </div>
    }
  `,
})
export class AdminComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly activeTab = signal<'users' | 'departments'>('users');
  readonly departments = signal<Department[]>([]);
  readonly users = signal<AdminUser[]>([]);
  readonly loadingUsers = signal(true);
  readonly showCreateModal = signal(false);
  readonly showEditModal = signal(false);
  readonly editingUser = signal<AdminUser | null>(null);
  readonly saving = signal(false);
  readonly savingDept = signal(false);
  readonly createError = signal<string | null>(null);
  readonly editError = signal<string | null>(null);
  readonly deptError = signal<string | null>(null);
  readonly toastMsg = signal<string | null>(null);
  readonly toastType = signal<'success' | 'error'>('success');
  readonly suggestedUsername = signal<string | null>(null);
  readonly usernameAvailable = signal(false);
  readonly loadingSuggestion = signal(false);

  readonly rankGroups = RANK_GROUPS;
  searchQuery = '';
  newDeptName = '';
  private suggestionTimer: ReturnType<typeof setTimeout> | null = null;

  form = { firstName: '', secondName: '', lastName: '', office: '', title: '', email: '' };
  editForm = { office: '', title: '' };

  readonly filteredUsers = computed(() => {
    const q = this.searchQuery.toLowerCase();
    if (!q) return this.users();
    return this.users().filter(u =>
      u.displayName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.office ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q),
    );
  });

  currentYear2(): string {
    return new Date().getFullYear().toString().slice(-2);
  }

  canSubmit(): boolean {
    return !!(
      this.form.firstName.trim() &&
      this.form.lastName.trim() &&
      this.form.office &&
      this.form.email &&
      this.isValidEmail(this.form.email) &&
      this.suggestedUsername() &&
      this.usernameAvailable()
    );
  }

  isValidEmail(email: string): boolean {
    return /^[^\s@]+@iugna\.edu\.ar$/i.test(email);
  }

  ngOnInit(): void {
    this.loadDepartments();
    this.loadUsers();
  }

  loadDepartments(): void {
    this.http.get<Department[]>('/api/admin/departments').subscribe({
      next: (depts) => this.departments.set(depts),
    });
  }

  loadUsers(): void {
    this.loadingUsers.set(true);
    this.http.get<AdminUser[]>('/api/admin/users').subscribe({
      next: (users) => { this.users.set(users); this.loadingUsers.set(false); },
      error: () => this.loadingUsers.set(false),
    });
  }

  filterUsers(): void { /* filteredUsers is computed */ }

  openCreateModal(): void {
    this.form = { firstName: '', secondName: '', lastName: '', office: '', title: '', email: '' };
    this.suggestedUsername.set(null);
    this.usernameAvailable.set(false);
    this.createError.set(null);
    this.showCreateModal.set(true);
  }

  closeCreateModal(): void { this.showCreateModal.set(false); }

  openEditModal(user: AdminUser): void {
    this.editingUser.set(user);
    this.editForm = { office: user.office ?? '', title: user.title ?? '' };
    this.editError.set(null);
    this.showEditModal.set(true);
  }

  closeEditModal(): void { this.showEditModal.set(false); this.editingUser.set(null); }

  onNameChange(): void {
    this.suggestedUsername.set(null);
    if (this.suggestionTimer) clearTimeout(this.suggestionTimer);
    const { firstName, secondName, lastName } = this.form;
    if (!firstName.trim() || !lastName.trim()) return;

    this.loadingSuggestion.set(true);
    this.suggestionTimer = setTimeout(() => {
      const params: Record<string, string> = { firstName: firstName.trim(), lastName: lastName.trim() };
      if (secondName.trim()) params['secondName'] = secondName.trim();
      const qs = new URLSearchParams(params).toString();
      this.http.get<UsernameSuggestion>(`/api/admin/username-suggestion?${qs}`).subscribe({
        next: (res) => {
          this.suggestedUsername.set(res.username);
          this.usernameAvailable.set(res.available);
          this.loadingSuggestion.set(false);
          // Auto-fill email suggestion if email is empty
          if (!this.form.email && res.available) {
            this.form.email = `${res.username}@iugna.edu.ar`;
          }
        },
        error: () => this.loadingSuggestion.set(false),
      });
    }, 600);
  }

  submitCreateUser(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.createError.set(null);
    this.http.post<{ username: string }>('/api/admin/users', this.form).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.closeCreateModal();
        this.loadUsers();
        this.showToast(`Usuario "${res.username}" creado exitosamente`, 'success');
      },
      error: (err) => {
        this.saving.set(false);
        this.createError.set(err.error?.message ?? 'Error al crear el usuario');
      },
    });
  }

  submitEditUser(): void {
    const user = this.editingUser();
    if (!user) return;
    this.saving.set(true);
    this.editError.set(null);
    this.http.patch(`/api/admin/users/${user.username}`, this.editForm).subscribe({
      next: () => {
        this.saving.set(false);
        this.closeEditModal();
        this.loadUsers();
        this.showToast('Usuario actualizado', 'success');
      },
      error: (err) => {
        this.saving.set(false);
        this.editError.set(err.error?.message ?? 'Error al actualizar el usuario');
      },
    });
  }

  createDepartment(): void {
    const name = this.newDeptName.trim();
    if (!name) return;
    this.savingDept.set(true);
    this.deptError.set(null);
    this.http.post<Department>('/api/admin/departments', { name }).subscribe({
      next: () => {
        this.newDeptName = '';
        this.savingDept.set(false);
        this.loadDepartments();
        this.showToast('Área creada', 'success');
      },
      error: (err) => {
        this.savingDept.set(false);
        this.deptError.set(err.error?.message ?? 'Error al crear el área');
      },
    });
  }

  deleteDepartment(id: string): void {
    if (!confirm('¿Eliminar esta área?')) return;
    this.http.delete(`/api/admin/departments/${id}`).subscribe({
      next: () => { this.loadDepartments(); this.showToast('Área eliminada', 'success'); },
      error: (err) => this.showToast(err.error?.message ?? 'Error al eliminar', 'error'),
    });
  }

  private showToast(msg: string, type: 'success' | 'error'): void {
    this.toastMsg.set(msg);
    this.toastType.set(type);
    setTimeout(() => this.toastMsg.set(null), 3500);
  }
}
