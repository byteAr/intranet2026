import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

export interface UpsertUserDto {
  username: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  adDn?: string;
  upn?: string;
  title?: string;
  department?: string;
  company?: string;
  phone?: string;
  mobile?: string;
  office?: string;
  manager?: string;
  employeeId?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  private get bridgeUrl(): string {
    return this.configService.get<string>('AD_BRIDGE_URL') ?? 'http://ad-bridge:3002';
  }

  private get bridgeSecret(): string {
    return this.configService.get<string>('BRIDGE_SECRET') ?? 'pac-bridge-secret-change-me';
  }

  private async addToCivilesGroup(userDn: string): Promise<void> {
    try {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.bridgeSecret}` };
      const listResp = await fetch(`${this.bridgeUrl}/list-groups`, { headers });
      if (!listResp.ok) { this.logger.warn('addToCivilesGroup: no se pudo listar grupos del AD'); return; }
      const data = (await listResp.json()) as { groups: { cn: string; dn: string }[] };
      const civilesGroup = data.groups?.find((g) => g.cn === 'CIVILES');
      if (!civilesGroup) { this.logger.warn('addToCivilesGroup: grupo CIVILES no existe en AD'); return; }
      await fetch(`${this.bridgeUrl}/add-to-group`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ groupDn: civilesGroup.dn, userDn }),
      });
      this.logger.log(`Usuario ${userDn} agregado al grupo CIVILES`);
    } catch (e) {
      this.logger.warn(`addToCivilesGroup error: ${(e as Error).message}`);
    }
  }

  async upsert(dto: UpsertUserDto): Promise<User> {
    let user = await this.userRepo.findOne({
      where: { username: dto.username },
    });

    if (user) {
      user.email = dto.email;
      user.displayName = dto.displayName;
      user.firstName = dto.firstName ?? user.firstName;
      user.lastName = dto.lastName ?? user.lastName;
      user.roles = dto.roles ?? user.roles;
      user.adDn = dto.adDn ?? user.adDn;
      user.upn = dto.upn ?? user.upn;
      user.title = dto.title ?? user.title;
      user.department = dto.department ?? user.department;
      user.company = dto.company ?? user.company;
      user.phone = dto.phone ?? user.phone;
      user.mobile = dto.mobile ?? user.mobile;
      user.office = dto.office ?? user.office;
      user.manager = dto.manager ?? user.manager;
      user.employeeId = dto.employeeId ?? user.employeeId;
      user.lastLoginAt = new Date();
    } else {
      user = this.userRepo.create({
        ...dto,
        roles: dto.roles ?? [],
        lastLoginAt: new Date(),
      });
    }

    return this.userRepo.save(user);
  }

  findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  findAllActiveIds(excludeId?: string): Promise<{ id: string }[]> {
    return this.userRepo
      .createQueryBuilder('u')
      .select('u.id', 'id')
      .where('u.isActive = true')
      .andWhere(excludeId ? 'u.id != :excludeId' : '1=1', { excludeId })
      .getRawMany<{ id: string }>();
  }

  findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username } });
  }

  async createStub(data: {
    username: string;
    displayName: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  }): Promise<User> {
    const user = this.userRepo.create({
      username: data.username,
      email: data.email ?? `${data.username}@ldap.local`,
      displayName: data.displayName,
      firstName: data.firstName,
      lastName: data.lastName,
      roles: [],
    });
    return this.userRepo.save(user);
  }

  async search(query: string, excludeId: string): Promise<User[]> {
    const q = `%${query}%`;
    return this.userRepo
      .createQueryBuilder('u')
      .where('u.id != :excludeId', { excludeId })
      .andWhere(
        '(u.firstName ILIKE :q OR u.lastName ILIKE :q OR u.displayName ILIKE :q OR u.username ILIKE :q)',
        { q },
      )
      .orderBy('u.firstName', 'ASC')
      .take(10)
      .getMany();
  }

  async findByRoleContaining(role: string): Promise<User[]> {
    // roles is stored as simple-array (CSV text). Match exact role value only:
    // handles: solo, primero, último, o en medio de la lista
    return this.userRepo
      .createQueryBuilder('u')
      .where(
        'u.roles = :exact OR u.roles LIKE :start OR u.roles LIKE :end OR u.roles LIKE :middle',
        {
          exact: role,
          start: `${role},%`,
          end: `%,${role}`,
          middle: `%,${role},%`,
        },
      )
      .getMany();
  }

  async updateProfile(id: string, data: { recoveryEmail?: string; avatar?: string; rank?: string }): Promise<User> {
    await this.userRepo.update(id, data);
    const user = (await this.userRepo.findOne({ where: { id } })) as User;
    if (data.rank === 'CIVIL' && user.adDn) {
      void this.addToCivilesGroup(user.adDn);
    }
    return user;
  }

}
