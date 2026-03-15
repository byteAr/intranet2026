import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ldap = require('ldapjs');

export interface LdapUserEntry {
  username: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

@Injectable()
export class LdapSearchService {
  private readonly url: string;
  private readonly bindDn: string;
  private readonly bindCredentials: string;
  private readonly searchBase: string;
  private readonly tlsRejectUnauthorized: boolean;

  constructor(configService: ConfigService) {
    this.url = configService.get<string>('ldap.url')!;
    this.bindDn = configService.get<string>('ldap.bindDn')!;
    this.bindCredentials = configService.get<string>('ldap.bindCredentials')!;
    this.searchBase = configService.get<string>('ldap.searchBase')!;
    this.tlsRejectUnauthorized =
      configService.get<boolean>('ldap.tlsRejectUnauthorized') ?? true;
  }

  async search(query: string): Promise<LdapUserEntry[]> {
    // Escape special LDAP filter characters
    const escaped = query.replace(/[*()\\]/g, '\\$&');
    const filter = `(|(cn=*${escaped}*)(givenName=*${escaped}*)(sn=*${escaped}*)(sAMAccountName=*${escaped}*)(displayName=*${escaped}*)(uid=*${escaped}*))`;

    return new Promise((resolve) => {
      const client = ldap.createClient({
        url: this.url,
        tlsOptions: { rejectUnauthorized: this.tlsRejectUnauthorized },
        timeout: 5000,
        connectTimeout: 5000,
      });

      client.on('error', () => resolve([]));

      client.bind(this.bindDn, this.bindCredentials, (bindErr: Error | null) => {
        if (bindErr) {
          client.destroy();
          return resolve([]);
        }

        const results: LdapUserEntry[] = [];

        client.search(
          this.searchBase,
          {
            scope: 'sub',
            filter,
            attributes: ['sAMAccountName', 'uid', 'displayName', 'givenName', 'sn', 'mail'],
            sizeLimit: 20,
          },
          (searchErr: Error | null, res: any) => {
            if (searchErr) {
              client.unbind();
              return resolve([]);
            }

            res.on('searchEntry', (entry: any) => {
              const attrs: Array<{ type: string; values: string[] }> =
                entry.pojo?.attributes ?? [];
              const obj: Record<string, string> = {};
              attrs.forEach((a) => { obj[a.type] = a.values?.[0] ?? ''; });

              const username = obj['sAMAccountName'] || obj['uid'] || '';
              if (!username) return;

              const firstName = obj['givenName'] || undefined;
              const lastName = obj['sn'] || undefined;
              const displayName =
                obj['displayName'] ||
                [firstName, lastName].filter(Boolean).join(' ') ||
                username;

              results.push({ username, displayName, firstName, lastName, email: obj['mail'] || undefined });
            });

            res.on('error', () => { client.unbind(); resolve(results); });
            res.on('end', () => { client.unbind(); resolve(results); });
          },
        );
      });
    });
  }
}
