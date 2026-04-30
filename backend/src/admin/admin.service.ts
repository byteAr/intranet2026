import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { GroupPermission } from './entities/group-permission.entity';
import { User } from '../users/entities/user.entity';
import { CreateAdUserDto } from './dto/create-ad-user.dto';
import { UpdateAdUserDto } from './dto/update-ad-user.dto';
import { GroupMemberActionDto } from './dto/group-member-action.dto';
import { GoogleWorkspaceService } from './google-workspace.service';
import { WelcomeEmailService } from './welcome-email.service';
import * as https from 'https';
import * as http from 'http';

export interface AdGroupEntry {
  cn: string;
  dn: string;
  description: string;
  memberCount: number;
  category?: string;
}

export interface AdGroupMember {
  username: string;
  displayName: string;
  dn: string;
  office: string;
  title: string;
  enabled: boolean;
}

interface AdUserEntry {
  username: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  office: string;
  title: string;
  enabled: boolean;
  dn: string;
  groups?: string[];
}

const OFFICE_GROUPS: readonly string[] = [
  'TICOM', 'CENEDIS', 'LEGAL Y TÉCNICA', 'AYUDANTIADIREDTOS',
  'AYUDANTIARECTORADO', 'DOCENTES', 'CURSOS', 'PERSONAL',
  'SAF', 'LOGISTICA', 'CAMAREROS', 'DESARROLLO',
];

const SPECIAL_GROUPS: readonly string[] = [
  'CIVILES', 'ENCRIPTADO', 'RECTOR', 'DIRECTORES', 'CIVILES_CON_MTO',
];

const MINIMAL_MODULES: readonly string[] = ['chat', 'incidencias', 'reservas'];

