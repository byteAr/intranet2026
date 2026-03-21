import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as ldap from 'ldapjs';
import { UsersService } from '../users/users.service';

interface OtpEntry {
  otp: string;
  expiry: number;
  attempts: number;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly otpStore = new Map<string, OtpEntry>();

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async sendOtp(username: string): Promise<{ email: string }> {
    // Prioridad: correo de recuperación en DB → correo corporativo en AD
    const dbUser = await this.usersService.findByUsername(username);
    const targetEmail = dbUser?.recoveryEmail ?? await this.lookupEmail(username);

    if (!targetEmail) throw new BadRequestException('Usuario no encontrado en el directorio');

    const otp = String(Math.floor(1000 + Math.random() * 9000));
    this.otpStore.set(username.toLowerCase(), {
      otp,
      expiry: Date.now() + 10 * 60 * 1000,
      attempts: 0,
    });

    await this.sendEmail(targetEmail, otp);
    this.logger.log(`OTP enviado a ${targetEmail} para usuario ${username}`);
    return { email: targetEmail };
  }

  async verifyOtp(username: string, otp: string): Promise<void> {
    const key = username.toLowerCase();
    const entry = this.otpStore.get(key);

    if (!entry) throw new BadRequestException('No hay una solicitud de recuperación activa para este usuario');
    if (Date.now() > entry.expiry) {
      this.otpStore.delete(key);
      throw new BadRequestException('El código OTP ha expirado. Solicita uno nuevo');
    }

    entry.attempts++;
    if (entry.attempts > 3) {
      this.otpStore.delete(key);
      throw new BadRequestException('Demasiados intentos incorrectos. Solicita un nuevo código');
    }

    if (entry.otp !== otp) {
      const remaining = 3 - entry.attempts + 1;
      throw new BadRequestException(`Código incorrecto. Te quedan ${remaining} intento(s)`);
    }
  }

  async resetPassword(username: string, otp: string, newPassword: string): Promise<void> {
    const key = username.toLowerCase();
    const entry = this.otpStore.get(key);

    if (!entry) throw new BadRequestException('No hay una solicitud de recuperación activa para este usuario');
    if (Date.now() > entry.expiry) {
      this.otpStore.delete(key);
      throw new BadRequestException('El código OTP ha expirado. Solicita uno nuevo');
    }

    entry.attempts++;
    if (entry.attempts > 3) {
      this.otpStore.delete(key);
      throw new BadRequestException('Demasiados intentos incorrectos. Solicita un nuevo código');
    }

    if (entry.otp !== otp) {
      throw new BadRequestException(`Código incorrecto. Te quedan ${3 - entry.attempts + 1} intento(s)`);
    }

    // OTP válido — resetear en AD
    await this.callBridge(username, newPassword);
    this.otpStore.delete(key);
    this.logger.log(`Contraseña reseteada exitosamente para ${username}`);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user?.adDn) throw new BadRequestException('No se encontró la cuenta del usuario');

    // Verify current password via LDAP bind
    const valid = await this.verifyLdapPassword(user.adDn, currentPassword);
    if (!valid) throw new BadRequestException('La contraseña actual es incorrecta');

