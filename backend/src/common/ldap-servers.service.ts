import { Global, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'net';

/** Cada cuánto se revisa qué controladores de dominio responden. */
const CHECK_MS = 30_000;
/** Cuánto se espera a que un controlador conteste (la revisión y cada conexión LDAP). */
export const LDAP_CONNECT_TIMEOUT_MS = 4_000;

interface LdapServer {
  url: string;
  host: string;
  port: number;
  up: boolean;
}

/**
 * Controladores de dominio con respaldo (13/10/2026: 10.98.40.1 y 10.98.40.10).
 * LDAP_URL admite varios separados por coma o espacio, en orden de preferencia:
 *   LDAP_URL=ldap://10.98.40.1:389,ldap://10.98.40.10:389
 * Cada 30 s se prueba si cada uno acepta conexiones; urls() devuelve primero
 * los que responden (en el orden de la lista) y al final los demás, como
 * último intento. ldapjs prueba la lista en ese orden: si el primario no
 * responde va al secundario y viceversa, y cuando el primario vuelve se usa
 * de nuevo. Los cambios quedan en el log.
 */
@Injectable()
export class LdapServersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ControladoresDeDominio');
  private readonly servers: LdapServer[];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('ldap.url') ?? 'ldap://localhost:389';
    this.servers = raw
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((url) => {
        let host = url;
        let port = 389;
        try {
          const u = new URL(url);
          host = u.hostname;
          port = Number(u.port) || (u.protocol === 'ldaps:' ? 636 : 389);
        } catch {
          /* se usa tal cual */
        }
        return { url, host, port, up: true };
      });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.servers.length < 2) return; // con uno solo no hay a quién pasar
    this.logger.log(`Controladores de dominio: ${this.servers.map((s) => s.host).join(', ')} (en ese orden)`);
    await this.check();
    this.timer = setInterval(() => void this.check(), CHECK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Las URL para ldapjs: primero las que responden, en el orden configurado. */
  urls(): string[] {
    const up = this.servers.filter((s) => s.up).map((s) => s.url);
    const down = this.servers.filter((s) => !s.up).map((s) => s.url);
    return [...up, ...down];
  }

  /** El estado de cada uno (para diagnóstico). */
  status(): { host: string; up: boolean }[] {
    return this.servers.map(({ host, up }) => ({ host, up }));
  }

  private async check(): Promise<void> {
    await Promise.all(
      this.servers.map(async (s) => {
        const up = await reachable(s.host, s.port);
        if (up !== s.up) {
          if (up) this.logger.log(`El controlador de dominio ${s.host} volvió a responder`);
          else this.logger.warn(`El controlador de dominio ${s.host} no responde: se usa ${this.firstOtherUp(s) ?? 'el próximo de la lista'}`);
        }
        s.up = up;
      }),
    );
  }

  private firstOtherUp(down: LdapServer): string | null {
    return this.servers.find((s) => s !== down && s.up)?.host ?? null;
  }
}

/** Si el servidor acepta una conexión TCP en ese puerto. */
function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(LDAP_CONNECT_TIMEOUT_MS);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** Global: lo usan el inicio de sesión, el cambio de contraseña y la búsqueda de usuarios. */
@Global()
@Module({
  providers: [LdapServersService],
  exports: [LdapServersService],
})
export class LdapServersModule {}
