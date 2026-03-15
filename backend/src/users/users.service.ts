import { Injectable } from '@nestjs/common';
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
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

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

  async updateProfile(id: string, data: { recoveryEmail?: string; avatar?: string }): Promise<User> {
    await this.userRepo.update(id, data);
    return this.userRepo.findOne({ where: { id } }) as Promise<User>;
  }
}