    await this.callBridge(user.username, newPassword);
    this.logger.log(`Contraseña cambiada por el usuario: ${user.username}`);
  }

  private verifyLdapPassword(dn: string, password: string): Promise<boolean> {
    return new Promise((resolve) => {
      const url = this.configService.get<string>('ldap.url')!;
      const client = ldap.createClient({ url, tlsOptions: { rejectUnauthorized: false } });
      client.on('error', () => resolve(false));
      client.bind(dn, password, (err) => {
        client.destroy();
        resolve(!err);
      });
    });
  }

  private async callBridge(username: string, newPassword: string): Promise<void> {
    const bridgeUrl = this.configService.get<string>('AD_BRIDGE_URL') ?? 'http://ad-bridge:3002';
    const bridgeSecret = this.configService.get<string>('BRIDGE_SECRET') ?? 'pac-bridge-secret-change-me';

    const response = await fetch(`${bridgeUrl}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeSecret}` },
      body: JSON.stringify({ username, newPassword }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new BadRequestException(data.error ?? 'Error al actualizar la contraseña en AD');
    }
  }

  private async resetAdPassword(username: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findByUsername(username);
    if (!user?.adDn) {
      throw new BadRequestException('No se encontró la cuenta de dominio del usuario');
    }

    const ldapUrl = this.configService.get<string>('ldap.url') ?? 'ldap://10.98.40.22:389';
    const bindDn = this.configService.get<string>('ldap.bindDn')!;
    const bindCredentials = this.configService.get<string>('ldap.bindCredentials')!;
    const tlsOptions = { rejectUnauthorized: false };

    return new Promise((resolve, reject) => {
      const client = ldap.createClient({ url: ldapUrl, tlsOptions });

      client.on('error', (err: Error) => {
        reject(new BadRequestException(`Error de conexión con el directorio: ${err.message}`));
      });

      // StartTLS en puerto 389 para poder modificar unicodePwd de forma segura
      client.starttls(tlsOptions, [], (tlsErr) => {
        if (tlsErr) {
          client.destroy();
          this.logger.error(`Error StartTLS para ${username}: ${tlsErr.message}`);
          return reject(new BadRequestException(`Error al establecer canal seguro: ${tlsErr.message}`));
        }

        client.bind(bindDn, bindCredentials, (bindErr) => {
          if (bindErr) {
            client.destroy();
            return reject(new BadRequestException('Error de autenticación con el directorio'));
          }

          const encodedPassword = Buffer.from(`"${newPassword}"`, 'utf16le');
          const change = new ldap.Change({
            operation: 'replace',
            modification: new ldap.Attribute({ type: 'unicodePwd', vals: [encodedPassword] }),
          });

          client.modify(user.adDn!, change, (modErr) => {
            if (modErr) {
              client.destroy();
              this.logger.error(`Error al resetear contraseña de ${username}: ${modErr.message}`);
              return reject(new BadRequestException(
                'No se pudo actualizar la contraseña. Verificá que cumpla los requisitos del dominio',
              ));
            }

            // Marcar pwdLastSet = -1 para no forzar cambio al próximo login
            const pwdLastSetChange = new ldap.Change({
              operation: 'replace',
              modification: new ldap.Attribute({ type: 'pwdLastSet', vals: ['-1'] }),
            });
            client.modify(user.adDn!, pwdLastSetChange, () => {
              client.destroy();
              resolve();
            });
          });
        });
      });
    });
  }

  private lookupEmail(username: string): Promise<string | null> {
    return new Promise((resolve) => {
      const url = this.configService.get<string>('ldap.url')!;
      const bindDn = this.configService.get<string>('ldap.bindDn')!;
      const bindCredentials = this.configService.get<string>('ldap.bindCredentials')!;
      const searchBase = this.configService.get<string>('ldap.searchBase')!;

      const client = ldap.createClient({ url, tlsOptions: { rejectUnauthorized: false } });
      client.on('error', () => resolve(null));

      client.bind(bindDn, bindCredentials, (err) => {
        if (err) { client.destroy(); resolve(null); return; }

        client.search(searchBase, {
          filter: `(sAMAccountName=${username})`,
          scope: 'sub',
          attributes: ['mail'],
        }, (err, res) => {
          if (err) { client.destroy(); resolve(null); return; }

          let email: string | null = null;
          res.on('searchEntry', (e: any) => {
            const attrs: Array<{ type: string; values: string[] }> = e.pojo?.attributes ?? [];
            const mailAttr = attrs.find((a) => a.type === 'mail');
            if (mailAttr?.values?.[0]) email = mailAttr.values[0];
          });
          res.on('end', () => { client.destroy(); resolve(email); });
          res.on('error', () => { client.destroy(); resolve(null); });
        });
      });
    });
  }

  private async sendEmail(to: string, otp: string): Promise<void> {
    const smtpUser = this.configService.get<string>('SMTP_USER');

    const transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST') ?? 'localhost',
      port: Number(this.configService.get<string>('SMTP_PORT') ?? '25'),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: smtpUser
        ? {
            user: smtpUser,
            pass: this.configService.get<string>('SMTP_PASS') ?? '',
          }
        : undefined,
      tls: { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from: this.configService.get<string>('SMTP_FROM') ?? 'noreply@iugnad.lan',
      to,
      subject: 'Recuperación de contraseña - Intranet Diredtos',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #e0e0e0;border-radius:12px">
          <h2 style="background:linear-gradient(to right,#14B8A5,#22C562);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-top:0">Intranet Diredtos</h2>
          <p style="color:#374151">Hemos recibido una solicitud de recupero de contraseña en la división informática para su cuenta de dominio, esta es la clave de seguridad otorgada:</p>
          <div style="font-size:40px;font-weight:bold;letter-spacing:10px;text-align:center;padding:20px;background:linear-gradient(to right,#14B8A5,#22C562);color:#ffffff;border-radius:8px;margin:16px 0">
            ${otp}
          </div>
          <p style="color:#6b7280;font-size:13px">Este código expira en <strong>10 minutos</strong>.<br>Si no solicitaste este cambio, ignora este correo.</p>
        </div>
      `,
    });
  }
}
