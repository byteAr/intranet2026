import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class WelcomeEmailService {
  private readonly logger = new Logger(WelcomeEmailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendWelcome(params: {
    to: string;
    displayName: string;
    username: string;
    password: string;
    institutionalEmail: string;
    domain: string;
  }): Promise<void> {
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const transporter = nodemailer.createTransport({
      host:   this.configService.get<string>('SMTP_HOST') ?? 'localhost',
      port:   Number(this.configService.get<string>('SMTP_PORT') ?? '25'),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth:   smtpUser ? { user: smtpUser, pass: this.configService.get<string>('SMTP_PASS') ?? '' } : undefined,
      tls:    { rejectUnauthorized: false },
    });

    // ── Adjuntos inline (logo + instrucciones 1-7) ────────────────────────────
    const attachments: nodemailer.Attachment[] = [];

    const logoPath = path.join(process.cwd(), 'assets', 'logo.png');
    if (fs.existsSync(logoPath)) {
      attachments.push({ filename: 'logo.png', path: logoPath, cid: 'logo@intranet' });
    }

    for (let i = 1; i <= 7; i++) {
      const imgPath = path.join(process.cwd(), 'assets', 'sfainstruction', `${i}.png`);
      if (fs.existsSync(imgPath)) {
        attachments.push({ filename: `step${i}.png`, path: imgPath, cid: `step${i}@intranet` });
      }
    }

    const html = this.buildHtml(params, attachments);

    await transporter.sendMail({
      from:        this.configService.get<string>('SMTP_FROM') ?? 'noreply@iugnad.lan',
      to:          params.to,
      subject:     `Bienvenido/a a la Intranet - Tus credenciales de acceso`,
      html,
      attachments,
    });

    this.logger.log('Email de bienvenida enviado a %s (%s)', params.displayName, params.to);
  }

  private buildHtml(
    p: { displayName: string; username: string; password: string; institutionalEmail: string; domain: string },
    attachments: nodemailer.Attachment[],
  ): string {
    const hasLogo = attachments.some(a => a.cid === 'logo@intranet');
    const logoHtml = hasLogo
      ? `<img src="cid:logo@intranet" alt="Logo" style="height:48px;object-fit:contain;" />`
      : `<span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:1px;">DIREDTOS</span>`;

    const stepImages = Array.from({ length: 7 }, (_, i) => i + 1)
      .filter(i => attachments.some(a => a.cid === `step${i}@intranet`))
      .map(i => `
        <tr>
          <td style="padding:8px 0 20px 0;">
            <p style="margin:0 0 8px 0;font-size:14px;font-weight:600;color:#0f766e;">Paso ${i}</p>
            <img src="cid:step${i}@intranet" alt="Paso ${i}"
              style="max-width:100%;border-radius:8px;border:1px solid #ccfbf1;display:block;" />
          </td>
        </tr>`)
      .join('');

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0fdfa;font-family:'Segoe UI',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:620px;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#0d9488 0%,#0f766e 60%,#134e4a 100%);padding:32px 40px;text-align:center;">
            ${logoHtml}
            <p style="margin:16px 0 0 0;font-size:13px;color:#99f6e4;letter-spacing:2px;text-transform:uppercase;">
              Dirección de Educación de la Gendarmería Nacional
            </p>
          </td>
        </tr>

        <!-- SALUDO -->
        <tr>
          <td style="background:#ffffff;padding:36px 40px 24px 40px;">
            <h1 style="margin:0 0 8px 0;font-size:22px;color:#134e4a;font-weight:700;">
              ¡Bienvenido/a, ${p.displayName}!
            </h1>
            <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
              Tu cuenta institucional ha sido creada exitosamente. A continuación encontrarás
              tus credenciales de acceso y las instrucciones para comenzar a utilizarlas.
            </p>
          </td>
        </tr>

        <!-- CREDENCIALES PC (AD) -->
        <tr>
          <td style="background:#ffffff;padding:0 40px 28px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;overflow:hidden;">
              <tr>
                <td style="background:#0d9488;padding:14px 20px;">
                  <p style="margin:0;font-size:13px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:1px;">
                    🖥️ Acceso a la PC (Windows / Active Directory)
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table cellpadding="6" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;font-weight:600;padding-right:16px;">Usuario:</td>
                      <td style="font-size:15px;color:#134e4a;font-weight:700;font-family:monospace;">${p.username}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;font-weight:600;padding-right:16px;">Contraseña:</td>
                      <td style="font-size:15px;color:#134e4a;font-weight:700;font-family:monospace;">${p.password}</td>
                    </tr>
                  </table>
                  <p style="margin:14px 0 0 0;font-size:12px;color:#0f766e;background:#ccfbf1;
                    border-radius:6px;padding:8px 12px;">
                    ⚠️ Al iniciar sesión por primera vez en Windows, el sistema te pedirá
                    que cambies esta contraseña por una propia.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CREDENCIALES GMAIL -->
        <tr>
          <td style="background:#ffffff;padding:0 40px 36px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;overflow:hidden;">
              <tr>
                <td style="background:#0f766e;padding:14px 20px;">
                  <p style="margin:0;font-size:13px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:1px;">
                    📧 Acceso al Correo Institucional (Gmail)
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table cellpadding="6" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;font-weight:600;padding-right:16px;">Correo:</td>
                      <td style="font-size:15px;color:#134e4a;font-weight:700;font-family:monospace;">${p.institutionalEmail}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;font-weight:600;padding-right:16px;">Contraseña:</td>
                      <td style="font-size:15px;color:#134e4a;font-weight:700;font-family:monospace;">${p.password}</td>
                    </tr>
                  </table>
                  <p style="margin:14px 0 0 0;font-size:12px;color:#0f766e;background:#ccfbf1;
                    border-radius:6px;padding:8px 12px;">
                    ⚠️ Al ingresar por primera vez a Gmail, deberás cambiar la contraseña
                    e ingresar a <strong>mail.google.com</strong> con tu correo institucional.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ALERTA 2FA -->
        <tr>
          <td style="background:#ffffff;padding:0 40px 36px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#fef3c7;border:2px solid #f59e0b;border-radius:12px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 8px 0;font-size:15px;font-weight:700;color:#92400e;">
                    🔐 VERIFICACIÓN EN DOS PASOS — OBLIGATORIA
                  </p>
                  <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6;">
                    La organización exige la activación de la verificación en dos pasos en tu
                    cuenta de correo institucional. <strong>Si no la configurás al ingresar por
                    primera vez, perderás el acceso a tu cuenta.</strong> Seguí los pasos que
                    se detallan a continuación.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- INSTRUCCIONES 2FA -->
        ${stepImages ? `
        <tr>
          <td style="background:#ffffff;padding:0 40px 8px 40px;">
            <p style="margin:0 0 20px 0;font-size:16px;font-weight:700;color:#134e4a;">
              Pasos para activar la verificación en dos pasos
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${stepImages}
            </table>
          </td>
        </tr>` : ''}

        <!-- FOOTER -->
        <tr>
          <td style="background:linear-gradient(135deg,#134e4a 0%,#0f766e 100%);padding:28px 40px;text-align:center;">
            <p style="margin:0 0 6px 0;font-size:13px;color:#99f6e4;">
              Este correo fue generado automáticamente por el sistema de gestión de cuentas.
            </p>
            <p style="margin:0;font-size:12px;color:#5eead4;">
              Dirección de Educación — Gendarmería Nacional Argentina &copy; ${new Date().getFullYear()}
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}