@Injectable()
export class AdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly googleWorkspace: GoogleWorkspaceService,
    private readonly welcomeEmail: WelcomeEmailService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AdminAuditLog)
    private readonly auditRepo: Repository<AdminAuditLog>,
    @InjectRepository(GroupPermission)
    private readonly groupPermRepo: Repository<GroupPermission>,
  ) {}

  private async audit(actor: { id: string; username: string }, description: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: actor.id } });
    const displayName = user?.displayName ?? actor.username;
    await this.auditRepo.save(this.auditRepo.create({ actorUsername: actor.username, actorDisplayName: displayName, description }));
  }

  async listAuditLog(limit = 100, offset = 0): Promise<{ logs: AdminAuditLog[]; total: number }> {
    const [logs, total] = await this.auditRepo.findAndCount({ order: { createdAt: 'DESC' }, take: limit, skip: offset });
    return { logs, total };
  }

  async onApplicationBootstrap(): Promise<void> {
    // Seed categories for known groups (upsert: only update category, don't overwrite allowedModules)
    const allSeed = [
      ...OFFICE_GROUPS.map(name => ({ groupName: name, category: 'oficina' })),
      ...SPECIAL_GROUPS.map(name => ({ groupName: name, category: 'especial' })),
    ];
    for (const { groupName, category } of allSeed) {
      const existing = await this.groupPermRepo.findOne({ where: { groupName } });
      if (existing) {
        if (existing.category !== category) {
          existing.category = category;
          await this.groupPermRepo.save(existing);
        }
      } else {
        await this.groupPermRepo.save(this.groupPermRepo.create({ groupName, allowedModules: [], category }));
      }
    }
    this.logger.log('Categorías de grupos inicializadas');
  }

  // ─── AD Bridge helpers ──────────────────────────────────────────────────────

  private get bridgeUrl(): string {
    return this.configService.get<string>('AD_BRIDGE_URL') ?? 'http://ad-bridge:3002';
  }

  private get bridgeSecret(): string {
    return this.configService.get<string>('BRIDGE_SECRET') ?? 'pac-bridge-secret-change-me';
  }

  private get bridgeHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.bridgeSecret}`,
    };
  }

  private async callBridgePost(path: string, body: object): Promise<unknown> {
    const response = await fetch(`${this.bridgeUrl}${path}`, {
      method: 'POST',
      headers: this.bridgeHeaders,
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new BadRequestException((data.error as string) ?? 'Error en AD Bridge');
    }
    return data;
  }

  private async callBridgeGet(path: string): Promise<unknown> {
    const response = await fetch(`${this.bridgeUrl}${path}`, {
      headers: this.bridgeHeaders,
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new BadRequestException((data.error as string) ?? 'Error en AD Bridge');
    }
    return data;
  }

  // ─── Username generation ────────────────────────────────────────────────────

  /** Builds the candidate username: first letter of firstName + lastName (lowercase, no accents/spaces) */
  private buildUsername(firstName: string, secondName: string | undefined, lastName: string, useSecondName = false): string {
    const normalize = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '')
        .toLowerCase();

    const first = normalize(firstName);
    const last  = normalize(lastName);

    if (useSecondName && secondName?.trim()) {
      const second = normalize(secondName);
      return `${first[0]}${second[0]}${last}`;
    }
    return `${first[0]}${last}`;
  }

  async suggestUsername(firstName: string, secondName: string | undefined, lastName: string): Promise<{ username: string; available: boolean }> {
    let candidate = this.buildUsername(firstName, secondName, lastName, false);

    // Check DB first
    const inDb = await this.userRepo.findOne({ where: { username: candidate } });
    if (!inDb) {
      // Check AD
      const adResult = (await this.callBridgeGet(`/check-username?username=${encodeURIComponent(candidate)}`)) as { exists: boolean };
      if (!adResult.exists) {
        return { username: candidate, available: true };
      }
    }

    // Try with second name
    if (secondName?.trim()) {
      candidate = this.buildUsername(firstName, secondName, lastName, true);
      const inDb2 = await this.userRepo.findOne({ where: { username: candidate } });
      if (!inDb2) {
        const adResult2 = (await this.callBridgeGet(`/check-username?username=${encodeURIComponent(candidate)}`)) as { exists: boolean };
        if (!adResult2.exists) {
          return { username: candidate, available: true };
        }
      }
    }

    return { username: candidate, available: false };
  }

  // ─── User management ────────────────────────────────────────────────────────

  async createUser(dto: CreateAdUserDto, actor: { id: string; username: string }): Promise<{ username: string }> {
    // Validate email domain
    if (!dto.email.toLowerCase().endsWith('@iugna.edu.ar')) {
      throw new BadRequestException('El correo institucional debe ser @iugna.edu.ar');
    }

    // Check email uniqueness in DB
    const emailInDb = await this.userRepo.findOne({ where: { email: dto.email } });
    if (emailInDb) {
      throw new ConflictException('Ya existe un usuario con ese correo institucional');
    }

    // Determine username
    const { username, available } = await this.suggestUsername(dto.firstName, dto.secondName, dto.lastName);
    if (!available) {
      throw new ConflictException(
        `El nombre de usuario "${username}" ya está en uso. Provea un segundo nombre para generar una variante.`,
      );
    }

    // Contraseña inicial temporal — el AD exigirá cambiarla al primer login en Windows (pwdLastSet=0)
    const year2 = new Date().getFullYear().toString().slice(-2);
    const defaultPassword = `Iugna.${year2}`;

    // Crear cuenta en Google Workspace primero — obligatorio
    try {
      await this.googleWorkspace.createUser({
        username,
        firstName:     dto.firstName,
        lastName:      dto.lastName,
        password:      defaultPassword,
        recoveryEmail: dto.recoveryEmail,
        recoveryPhone: dto.recoveryPhone,
      });
    } catch (googleError: any) {
      if (googleError?.code === 409 || googleError?.status === 409) {
        throw new ConflictException(
          `El correo institucional "${username}@${this.configService.get('GOOGLE_WORKSPACE_DOMAIN') ?? 'iugna.edu.ar'}" ya existe en Google Workspace y podría pertenecer a otro usuario. Agregue un segundo nombre para generar un usuario distinto.`,
        );
      }
      throw new BadRequestException(
        `No se pudo crear la cuenta de correo institucional: ${(googleError as Error).message ?? 'Error desconocido'}`,
      );
    }

    // Create in AD via bridge
    let createResult: Record<string, unknown>;
    try {
      createResult = (await this.callBridgePost('/create-user', {
        username,
        firstName: dto.firstName,
        lastName:  dto.lastName,
        email:     dto.email,
        office:    dto.office,
        title:     dto.title ?? '',
        password:  defaultPassword,
      })) as Record<string, unknown>;
    } catch (adError) {
      // Si AD falla después de crear en Google, intentar limpiar
      this.logger.warn('AD falló tras crear cuenta Google para %s — limpiando Google Workspace', username);
      await this.googleWorkspace.deleteUser(username);
      throw adError;
    }

    // Agregar al grupo de oficina (no bloqueante si falla)
    if (dto.officeGroupDn) {
      const newUserDn = createResult.dn as string | undefined;
      if (newUserDn) {
        try {
          await this.callBridgePost('/add-to-group', { groupDn: dto.officeGroupDn, userDn: newUserDn });
        } catch (groupErr) {
          this.logger.warn('No se pudo agregar %s al grupo de oficina: %s', username, (groupErr as Error).message);
        }
      }
    }

    // Stub en DB para que el sistema lo reconozca cuando haga login
    const displayName = `${dto.firstName} ${dto.lastName}`;
    const user = this.userRepo.create({
      username,
      email:         dto.email,
      displayName,
      firstName:     dto.firstName,
      lastName:      dto.lastName,
      office:        dto.office,
      title:         dto.title,
      recoveryEmail: dto.recoveryEmail,
      roles:         [],
    });
    await this.userRepo.save(user);

    // Enviar email de bienvenida con credenciales e instrucciones de 2FA
    const domain = this.configService.get<string>('GOOGLE_WORKSPACE_DOMAIN') ?? 'iugna.edu.ar';
    this.welcomeEmail.sendWelcome({
      to:                dto.recoveryEmail,
      displayName:       `${dto.firstName} ${dto.lastName}`,
      username,
      password:          defaultPassword,
      institutionalEmail: `${username}@${domain}`,
      domain,
    }).catch(err => this.logger.warn('No se pudo enviar email de bienvenida a %s: %s', dto.recoveryEmail, err.message));

    this.logger.log('Usuario creado: %s (%s)', username, dto.email);
    await this.audit(actor, `Creó el usuario ${username} (${dto.firstName} ${dto.lastName})`);
    return { username };
  }

  async updateUser(username: string, dto: UpdateAdUserDto, actor: { id: string; username: string }): Promise<void> {
    // Validate email domain if provided
    if (dto.email && !dto.email.toLowerCase().endsWith('@iugna.edu.ar')) {
      throw new BadRequestException('El correo institucional debe ser @iugna.edu.ar');
    }

    // Update in AD via bridge
    await this.callBridgePost('/update-user', { username, ...dto });

    // Update in DB if user exists
    const user = await this.userRepo.findOne({ where: { username } });
    if (user) {
      if (dto.office !== undefined) user.office = dto.office;
      if (dto.title !== undefined)  user.title  = dto.title;
      if (dto.email !== undefined)  user.email  = dto.email;
      await this.userRepo.save(user);
    }
    const changes: string[] = [];
    if (dto.office !== undefined) changes.push(`área: ${dto.office}`);
    if (dto.title  !== undefined) changes.push(`jerarquía: ${dto.title}`);
    if (dto.email  !== undefined) changes.push(`email: ${dto.email}`);
    await this.audit(actor, `Modificó el usuario ${username}${changes.length ? ` (${changes.join(', ')})` : ''}`);
  }

  async listUsers(): Promise<object[]> {
    // Fetch all users from AD
    const bridgeResult = (await this.callBridgeGet('/list-users')) as { users: AdUserEntry[] };
    const adUsers = bridgeResult.users ?? [];

    // Fetch all DB users indexed by username
    const dbUsers = await this.userRepo.find();
    const dbByUsername = new Map(dbUsers.map((u) => [u.username.toLowerCase(), u]));

    // Merge: AD is the source of truth, DB provides login status
    return adUsers.map((adUser) => {
      const dbUser = dbByUsername.get(adUser.username.toLowerCase());
      return {
        username:           adUser.username,
        displayName:        adUser.displayName || `${adUser.firstName} ${adUser.lastName}`.trim(),
        firstName:          adUser.firstName,
        lastName:           adUser.lastName,
        email:              adUser.email,
        office:             adUser.office,
        title:              adUser.title,
        enabledInAd:        adUser.enabled,
        dn:                 adUser.dn,
        adGroups:           adUser.groups ?? [],
        hasLoggedIn:        !!dbUser?.lastLoginAt,
        mustChangePassword: dbUser?.mustChangePassword ?? false,
        lastLoginAt:        dbUser?.lastLoginAt ?? null,
        recoveryEmail:      dbUser?.recoveryEmail ?? null,
        rank:               dbUser?.rank ?? null,
        roles:              dbUser?.roles ?? [],
        id:                 dbUser?.id ?? null,
      };
    });
  }

  // ─── Group management ───────────────────────────────────────────────────────

  async listGroups(): Promise<AdGroupEntry[]> {
    const [rawData, dbPerms] = await Promise.all([
      this.callBridgeGet('/list-groups'),
      this.groupPermRepo.find(),
    ]);
    const groups = (rawData as { groups: AdGroupEntry[] }).groups ?? [];
    const categoryMap = new Map(dbPerms.map(p => [p.groupName.toUpperCase(), p.category]));

    return groups
      .filter(g => {
        const cat = categoryMap.get(g.cn.toUpperCase()) ?? 'oculto';
        return cat !== 'oculto';
      })
      .map(g => ({
        ...g,
        category: categoryMap.get(g.cn.toUpperCase()) ?? 'oculto',
      }));
  }

  async createGroup(name: string, category: string, actor: { id: string; username: string }): Promise<{ cn: string }> {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) throw new BadRequestException('El nombre del grupo no puede estar vacío');
    const validCategory = ['oficina', 'especial'].includes(category) ? category : 'oficina';

    await this.callBridgePost('/create-group', { name: trimmed });

    // Registrar en group_permissions con la categoría indicada
    const existing = await this.groupPermRepo.findOne({ where: { groupName: trimmed } });
    if (!existing) {
      await this.groupPermRepo.save(this.groupPermRepo.create({ groupName: trimmed, allowedModules: [], category: validCategory }));
    } else if (existing.category !== validCategory) {
      existing.category = validCategory;
      await this.groupPermRepo.save(existing);
    }

    await this.audit(actor, `Creó el grupo ${trimmed} (${validCategory})`);
    return { cn: trimmed };
  }

  async getGroupMembers(groupDn: string): Promise<AdGroupMember[]> {
    const data = (await this.callBridgeGet(`/group-members?dn=${encodeURIComponent(groupDn)}`)) as { members: AdGroupMember[] };
    return data.members ?? [];
  }

  async addToGroup(dto: GroupMemberActionDto, actor: { id: string; username: string }): Promise<void> {
    // Single-office enforcement: remove from old office group first if needed
    if (dto.removeFromGroupDn) {
      await this.callBridgePost('/remove-from-group', { groupDn: dto.removeFromGroupDn, userDn: dto.userDn });
    }
    await this.callBridgePost('/add-to-group', { groupDn: dto.groupDn, userDn: dto.userDn });
    const who   = dto.userName  ?? dto.userDn;
    const where = dto.groupName ?? dto.groupDn;
    await this.audit(actor, `Agregó a ${who} al grupo ${where}`);
  }

  async removeFromGroup(dto: GroupMemberActionDto, actor: { id: string; username: string }): Promise<void> {
    await this.callBridgePost('/remove-from-group', { groupDn: dto.groupDn, userDn: dto.userDn });
    const who   = dto.userName  ?? dto.userDn;
    const where = dto.groupName ?? dto.groupDn;
    await this.audit(actor, `Quitó a ${who} del grupo ${where}`);
  }

  async normalizeGroupNames(actor: { id: string; username: string }): Promise<{ renamed: object[]; skipped: object[]; errors: object[] }> {
    const result = (await this.callBridgePost('/normalize-groups', {})) as { renamed: {from:string;to:string}[]; skipped: object[]; errors: object[] };
    if (result.renamed.length) {
      const names = result.renamed.map((r) => `${r.from} → ${r.to}`).join(', ');
      await this.audit(actor, `Normalizó grupos a mayúsculas: ${names}`);
    }
    return result;
  }

  // ─── Module permissions ──────────────────────────────────────────────────────

  static readonly ALL_MODULES = ['chat', 'incidencias', 'reservas', 'correo', 'redactar-mto', 'parte-diario'] as const;

  async getModulePermissions(): Promise<{ groupName: string; allowedModules: string[]; category: string }[]> {
    const dbPerms = await this.groupPermRepo.find();
    return dbPerms
      .filter(p => p.category !== 'oculto')
      .sort((a, b) => {
        // oficina primero, luego especial
        if (a.category === b.category) return a.groupName.localeCompare(b.groupName);
        return a.category === 'oficina' ? -1 : 1;
      })
      .map(p => ({
        groupName: p.groupName,
        allowedModules: p.allowedModules ?? [],
        category: p.category,
      }));
  }

  async setGroupPermissions(groupName: string, allowedModules: string[], actor: { id: string; username: string }): Promise<void> {
    const valid = allowedModules.filter((m) => (AdminService.ALL_MODULES as readonly string[]).includes(m));
    let perm = await this.groupPermRepo.findOne({ where: { groupName } });
    if (perm) {
      perm.allowedModules = valid;
    } else {
      perm = this.groupPermRepo.create({ groupName, allowedModules: valid });
    }
    await this.groupPermRepo.save(perm);
    await this.audit(actor, `Actualizó permisos de ${groupName}: ${valid.join(', ') || 'ningún módulo'}`);
  }

  async getEffectiveModules(userRoles: string[]): Promise<{ allowedModules: string[] }> {
    const ALL = [...AdminService.ALL_MODULES];
    const MINIMAL = [...MINIMAL_MODULES];
    const MTO_RESTRICTED = ['correo', 'redactar-mto'];

    if (!userRoles?.length) return { allowedModules: MINIMAL };

    const upperRoles = userRoles.map(r => r.toUpperCase());

    // TICOM siempre tiene acceso completo
    if (upperRoles.includes('TICOM')) {
      return { allowedModules: ALL };
    }

    // Unión de módulos mínimos + módulos configurados de todos los grupos del usuario
    const perms = await this.groupPermRepo.find();
    const permMap = new Map(perms.map(p => [p.groupName.toUpperCase(), p]));

    const allowed = new Set<string>(MINIMAL);
    for (const role of upperRoles) {
      const perm = permMap.get(role);
      if (perm) {
        (perm.allowedModules ?? []).forEach(m => allowed.add(m));
      }
    }

    // Restricción CIVILES: sin correo ni MTO a menos que esté en CIVILES_CON_MTO
    if (upperRoles.includes('CIVILES') && !upperRoles.includes('CIVILES_CON_MTO')) {
      MTO_RESTRICTED.forEach(m => allowed.delete(m));
    }

    return { allowedModules: ALL.filter(m => allowed.has(m)) };
  }

  // ─── User enable / disable / delete ─────────────────────────────────────────

  async disableUser(username: string, actor: { id: string; username: string }): Promise<{ success: boolean }> {
    await this.callBridgePost('/disable-user', { username });
    await this.audit(actor, `Deshabilitó el usuario ${username}`);
    return { success: true };
  }

  async enableUser(username: string, actor: { id: string; username: string }): Promise<{ success: boolean }> {
    await this.callBridgePost('/enable-user', { username });
    await this.audit(actor, `Habilitó el usuario ${username}`);
    return { success: true };
  }

  async deleteUser(username: string, actor: { id: string; username: string }): Promise<{ success: boolean }> {
    await this.callBridgePost('/delete-user', { username });
    await this.googleWorkspace.deleteUser(username);
    const user = await this.userRepo.findOne({ where: { username } });
    if (user) await this.userRepo.remove(user);
    await this.audit(actor, `Eliminó el usuario ${username}`);
    return { success: true };
  }

  // ─── Group delete ─────────────────────────────────────────────────────────

  async deleteGroup(groupDn: string, groupName: string, actor: { id: string; username: string }): Promise<{ success: boolean }> {
    await this.callBridgePost('/delete-group', { groupDn });
    await this.audit(actor, `Eliminó el grupo ${groupName}`);
    return { success: true };
  }

  // ─── Cleanup inactivos (cron diario a las 02:00) ─────────────────────────

  @Cron('0 2 * * *')
  async runCleanup(): Promise<void> {
    this.logger.log('Ejecutando limpieza de usuarios inactivos...');
    try {
      const result = (await this.callBridgePost('/cleanup-inactive', {})) as {
        disabled: string[];
        deleted: string[];
        errors: string[];
      };
      const { disabled = [], deleted = [], errors = [] } = result;
      if (disabled.length || deleted.length) {
        const description =
          `Limpieza automática: ${disabled.length} deshabilitado(s) (${disabled.join(', ') || '-'})` +
          `, ${deleted.length} eliminado(s) (${deleted.join(', ') || '-'})`;
        await this.auditRepo.save(
          this.auditRepo.create({
            actorUsername: 'sistema',
            actorDisplayName: 'Sistema (cron)',
            description,
          }),
        );
      }
      if (errors.length) {
        this.logger.warn('Errores en limpieza de inactivos: %s', errors.join(', '));
      }
      this.logger.log('Limpieza completada: %d deshabilitados, %d eliminados', disabled.length, deleted.length);
    } catch (err) {
      this.logger.error('Error en cron cleanup-inactive: %s', (err as Error).message);
    }
  }

  private bridgeRequest(
    baseUrl: string,
    secret: string,
    path: string,
    payload: unknown,
  ): Promise<{ ok: boolean; status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const url = new URL(baseUrl + path);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? '443' : '80'),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Authorization: `Bearer ${secret}`,
          },
          timeout: 15000,
          rejectUnauthorized: false,
        } as https.RequestOptions,
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () =>
            resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, body: data }),
          );
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Bridge request timeout')); });
      req.write(body);
      req.end();
    });
  }

  async updateMailPassword(password: string, actor: { id: string; username: string }): Promise<void> {
    const bridgeUrl = this.configService.get<string>('MAIL_BRIDGE_URL');
    const bridgeSecret = this.configService.get<string>('MAIL_BRIDGE_SECRET');
    if (!bridgeUrl || !bridgeSecret) {
      throw new BadRequestException('Bridge de correo no configurado en este entorno');
    }
    const res = await this.bridgeRequest(bridgeUrl, bridgeSecret, '/update-credentials', { password });
    if (!res.ok) {
      throw new BadRequestException(`Error del bridge: ${res.status} ${res.body}`);
    }
    await this.audit(actor, 'Actualizó la contraseña de la cuenta de correo DIREDTOS');
  }
}
