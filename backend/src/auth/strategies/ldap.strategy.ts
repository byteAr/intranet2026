import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-ldapauth';

@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, 'ldapauth') {
  constructor(configService: ConfigService) {
    const ldapUrl = configService.get<string>('ldap.url')!;
    const bindDn = configService.get<string>('ldap.bindDn')!;
    const bindCredentials = configService.get<string>('ldap.bindCredentials')!;
    const searchBase = configService.get<string>('ldap.searchBase')!;
    const searchFilter = configService.get<string>('ldap.searchFilter')!;
    const tlsRejectUnauthorized = configService.get<boolean>(
      'ldap.tlsRejectUnauthorized',
    )!;

    super({
      server: {
        url: ldapUrl,
        bindDN: bindDn,
        bindCredentials,
        searchBase,
        searchFilter,
        searchAttributes: ['uid', 'sAMAccountName', 'mail', 'displayName', 'givenName', 'sn', 'memberOf'],
        tlsOptions: {
          rejectUnauthorized: tlsRejectUnauthorized,
        },
      },
      usernameField: 'username',
      passwordField: 'password',
    });
  }

  // passport-ldapauth calls validate() with the LDAP user entry on success
  validate(ldapUser: Record<string, unknown>): Record<string, unknown> {
    return ldapUser;
  }
}
