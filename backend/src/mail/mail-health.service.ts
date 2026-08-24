import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import * as nodemailer from 'nodemailer';
import { Email } from './entities/email.entity';

/**
 * Vigila que el correo siga entrando.
 *
 * Mira la última ingesta en la tabla `emails` en vez de preguntarle al bridge:
 * así detecta cualquier causa —bridge caído, IMAP rechazando, backend
 * rechazando— incluso las que no anticipamos. Las tres caídas de agosto de 2026
 * se descubrieron a mano días después; esto las avisa el mismo día.
 */
@Injectable()
export class MailHealthService {
  private readonly logger = new Logger(MailHealthService.name);

  /** Evita repetir el aviso en cada ciclo mientras dura la misma caída. */
  private alertaVigente = false;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Email)
    private readonly emailRepo: Repository<Email>,
  ) {}

  @Cron('0 * * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async verificarIngesta(): Promise<void> {
    const horasUmbral = Number(this.configService.get<string>('MAIL_ALERT_HOURS') ?? '6');

    const fila = await this.emailRepo
      .createQueryBuilder('e')
      .select('MAX(e.createdAt)', 'ultima')
      .getRawOne<{ ultima: Date | null }>();

    const ultima = fila?.ultima ? new Date(fila.ultima) : null;
    if (!ultima) return; // base vacía — nada que vigilar todavía

    const horas = (Date.now() - ultima.getTime()) / 3_600_000;

    if (horas >= horasUmbral) {
      if (this.alertaVigente) return; // ya se avisó por esta caída
      this.logger.error(
        `Sin ingesta de correo hace ${horas.toFixed(1)}h (umbral ${horasUmbral}h) — enviando alerta`,
      );
      const enviado = await this.avisar(
        `[Intranet] Alerta: no entra correo hace ${Math.floor(horas)} horas`,
        this.cuerpoAlerta(ultima, horas),
      );
      if (enviado) this.alertaVigente = true;
      return;
    }

    if (this.alertaVigente) {
      this.alertaVigente = false;
      this.logger.log('La ingesta de correo se normalizó — enviando aviso de recuperación');
      await this.avisar(
        '[Intranet] Resuelto: el correo volvió a entrar',
        this.cuerpoRecuperacion(ultima),
      );
    }
  }

  private cuerpoAlerta(ultima: Date, horas: number): string {
    return [
      `No se ingiere correo nuevo desde hace ${horas.toFixed(1)} horas.`,
      '',
      `Ultimo correo ingerido: ${ultima.toLocaleString('es-AR')}`,
      '',
      'Que revisar, desde PowerShell en tu PC (sin Escritorio Remoto):',
      '',
      '  Get-Content \\172.21.36.104\c$\intranet2026\mail-bridge\bridge.log -Tail 40',
      '  Get-Content \\172.21.36.104\c$\intranet2026\mail-bridge\state.json',
      '  schtasks /Query /S 172.21.36.104 /TN "mail-bridge"',
      '',
      'Reiniciar el bridge si hace falta:',
      '',
      '  schtasks /End /S 172.21.36.104 /TN "mail-bridge"',
      '  schtasks /Run /S 172.21.36.104 /TN "mail-bridge"',
      '',
      'IMPORTANTE: no lo dejes para mas adelante. Los correos salen del INBOX del',
      'servidor a los pocos dias, y una vez que salen ya no se pueden recuperar por IMAP.',
    ].join('\n');
  }

  private cuerpoRecuperacion(ultima: Date): string {
    return [
      'La ingesta de correo se normalizo.',
      '',
      `Ultimo correo ingerido: ${ultima.toLocaleString('es-AR')}`,
      '',
      'Conviene verificar si quedaron correos sin entrar durante la interrupcion:',
      'comparar la bandeja de la intranet contra Outlook para el periodo afectado.',
    ].join('\n');
  }

  /** Devuelve true si el aviso salió; false si no hay destinatarios o falló el SMTP. */
  private async avisar(asunto: string, texto: string): Promise<boolean> {
    const destinatarios = (this.configService.get<string>('MAIL_ALERT_TO') ?? '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    if (destinatarios.length === 0) {
      this.logger.warn('MAIL_ALERT_TO no está configurado — no se envía la alerta');
      return false;
    }

    try {
      const smtpUser = this.configService.get<string>('SMTP_USER');
      const transporter = nodemailer.createTransport({
        host: this.configService.get<string>('SMTP_HOST') ?? 'localhost',
        port: Number(this.configService.get<string>('SMTP_PORT') ?? '25'),
        secure: this.configService.get<string>('SMTP_SECURE') === 'true',
        auth: smtpUser
          ? { user: smtpUser, pass: this.configService.get<string>('SMTP_PASS') ?? '' }
          : undefined,
        tls: { rejectUnauthorized: false },
      });

      await transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM') ?? 'noreply@iugnad.lan',
        to: destinatarios.join(', '),
        subject: asunto,
        text: texto,
      });

      this.logger.log(`Aviso enviado a ${destinatarios.join(', ')}`);
      return true;
    } catch (err) {
      // No relanzar: que falle el aviso no debe tumbar el cron.
      this.logger.error(`No se pudo enviar el aviso: ${(err as Error).message}`);
      return false;
    }
  }
}
