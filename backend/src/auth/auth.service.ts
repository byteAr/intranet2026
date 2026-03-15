import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';

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
    };
    const access_token = this.jwtService.sign(payload);

    return { access_token, user };
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
