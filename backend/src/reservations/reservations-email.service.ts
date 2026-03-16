import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { ReservationsService } from './reservations.service';
import { UsersService } from '../users/users.service';
import { Reservation } from './entities/reservation.entity';

@Injectable()
export class ReservationsEmailService {
  private readonly logger = new Logger(ReservationsEmailService.name);

  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  /** Send confirmation email to the creator right after booking */
  async sendConfirmationToCreator(reservation: Reservation): Promise<void> {
    const user = await this.usersService.findById(reservation.creatorId);
    if (!user?.email || user.email.endsWith('@ldap.local')) {
      this.logger.warn(`No valid email for user ${reservation.creatorId}, skipping confirmation`);
      return;
    }

    const d = new Date(reservation.date + 'T12:00:00');
    const dateFormatted = d.toLocaleDateString('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const locationLabel = reservation.location === 'piso_8' ? 'Sala de conferencias - Piso 8' : 'Sala de conferencias - Piso 6';
    const equipmentLabel = reservation.equipmentType === 'notebook' ? 'Notebook' : 'Equipo completo (notebook + proyector, mic, pantalla)';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0f766e;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Solicitud realizada con éxito</h2>
          <p style="margin:4px 0 0;font-size:14px;opacity:0.85;">Tu solicitud ha sido registrada y está pendiente de confirmación por TICOM</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;width:140px;">Fecha</td>
              <td style="padding:8px 0;color:#111827;">${dateFormatted}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Horario</td>
              <td style="padding:8px 0;color:#111827;">${reservation.startTime} - ${reservation.endTime}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Sala</td>
              <td style="padding:8px 0;color:#111827;">${locationLabel}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Equipo</td>
              <td style="padding:8px 0;color:#111827;">${equipmentLabel}</td>
            </tr>
            ${reservation.conferenceUrl ? `
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">URL</td>
              <td style="padding:8px 0;color:#111827;"><a href="${reservation.conferenceUrl}" style="color:#0f766e;">${reservation.conferenceUrl}</a></td>
            </tr>` : ''}
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Estado</td>
              <td style="padding:8px 0;"><span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:12px;font-size:13px;">Pendiente</span></td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">
            Recibirás una notificación cuando el equipo de TICOM confirme la recepción de tu reserva.
          </p>
        </div>
      </div>`;

    try {
      const transporter = this.createTransport();
      await transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM') ?? 'noreply@iugnad.lan',
        to: user.email,
        subject: `Solicitud realizada con éxito - ${dateFormatted} ${reservation.startTime}`,
        html,
      });
      this.logger.log(`Confirmation email sent to ${user.email}`);
    } catch (err) {
      this.logger.error(`Failed to send confirmation email: ${err}`);
    }
  }

  /** Notify all TICOM members that a new reservation was created */
  async sendNewReservationToTicom(reservation: Reservation): Promise<void> {
    const ticomUsers = await this.usersService.findByRoleContaining('TICOM');
    const recipients = ticomUsers
      .map((u) => u.email)
      .filter((e) => e && !e.endsWith('@ldap.local'));
    if (recipients.length === 0) return;

    const d = new Date(reservation.date + 'T12:00:00');
    const dateFormatted = d.toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const locationLabel = reservation.location === 'piso_8'
      ? 'Sala de conferencias - Piso 8'
      : 'Sala de conferencias - Piso 6';
    const equipmentLabel = reservation.equipmentType === 'notebook'
      ? 'Notebook'
      : 'Equipo completo (notebook + proyector, mic, pantalla)';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1d4ed8;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Nueva solicitud de reserva</h2>
          <p style="margin:4px 0 0;font-size:14px;opacity:0.85;">${reservation.creatorName} solicitó equipo técnico para videoconferencia programada</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;width:140px;">Solicitante</td>
              <td style="padding:8px 0;color:#111827;">${reservation.creatorName}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Fecha</td>
              <td style="padding:8px 0;color:#111827;">${dateFormatted}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Horario</td>
              <td style="padding:8px 0;color:#111827;">${reservation.startTime} - ${reservation.endTime}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Sala</td>
              <td style="padding:8px 0;color:#111827;">${locationLabel}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Equipo</td>
              <td style="padding:8px 0;color:#111827;">${equipmentLabel}</td>
            </tr>
            ${reservation.conferenceUrl ? `
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">URL</td>
              <td style="padding:8px 0;color:#111827;"><a href="${reservation.conferenceUrl}" style="color:#1d4ed8;">${reservation.conferenceUrl}</a></td>
            </tr>` : ''}
          </table>
          <p style="margin:20px 0 0;font-size:13px;color:#374151;">
            Ingresá a la intranet para confirmar la recepción de esta reserva.
          </p>
        </div>
      </div>`;

    try {
      const transporter = this.createTransport();
      await transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM') ?? 'noreply@iugnad.lan',
        to: recipients.join(', '),
        subject: `Nueva reserva de ${reservation.creatorName} - ${dateFormatted} ${reservation.startTime}`,
        html,
      });
      this.logger.log(`New reservation notification sent to ${recipients.length} TICOM members`);
    } catch (err) {
      this.logger.error(`Failed to send TICOM notification: ${err}`);
    }
  }

  /** Send email to creator when TICOM acknowledges the reservation */
  async sendAcknowledgementToCreator(reservation: Reservation): Promise<void> {
    const user = await this.usersService.findById(reservation.creatorId);
    if (!user?.email || user.email.endsWith('@ldap.local')) return;

    const d = new Date(reservation.date + 'T12:00:00');
    const dateFormatted = d.toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const locationLabel = reservation.location === 'piso_8'
      ? 'Sala de conferencias - Piso 8'
      : 'Sala de conferencias - Piso 6';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#16a34a;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Reserva recibida por TICOM</h2>
          <p style="margin:4px 0 0;font-size:14px;opacity:0.85;">El equipo de TICOM ha confirmado tu reserva</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;width:140px;">Fecha</td>
              <td style="padding:8px 0;color:#111827;">${dateFormatted}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Horario</td>
              <td style="padding:8px 0;color:#111827;">${reservation.startTime} - ${reservation.endTime}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Sala</td>
              <td style="padding:8px 0;color:#111827;">${locationLabel}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Recibida por</td>
              <td style="padding:8px 0;color:#111827;">${reservation.technicianName ?? 'TICOM'}</td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-size:13px;color:#374151;">
            Los equipos estarán listos para tu videoconferencia. Ante cualquier consulta contacta al equipo de TICOM.
          </p>
        </div>
      </div>`;

    try {
      const transporter = this.createTransport();
      await transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM') ?? 'noreply@iugnad.lan',
        to: user.email,
        subject: `Reserva confirmada por TICOM - ${dateFormatted} ${reservation.startTime}`,
        html,
      });
      this.logger.log(`Acknowledgement email sent to ${user.email}`);
    } catch (err) {
      this.logger.error(`Failed to send acknowledgement email: ${err}`);
    }
  }

  /** Runs Mon-Fri at 6:30 AM (server timezone) */
  @Cron('30 6 * * 1-5')
  async sendDailyDigest(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    this.logger.log(`Sending daily reservation digest for ${today}`);

    const reservations = await this.reservationsService.findByDate(today);
    if (reservations.length === 0) {
      this.logger.log('No reservations today, skipping email');
      return;
    }

    const piso8Reservations = reservations.filter((r) => r.location === 'piso_8');

    // Get TICOM and AYUDANTIA users
    const [ticomUsers, ayudantiaUsers] = await Promise.all([
      this.usersService.findByRoleContaining('TICOM'),
      this.usersService.findByRoleContaining('AYUDANTIA'),
    ]);

    // Get creators of today's reservations
    const creatorIds = [...new Set(reservations.map((r) => r.creatorId))];
    const creators = await Promise.all(
      creatorIds.map((id) => this.usersService.findById(id)),
    );
    const creatorEmails = creators
      .filter((u) => u?.email && !u.email.endsWith('@ldap.local'))
      .map((u) => u!.email);

    const transporter = this.createTransport();

    // Collect all staff emails (TICOM + AYUDANTIA) to avoid duplicating to creators
    const staffEmailSet = new Set<string>();

    // Send to TICOM: all reservations
    const ticomEmails = ticomUsers
      .map((u) => u.email)
      .filter((e) => e && !e.endsWith('@ldap.local'));
    ticomEmails.forEach((e) => staffEmailSet.add(e));
    if (ticomEmails.length > 0) {
      await this.sendDigestEmail(transporter, ticomEmails, reservations, today, 'Todas las salas');
    }

    // Send to AYUDANTIA (excluding TICOM): only piso_8
    const ticomIds = new Set(ticomUsers.map((u) => u.id));
    const ayudantiaOnlyEmails = ayudantiaUsers
      .filter((u) => !ticomIds.has(u.id))
      .map((u) => u.email)
      .filter((e) => e && !e.endsWith('@ldap.local'));
    ayudantiaOnlyEmails.forEach((e) => staffEmailSet.add(e));
    if (ayudantiaOnlyEmails.length > 0 && piso8Reservations.length > 0) {
      await this.sendDigestEmail(transporter, ayudantiaOnlyEmails, piso8Reservations, today, 'Piso 8');
    }

    // Send to creators who are NOT already in TICOM/AYUDANTIA
    // Each creator gets only their own reservations for the day
    for (const creator of creators) {
      if (!creator?.email || creator.email.endsWith('@ldap.local')) continue;
      if (staffEmailSet.has(creator.email)) continue; // already received staff digest
      const myReservations = reservations.filter((r) => r.creatorId === creator.id);
      if (myReservations.length > 0) {
        await this.sendDigestEmail(
          transporter,
          [creator.email],
          myReservations,
          today,
          'Tus reservas del día',
        );
      }
    }

    this.logger.log('Daily digest sent successfully');
  }

  private createTransport() {
    const smtpUser = this.configService.get<string>('SMTP_USER');
    return nodemailer.createTransport({
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
  }

  private async sendDigestEmail(
    transporter: nodemailer.Transporter,
    recipients: string[],
    reservations: any[],
    date: string,
    scope: string,
  ): Promise<void> {
    const d = new Date(date + 'T12:00:00');
    const dateFormatted = d.toLocaleDateString('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const rows = reservations
      .map(
        (r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.startTime} - ${r.endTime}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.location === 'piso_8' ? 'Piso 8' : 'Piso 6'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.equipmentType === 'notebook' ? 'Notebook' : 'Equipo completo'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.creatorName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.status === 'pendiente' ? 'Pendiente' : 'Recibida'}</td>
      </tr>`,
      )
      .join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
        <div style="background:#0f766e;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Videoconferencias programadas</h2>
          <p style="margin:4px 0 0;font-size:14px;opacity:0.85;">${dateFormatted} &mdash; ${scope}</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:16px 0;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;">Horario</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;">Sala</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;">Equipo</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;">Solicitante</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
          <p style="padding:12px 12px 0;font-size:12px;color:#9ca3af;margin:0;">
            Total: ${reservations.length} videoconferencia${reservations.length > 1 ? 's' : ''}
          </p>
        </div>
      </div>`;

    try {
      await transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM') ?? 'noreply@iugnad.lan',
        to: recipients.join(', '),
        subject: `Videoconferencias del día - ${dateFormatted}`,
        html,
      });
      this.logger.log(`Digest sent to ${recipients.length} recipients (${scope})`);
    } catch (err) {
      this.logger.error(`Failed to send digest: ${err}`);
    }
  }
}
