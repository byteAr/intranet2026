import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from './entities/department.entity';
import { User } from '../users/entities/user.entity';
import { CreateAdUserDto } from './dto/create-ad-user.dto';
import { UpdateAdUserDto } from './dto/update-ad-user.dto';

const DEFAULT_DEPARTMENTS = [
  'TICOM',
  'CENEDIS',
  'LEGAL Y TÉCNICA',
  'AYUDANTIADIREDTOS',
  'AYUDANTIARECTORADO',
  'DOCENTES',
  'CURSOS',
  'PERSONAL',
  'SAF',
  'LOGISTICA',
  'CAMAREROS',
  'DESARROLLO',
];

@Injectable()
export class AdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Seed default departments if table is empty
    const count = await this.departmentRepo.count();
    if (count === 0) {
      const depts = DEFAULT_DEPARTMENTS.map((name) => this.departmentRepo.create({ name }));
      await this.departmentRepo.save(depts);
      this.logger.log('Áreas por defecto creadas');
    }
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

  async createUser(dto: CreateAdUserDto): Promise<{ username: string }> {
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

    // Default password: Iugna.{YY}
    const year2 = new Date().getFullYear().toString().slice(-2);
    const defaultPassword = `Iugna.${year2}`;

    // Create in AD via bridge
    await this.callBridgePost('/create-user', {
      username,
      firstName: dto.firstName,
      lastName:  dto.lastName,
      email:     dto.email,
      office:    dto.office,
      title:     dto.title ?? '',
      password:  defaultPassword,
    });

    // Create stub record in DB with mustChangePassword = true
    const displayName = `${dto.firstName} ${dto.lastName}`;
    const user = this.userRepo.create({
      username,
      email: dto.email,
      displayName,
      firstName: dto.firstName,
      lastName:  dto.lastName,
      office:    dto.office,
      title:     dto.title,
      roles:     [],
      mustChangePassword: true,
    });
    await this.userRepo.save(user);

    this.logger.log('Usuario creado: %s (%s)', username, dto.email);
    return { username };
  }

  async updateUser(username: string, dto: UpdateAdUserDto): Promise<void> {
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
  }

  async listUsers(): Promise<User[]> {
    return this.userRepo.find({
      order: { firstName: 'ASC', lastName: 'ASC' },
    });
  }

  // ─── Department management ──────────────────────────────────────────────────

  async getDepartments(): Promise<Department[]> {
    return this.departmentRepo.find({ order: { name: 'ASC' } });
  }

  async createDepartment(name: string): Promise<Department> {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) throw new BadRequestException('El nombre del área no puede estar vacío');
    const existing = await this.departmentRepo.findOne({ where: { name: trimmed } });
    if (existing) throw new ConflictException('Ya existe un área con ese nombre');
    const dept = this.departmentRepo.create({ name: trimmed });
    return this.departmentRepo.save(dept);
  }

  async deleteDepartment(id: string): Promise<void> {
    const dept = await this.departmentRepo.findOne({ where: { id } });
    if (!dept) throw new NotFoundException('Área no encontrada');
    await this.departmentRepo.remove(dept);
  }
}
