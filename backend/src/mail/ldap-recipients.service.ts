import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import * as ldap from 'ldapjs';

/** Clave en app_markers de la contraseña de DIREDTOS cambiada desde Admin (cifrada). */
const PASSWORD_MARKER = 'mail.ldapBindPassword';

export interface MailRecipient {
  displayName: string;
  email: string;
  department: string;
  title: string;
}

/**
 * Autocompletado de destinatarios de MTO: busca en la libreta LDAP del correo
 * (LIBRETALDAP.GNA) con la cuenta DIREDTOS, la misma de los MTO.
 */
@Injectable()
export class LdapRecipientsService implements OnModuleInit {
  private readonly logger = new Logger(LdapRecipientsService.name);
  private currentPassword: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.currentPassword = this.configService.get<string>('BRIDGE_LDAP_BIND_PASSWORD') ?? '';
  }

  /**
   * La contraseña cambiada desde Admin → Configuración queda en la base. Hasta el
   * 06/10/2026 solo vivía en memoria: cada reinicio del backend volvía a la vieja
   * del .env y la libreta respondía "Invalid Credentials" (los MTO seguían andando
   * porque el mail-bridge guarda la suya).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureMarkersTable();
      const [row] = await this.dataSource.query(`SELECT "value" FROM "app_markers" WHERE "key" = $1`, [PASSWORD_MARKER]);
      if (!row?.value) return;
      const password = this.decrypt(row.value);
      if (password) this.currentPassword = password;
      else this.logger.warn('No se pudo descifrar la contraseña de DIREDTOS guardada; se usa la del .env');
    } catch (err) {
      this.logger.warn(`No se pudo leer la contraseña de DIREDTOS guardada: ${(err as Error).message}`);
    }
  }

  /** La de Admin → Configuración: se usa ya y queda guardada (cifrada) para los próximos arranques. */
  async updatePassword(password: string): Promise<void> {
    this.currentPassword = password;
    await this.ensureMarkersTable();
    await this.dataSource.query(
      `INSERT INTO "app_markers" ("key", "value") VALUES ($1, $2)
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`,
      [PASSWORD_MARKER, this.encrypt(password)],
    );
  }

  private ensureMarkersTable(): Promise<unknown> {
    return this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "app_markers" (
        "key" varchar PRIMARY KEY,
        "value" text NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
  }

  /** AES-256-GCM con una clave derivada del secreto del JWT (staging, con otro secreto, no la lee). */
  private key(): Buffer {
    const secret = this.configService.get<string>('jwt.secret') ?? '';
    return createHash('sha256').update(`${secret}:mail-ldap-password`).digest();
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  private decrypt(stored: string): string | null {
    try {
      const [version, iv, tag, data] = stored.split(':');
      if (version !== 'v1') return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  search(query: string): Promise<MailRecipient[]> {
    const host = this.configService.get<string>('BRIDGE_LDAP_HOST') ?? '10.201.0.7';
    const port = parseInt(this.configService.get<string>('BRIDGE_LDAP_PORT') ?? '389', 10);
    const bindUser = this.configService.get<string>('BRIDGE_LDAP_BIND_USER') ?? 'DIREDTOS';
    const bindPassword = this.currentPassword;
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
        const filter = `(&(|(objectClass=person)(objectClass=group))(mail=*)(|(cn=*${escaped}*)(mail=*${escaped}*)(displayName=*${escaped}*)(sAMAccountName=*${escaped}*)))`;

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
