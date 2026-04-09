import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as ldap from 'ldapjs';
import * as path from 'path';
import * as fs from 'fs';
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

    // OTP válido — resetear en AD via linux-ad-bridge (Kerberos/GSSAPI)
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

    const year = new Date().getFullYear();
    const logoPath = path.join(process.cwd(), 'assets', 'logo.png');
    const logoExists = fs.existsSync(logoPath);

    await transporter.sendMail({
      from: this.configService.get<string>('SMTP_FROM') ?? 'noreply@iugnad.lan',
      to,
      subject: 'Recuperación de contraseña - Intranet Diredtos',
      attachments: logoExists ? [{
        filename: 'logo.png',
        path: logoPath,
        cid: 'logo@intranet',
      }] : [],
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 0">
            <tr><td align="center">
              <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

                <!-- Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#0d9488,#166534);padding:28px 32px;text-align:center">
                    <img src="cid:logo@intranet" alt="Intranet Diredtos" height="80"
                         style="height:80px;object-fit:contain;display:block;margin:0 auto" />
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:32px">
                    <h1 style="margin:0 0 8px 0;font-size:20px;color:#111827;font-weight:700">
                      Recuperación de contraseña
                    </h1>
                    <p style="margin:0 0 24px 0;font-size:15px;color:#374151;line-height:1.6">
                      Hemos recibido una solicitud para restablecer la contraseña de su cuenta de dominio.
                      Utilice el siguiente código de verificación:
                    </p>

                    <!-- OTP -->
                    <div style="background:linear-gradient(135deg,#0d9488,#166534);border-radius:12px;padding:28px;text-align:center;margin:0 0 24px 0">
                      <p style="margin:0 0 6px 0;font-size:12px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:2px;font-weight:600">
                        Código de verificación
                      </p>
                      <p style="margin:0;font-size:48px;font-weight:700;letter-spacing:14px;color:#ffffff;font-family:'Courier New',monospace">
                        ${otp}
                      </p>
                    </div>

                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border-radius:8px;margin:0 0 24px 0">
                      <tr>
                        <td style="padding:14px 16px">
                          <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5">
                            ⏱ Este código expira en <strong>10 minutos</strong>.<br>
                            Si no solicitaste este cambio, ignorá este correo — tu contraseña permanece sin cambios.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center">
                    <p style="margin:0 0 4px 0;font-size:12px;color:#6b7280;font-weight:600">
                      División Tecnología de la Información y Comunicaciones
                    </p>
                    <p style="margin:0;font-size:11px;color:#9ca3af">
                      Dirección de Educación e Institutos &nbsp;·&nbsp; ${year}
                    </p>
                  </td>
                </tr>

              </table>
            </td></tr>
          </table>
        </body>
        </html>
      `,
    });
  }
}
