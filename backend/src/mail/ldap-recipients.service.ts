import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ldap from 'ldapjs';

export interface MailRecipient {
  displayName: string;
  email: string;
  department: string;
  title: string;
}

@Injectable()
export class LdapRecipientsService {
  private readonly logger = new Logger(LdapRecipientsService.name);

  constructor(private readonly configService: ConfigService) {}

  search(query: string): Promise<MailRecipient[]> {
    const host = this.configService.get<string>('BRIDGE_LDAP_HOST') ?? '10.201.0.7';
    const port = parseInt(this.configService.get<string>('BRIDGE_LDAP_PORT') ?? '389', 10);
    const bindUser = this.configService.get<string>('BRIDGE_LDAP_BIND_USER') ?? 'DIREDTOS';
    const bindPassword = this.configService.get<string>('BRIDGE_LDAP_BIND_PASSWORD') ?? '';
    const baseDn = this.configService.get<string>('BRIDGE_LDAP_BASE_DN') ?? 'OU=MTO,DC=gendarmeria,DC=local';

    return new Promise((resolve, reject) => {
      const client = ldap.createClient({
        url: `ldap://${host}:${port}`,
        timeout: 10000,
        connectTimeout: 10000,
      });

      let settled = false;

      function fail(err: Error) {
        if (settled) return;
        settled = true;
        try { client.destroy(); } catch (_) {}
        reject(err);
      }

      client.on('error', (err: Error) => {
        fail(new Error(`LDAP connection error: ${err.message}`));
      });

      client.bind(bindUser, bindPassword, (bindErr) => {
        if (bindErr) {
          return fail(new Error(
            bindErr.message === 'client destroyed'
              ? `LDAP connect failed to ${host}:${port}`
              : `LDAP bind error: ${bindErr.message}`,
          ));
        }

        const escaped = query.replace(/[*()\\\x00]/g, '\\$&');
        const filter = `(&(objectClass=person)(|(cn=*${escaped}*)(mail=*${escaped}*)(displayName=*${escaped}*)(sAMAccountName=*${escaped}*)))`;

        const results: MailRecipient[] = [];

        client.search(baseDn, {
          scope: 'sub',
          filter,
          attributes: ['displayName', 'mail', 'department', 'title', 'cn'],
          sizeLimit: 50,
          timeLimit: 10,
        }, (searchErr, res) => {
          if (searchErr) {
            client.destroy();
            return reject(new Error(`LDAP search error: ${searchErr.message}`));
          }

          res.on('searchEntry', (entry) => {
            const obj: Record<string, string> = {};
            (entry as any).pojo.attributes.forEach((attr: { type: string; values: string[] }) => {
              obj[attr.type] = attr.values?.[0] ?? '';
            });
            const email = obj['mail'] || '';
            if (!email) return;
            results.push({
              displayName: obj['displayName'] || obj['cn'] || email,
              email,
              department: obj['department'] || '',
              title: obj['title'] || '',
            });
          });

          res.on('error', (err: Error & { code?: number }) => {
            // Size Limit Exceeded es un límite suave
            if (err.message?.includes('Size Limit Exceeded') || err.code === 4) {
              settled = true;
              try { client.unbind(); } catch (_) {}
              resolve(results);
            } else {
              fail(new Error(`LDAP search stream error: ${err.message}`));
            }
          });

          res.on('end', () => {
            settled = true;
            try { client.unbind(); } catch (_) {}
            resolve(results);
          });
        });
      });
    });
  }
}
