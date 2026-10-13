import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-ldapauth';
import { LDAP_CONNECT_TIMEOUT_MS, LdapServersService } from '../../common/ldap-servers.service';

@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, 'ldapauth') {
  constructor(configService: ConfigService, ldapServers: LdapServersService) {
    const bindDn = configService.get<string>('ldap.bindDn')!;
    const bindCredentials = configService.get<string>('ldap.bindCredentials')!;
    const searchBase = configService.get<string>('ldap.searchBase')!;
    const searchFilter = configService.get<string>('ldap.searchFilter')!;
    const tlsRejectUnauthorized = configService.get<boolean>(
      'ldap.tlsRejectUnauthorized',
    )!;

    // Opciones por cada intento de inicio de sesión: la lista de controladores de
    // dominio con el que está respondiendo primero (si uno se cae, el otro).
    const options: Strategy.OptionsFunction = (_req, callback) =>
      callback(null, {
        server: {
          url: ldapServers.urls(),
          connectTimeout: LDAP_CONNECT_TIMEOUT_MS,
          bindDN: bindDn,
          bindCredentials,
          searchBase,
          searchFilter,
          searchAttributes: [
            'uid', 'sAMAccountName', 'userPrincipalName',
            'mail', 'displayName', 'givenName', 'sn', 'memberOf',
            'title', 'department', 'company',
            'telephoneNumber', 'mobile',
            'physicalDeliveryOfficeName',
            'manager', 'employeeID', 'employeeNumber',
          ],
          tlsOptions: {
            rejectUnauthorized: tlsRejectUnauthorized,
          },
        },
        usernameField: 'username',
        passwordField: 'password',
      });
    super(options);
  }

  // passport-ldapauth calls validate() with the LDAP user entry on success
  validate(ldapUser: Record<string, unknown>): Record<string, unknown> {
    return ldapUser;
  }
}
