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
  dn?: string;
}
interface UsernameSuggestion { username: string; available: boolean; }
interface AdGroup { cn: string; dn: string; description: string; memberCount: number; }
interface GroupMember { username: string; displayName: string; dn: string; office: string; title: string; enabled: boolean; }

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
        <button (click)="openGroupsTab()"
          class="px-6 py-3 text-sm font-medium border-b-2 transition-colors"
          [class.border-teal-600]="activeTab() === 'groups'"
          [class.text-teal-600]="activeTab() === 'groups'"
          [class.dark:text-teal-400]="activeTab() === 'groups'"
          [class.border-transparent]="activeTab() !== 'groups'"
          [class.text-gray-500]="activeTab() !== 'groups'">
          Grupos
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
            <input [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event); currentPage.set(1)"
              type="text" placeholder="Buscar por nombre, apellido, usuario u oficina..."
              class="w-72 px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
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
          } @else if (loadError()) {
            <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-5 py-4 text-sm text-red-700 dark:text-red-300 flex items-start gap-3">
              <svg class="h-5 w-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <div>
                <p class="font-medium">Error al conectar con el Active Directory</p>
                <p class="text-xs mt-1 opacity-80">{{ loadError() }}</p>
                <button (click)="loadUsers()" class="mt-2 text-xs underline hover:no-underline">Reintentar</button>
              </div>
            </div>
          } @else {
            <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
              <div class="overflow-x-auto">
              <table class="w-full text-sm whitespace-nowrap">
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
                  @for (user of pagedUsers(); track user.username) {
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

              <!-- Paginación -->
              @if (totalPages() > 1 || filteredUsers().length > 0) {
                <div class="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-zinc-700 text-xs text-gray-500 dark:text-zinc-400">
                  <span>
                    {{ filteredUsers().length }} usuario{{ filteredUsers().length !== 1 ? 's' : '' }}
                    @if (totalPages() > 1) {
                      — Página {{ currentPage() }} de {{ totalPages() }}
                    }
                  </span>
                  @if (totalPages() > 1) {
                    <div class="flex items-center gap-1">
                      <button (click)="currentPage.set(1)" [disabled]="currentPage() === 1"
                        class="px-2 py-1 rounded disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-zinc-700">«</button>
                      <button (click)="prevPage()" [disabled]="currentPage() === 1"
                        class="px-2 py-1 rounded disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-zinc-700">‹</button>
                      <button (click)="nextPage()" [disabled]="currentPage() === totalPages()"
                        class="px-2 py-1 rounded disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-zinc-700">›</button>
                      <button (click)="currentPage.set(totalPages())" [disabled]="currentPage() === totalPages()"
                        class="px-2 py-1 rounded disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-zinc-700">»</button>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ── GRUPOS ── -->
      @if (activeTab() === 'groups') {
        <div class="flex gap-4" style="height: calc(100vh - 220px)">

          <!-- Panel izquierdo: lista de grupos -->
          <div class="w-72 flex-shrink-0 flex flex-col bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-100 dark:border-zinc-700">
              <input [ngModel]="groupSearch()" (ngModelChange)="groupSearch.set($event)"
                type="text" placeholder="Buscar grupo..."
                class="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div class="flex-1 overflow-y-auto">
              @if (loadingGroups()) {
                <div class="flex items-center justify-center h-full text-gray-400 text-sm">Cargando grupos...</div>
              } @else if (filteredGroups().length === 0) {
                <div class="flex items-center justify-center h-full text-gray-400 text-sm">No se encontraron grupos</div>
              } @else {
                @for (group of filteredGroups(); track group.dn) {
                  <div (click)="selectGroup(group)"
                    class="px-4 py-3 cursor-pointer border-b border-gray-50 dark:border-zinc-800 transition-colors"
                    [class.bg-teal-50]="selectedGroup()?.dn === group.dn"
                    [class.dark:bg-teal-900/20]="selectedGroup()?.dn === group.dn"
                    [class.border-l-4]="selectedGroup()?.dn === group.dn"
                    [class.border-l-teal-500]="selectedGroup()?.dn === group.dn"
                    [class.hover:bg-gray-50]="selectedGroup()?.dn !== group.dn"
                    [class.dark:hover:bg-zinc-800]="selectedGroup()?.dn !== group.dn">
                    <div class="flex items-center justify-between">
                      <span class="text-sm font-medium text-gray-900 dark:text-white truncate pr-2">{{ group.cn }}</span>
                      <span class="text-xs bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-zinc-400 px-1.5 py-0.5 rounded-full flex-shrink-0">{{ group.memberCount }}</span>
                    </div>
                    @if (group.description) {
                      <p class="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 truncate">{{ group.description }}</p>
                    }
                  </div>
                }
              }
            </div>
          </div>

          <!-- Panel derecho: miembros / usuarios disponibles -->
          @if (selectedGroup()) {
            <div class="flex-1 flex gap-4 min-w-0">

              <!-- Zona A: Miembros del grupo (drop target para agregar) -->
              <div class="flex-1 flex flex-col bg-white dark:bg-zinc-900 rounded-xl border-2 border-dashed transition-colors overflow-hidden"
                [class.border-teal-400]="dropTarget() === 'members'"
                [class.bg-teal-50]="dropTarget() === 'members'"
                [class.dark:bg-teal-900/10]="dropTarget() === 'members'"
                [class.border-gray-200]="dropTarget() !== 'members'"
                [class.dark:border-zinc-700]="dropTarget() !== 'members'"
                (dragover)="onDragOver($event, 'members')"
                (dragleave)="onDragLeave()"
                (drop)="onDrop($event, 'members')">
                <div class="px-4 py-3 border-b border-gray-100 dark:border-zinc-700 flex items-center justify-between">
                  <div>
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ selectedGroup()!.cn }}</h3>
                    <p class="text-xs text-gray-400">{{ groupMembers().length }} miembro{{ groupMembers().length !== 1 ? 's' : '' }}</p>
                  </div>
                  @if (loadingMembers()) {
                    <svg class="animate-spin h-4 w-4 text-teal-500" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  }
                </div>
                <div class="flex-1 overflow-y-auto p-2 space-y-1">
                  @if (!loadingMembers() && groupMembers().length === 0) {
                    <div class="flex flex-col items-center justify-center h-full text-gray-300 dark:text-zinc-600 text-sm gap-2 py-8">
                      <svg class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/></svg>
                      <span>Sin miembros — arrastrá usuarios aquí</span>
                    </div>
                  }
                  @for (member of groupMembers(); track member.dn) {
                    <div draggable="true"
                      (dragstart)="onDragStart($event, member, 'members')"
                      class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-800 cursor-grab hover:bg-teal-50 dark:hover:bg-teal-900/20 group transition-colors select-none">
                      <div class="h-7 w-7 rounded-full bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center flex-shrink-0">
                        <span class="text-xs font-semibold text-teal-700 dark:text-teal-300">{{ (member.displayName || member.username).charAt(0).toUpperCase() }}</span>
                      </div>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ member.displayName || member.username }}</p>
                        @if (member.office) {
                          <p class="text-xs text-gray-400 truncate">{{ member.office }}</p>
                        }
                      </div>
                      @if (!member.enabled) {
                        <span class="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded">Deshabilitado</span>
                      }
                    </div>
                  }
                </div>
                <div class="px-4 py-2 border-t border-gray-50 dark:border-zinc-800 text-xs text-center text-gray-300 dark:text-zinc-600">
                  Arrastrá usuarios acá para agregarlos · Arrastrá miembros afuera para quitarlos
                </div>
              </div>

              <!-- Zona B: Usuarios disponibles (drop target para quitar) -->
              <div class="flex-1 flex flex-col bg-white dark:bg-zinc-900 rounded-xl border-2 border-dashed transition-colors overflow-hidden"
                [class.border-amber-400]="dropTarget() === 'available'"
                [class.bg-amber-50]="dropTarget() === 'available'"
                [class.dark:bg-amber-900/10]="dropTarget() === 'available'"
                [class.border-gray-200]="dropTarget() !== 'available'"
                [class.dark:border-zinc-700]="dropTarget() !== 'available'"
                (dragover)="onDragOver($event, 'available')"
                (dragleave)="onDragLeave()"
                (drop)="onDrop($event, 'available')">
                <div class="px-4 py-3 border-b border-gray-100 dark:border-zinc-700">
                  <p class="text-sm font-semibold text-gray-900 dark:text-white mb-1">Usuarios disponibles <span class="text-gray-400 font-normal">({{ filteredAvailableUsers().length }})</span></p>
                  <input [ngModel]="availableSearch()" (ngModelChange)="availableSearch.set($event)"
                    type="text" placeholder="Buscar..."
                    class="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div class="flex-1 overflow-y-auto p-2 space-y-1">
                  @for (user of filteredAvailableUsers(); track user.dn) {
                    <div draggable="true"
                      (dragstart)="onDragStart($event, user, 'available')"
                      class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-800 cursor-grab hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors select-none">
                      <div class="h-7 w-7 rounded-full bg-gray-200 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0">
                        <span class="text-xs font-semibold text-gray-500 dark:text-zinc-300">{{ (user.displayName || user.username).charAt(0).toUpperCase() }}</span>
                      </div>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ user.displayName || user.username }}</p>
                        @if (user.office) {
                          <p class="text-xs text-gray-400 truncate">{{ user.office }}</p>
                        }
                      </div>
                    </div>
                  }
                </div>
                <div class="px-4 py-2 border-t border-gray-50 dark:border-zinc-800 text-xs text-center text-gray-300 dark:text-zinc-600">
                  Arrastrá miembros acá para quitarlos del grupo
                </div>
              </div>

            </div>
          } @else {
            <div class="flex-1 flex flex-col items-center justify-center text-gray-300 dark:text-zinc-600 gap-3">
              <svg class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <p class="text-sm">Seleccioná un grupo para gestionar sus miembros</p>
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

  readonly activeTab = signal<'users' | 'groups' | 'departments'>('users');
  readonly departments = signal<Department[]>([]);
  readonly users = signal<AdminUser[]>([]);
  readonly loadingUsers = signal(true);
  readonly loadError = signal<string | null>(null);
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
  readonly searchQuery = signal('');
  readonly currentPage = signal(1);
  readonly pageSize = 20;
  newDeptName = '';
  private suggestionTimer: ReturnType<typeof setTimeout> | null = null;

  form = { firstName: '', secondName: '', lastName: '', office: '', title: '', email: '' };
  editForm = { office: '', title: '' };

  readonly filteredUsers = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.users();
    return this.users().filter(u =>
      (u.displayName ?? '').toLowerCase().includes(q) ||
      (u.firstName  ?? '').toLowerCase().includes(q) ||
      (u.lastName   ?? '').toLowerCase().includes(q) ||
      (u.username   ?? '').toLowerCase().includes(q) ||
      (u.office     ?? '').toLowerCase().includes(q) ||
      (u.email      ?? '').toLowerCase().includes(q),
    );
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredUsers().length / this.pageSize)));

  readonly pagedUsers = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize;
    return this.filteredUsers().slice(start, start + this.pageSize);
  });

  prevPage(): void { this.currentPage.update(p => Math.max(1, p - 1)); }
  nextPage(): void { this.currentPage.update(p => Math.min(this.totalPages(), p + 1)); }

  // ── Groups tab state ──────────────────────────────────────────────────────
  readonly groups = signal<AdGroup[]>([]);
  readonly loadingGroups = signal(false);
  readonly groupSearch = signal('');
  readonly selectedGroup = signal<AdGroup | null>(null);
  readonly groupMembers = signal<GroupMember[]>([]);
  readonly loadingMembers = signal(false);
  readonly availableSearch = signal('');
  readonly dropTarget = signal<'members' | 'available' | null>(null);
  private dragSource: 'members' | 'available' | null = null;
  private draggedUser: GroupMember | null = null;

  readonly filteredGroups = computed(() => {
    const q = this.groupSearch().toLowerCase().trim();
    if (!q) return this.groups();
    return this.groups().filter(g =>
      g.cn.toLowerCase().includes(q) ||
      (g.description ?? '').toLowerCase().includes(q),
    );
  });

  readonly availableUsers = computed(() => {
    const memberDns = new Set(this.groupMembers().map(m => m.dn));
    return this.users()
      .filter(u => u.dn && !memberDns.has(u.dn) && u.enabledInAd)
      .map(u => ({
        username: u.username,
        displayName: u.displayName,
        dn: u.dn!,
        office: u.office ?? '',
        title: u.title ?? '',
        enabled: u.enabledInAd,
      } as GroupMember));
  });

  readonly filteredAvailableUsers = computed(() => {
    const q = this.availableSearch().toLowerCase().trim();
    if (!q) return this.availableUsers();
    return this.availableUsers().filter(u =>
      u.displayName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.office ?? '').toLowerCase().includes(q),
    );
  });

  openGroupsTab(): void {
    this.activeTab.set('groups');
    if (this.groups().length === 0) this.loadGroups();
    if (this.users().length === 0) this.loadUsers();
  }

  loadGroups(): void {
    this.loadingGroups.set(true);
    this.http.get<AdGroup[]>('/api/admin/groups').subscribe({
      next: (gs) => { this.groups.set(gs); this.loadingGroups.set(false); },
      error: () => this.loadingGroups.set(false),
    });
  }

  selectGroup(group: AdGroup): void {
    this.selectedGroup.set(group);
    this.groupMembers.set([]);
    this.loadingMembers.set(true);
    this.http.get<GroupMember[]>(`/api/admin/groups/members?dn=${encodeURIComponent(group.dn)}`).subscribe({
      next: (members) => { this.groupMembers.set(members); this.loadingMembers.set(false); },
      error: () => this.loadingMembers.set(false),
    });
  }

  onDragStart(event: DragEvent, user: GroupMember, source: 'members' | 'available'): void {
    this.draggedUser = user;
    this.dragSource = source;
    event.dataTransfer?.setData('text/plain', user.dn);
  }

  onDragOver(event: DragEvent, target: 'members' | 'available'): void {
    event.preventDefault();
    this.dropTarget.set(target);
  }

  onDragLeave(): void {
    this.dropTarget.set(null);
  }

  onDrop(event: DragEvent, target: 'members' | 'available'): void {
    event.preventDefault();
    this.dropTarget.set(null);
    if (!this.draggedUser || !this.dragSource || this.dragSource === target) {
      this.draggedUser = null;
      this.dragSource = null;
      return;
    }
    const user = this.draggedUser;
    const group = this.selectedGroup();
    this.draggedUser = null;
    this.dragSource = null;
    if (!group) return;

    if (target === 'members') {
      // Add to group
      this.http.post('/api/admin/groups/members', { groupDn: group.dn, userDn: user.dn }).subscribe({
        next: () => {
          this.groupMembers.update(ms => [...ms, user]);
          this.groups.update(gs => gs.map(g => g.dn === group.dn ? { ...g, memberCount: g.memberCount + 1 } : g));
          this.showToast(`${user.displayName || user.username} agregado al grupo`, 'success');
        },
        error: (err) => this.showToast(err.error?.message ?? 'Error al agregar al grupo', 'error'),
      });
    } else {
      // Remove from group
      this.http.post('/api/admin/groups/members/remove', { groupDn: group.dn, userDn: user.dn }).subscribe({
        next: () => {
          this.groupMembers.update(ms => ms.filter(m => m.dn !== user.dn));
          this.groups.update(gs => gs.map(g => g.dn === group.dn ? { ...g, memberCount: Math.max(0, g.memberCount - 1) } : g));
          this.showToast(`${user.displayName || user.username} quitado del grupo`, 'success');
        },
        error: (err) => this.showToast(err.error?.message ?? 'Error al quitar del grupo', 'error'),
      });
    }
  }

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
    this.loadError.set(null);
    this.http.get<AdminUser[]>('/api/admin/users').subscribe({
      next: (users) => { this.users.set(users); this.loadingUsers.set(false); },
      error: (err) => {
        this.loadingUsers.set(false);
        this.loadError.set(err.error?.message ?? err.message ?? 'Error al cargar usuarios del AD');
      },
    });
  }

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
