import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { GroupPermission } from '../admin/entities/group-permission.entity';
import { TokenBlacklistService } from './token-blacklist.service';

/** Shape of the LDAP/AD entry returned by passport-ldapauth */
interface LdapEntry {
  dn?: string;
  uid?: string;
  sAMAccountName?: string;
  userPrincipalName?: string;
  mail?: string;
  displayName?: string;
  givenName?: string;
  sn?: string;
  memberOf?: string | string[];
  title?: string;
  department?: string;
  company?: string;
  telephoneNumber?: string;
  mobile?: string;
  physicalDeliveryOfficeName?: string;
  manager?: string;
  employeeID?: string;
  employeeNumber?: string;
  [key: string]: unknown;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly tokenBlacklist: TokenBlacklistService,
    @InjectRepository(GroupPermission)
    private readonly groupPermRepo: Repository<GroupPermission>,
  ) {}

  async login(ldapEntry: LdapEntry): Promise<{ access_token: string; user: User }> {
    const username =
      (ldapEntry.sAMAccountName as string | undefined) ??
      (ldapEntry.uid as string | undefined) ??
      '';

    const email = (ldapEntry.mail as string | undefined) ?? `${username}@unknown.local`;
    const displayName = (ldapEntry.displayName as string | undefined) ?? username;
    const firstName = ldapEntry.givenName as string | undefined;
    const lastName = ldapEntry.sn as string | undefined;
    const adDn = ldapEntry.dn;
    const roles = this.extractRoles(ldapEntry.memberOf);
    const officeGroup = await this.findOfficeGroup(roles);

    const user = await this.usersService.upsert({
      username,
      email,
      displayName,
      firstName,
      lastName,
      roles,
      adDn,
      upn: ldapEntry.userPrincipalName,
      title: ldapEntry.title,
      department: ldapEntry.department,
      company: ldapEntry.company,
      phone: ldapEntry.telephoneNumber,
      mobile: ldapEntry.mobile,
      office: ldapEntry.physicalDeliveryOfficeName,
      officeGroup,
      manager: this.extractCn(ldapEntry.manager),
      employeeId: ldapEntry.employeeID ?? ldapEntry.employeeNumber,
    });

    const fullName =
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.displayName ||
      user.username;

    const payload = {
      sub: user.id,
      username: user.username,
      displayName: fullName,
      roles: user.roles,
      jti: randomUUID(),
    };
    const access_token = this.jwtService.sign(payload);

    return { access_token, user };
  }

  async logout(token: string): Promise<void> {
    try {
      const decoded = this.jwtService.decode(token) as { jti?: string; exp?: number } | null;
      if (decoded?.jti && decoded?.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await this.tokenBlacklist.blacklist(decoded.jti, ttl);
        }
      }
    } catch {
      // ignore decode errors on logout
    }
  }

  /** Returns the CN of the first AD group (from roles) that has category='oficina' in the DB */
  private async findOfficeGroup(roles: string[]): Promise<string | undefined> {
    if (roles.length === 0) return undefined;
    const perm = await this.groupPermRepo.findOne({
      where: { groupName: In(roles), category: 'oficina' },
    });
    return perm?.groupName ?? undefined;
  }

  /** Extract CN from a DN string (e.g. manager field) */
  private extractCn(dn?: string): string | undefined {
    if (!dn) return undefined;
    const match = /^CN=([^,]+)/i.exec(dn);
    return match ? match[1] : dn;
  }

  /** Extract role names from CN=GroupName,... strings */
  private extractRoles(memberOf?: string | string[]): string[] {
    if (!memberOf) return [];
    const groups = Array.isArray(memberOf) ? memberOf : [memberOf];
    return groups
      .map((dn) => {
        const match = /^CN=([^,]+)/i.exec(dn);
        return match ? match[1] : null;
      })
      .filter((r): r is string => r !== null);
  }
}
