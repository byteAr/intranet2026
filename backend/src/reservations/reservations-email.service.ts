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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private ayudantiaGroupLabel(location: 'piso_8' | 'piso_6'): string {
    return location === 'piso_8' ? 'AYUDANTIADIREDTOS' : 'AYUDANTIARECTORADO';
  }

  private formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  private locationLabel(location: string): string {
    return location === 'piso_8' ? 'Sala de conferencias - Piso 8' : 'Sala de conferencias - Piso 6';
  }

  private equipmentLabel(eq: string): string {
    return eq === 'notebook' ? 'Notebook' : 'Equipo completo (notebook + proyector, mic, pantalla)';
  }

  /** Rows with all reservation details including the conference link */
  private detailRows(r: Reservation, dateFormatted: string): string {
    const urlRow = r.conferenceUrl
      ? `<tr><td style="padding:8px 0;color:#6b7280;font-weight:600;width:140px;">Enlace</td><td style="padding:8px 0;"><a href="${r.conferenceUrl}" style="color:#0f766e;word-break:break-all;">${r.conferenceUrl}</a></td></tr>`
      : '';
    return `
      <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;width:140px;">Sala</td><td style="padding:8px 0;color:#111827;">${this.locationLabel(r.location)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;">Fecha</td><td style="padding:8px 0;color:#111827;">${dateFormatted}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;">Horario</td><td style="padding:8px 0;color:#111827;">${r.startTime} - ${r.endTime}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;">Equipo</td><td style="padding:8px 0;color:#111827;">${this.equipmentLabel(r.equipmentType)}</td></tr>
      ${urlRow}`;
  }

  /** Returns only the corporate/institutional email (never recovery email) */
  private corporateEmail(user: { email?: string; recoveryEmail?: string }): string | null {
    const email = user.email;
    if (!email || email.endsWith('@ldap.local')) return null;
    return email;
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      const transporter = this.createTransport();
      await transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM') ?? 'noreply@iugnad.lan',
        to,
        subject,
        html,
      });
      this.logger.log(`Email sent to ${to} — "${subject}"`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${err}`);
    }
  }

  // ── Triggered on reservation creation (and re-submission after rejection) ────

  /**
   * Creator receives 1 email: request registered, pending AYUDANTIA approval,
   * then TICOM confirmation. Includes all reservation details + conference link.
   */
  async sendConfirmationToCreator(reservation: Reservation): Promise<void> {
    const user = await this.usersService.findById(reservation.creatorId);
    const email = this.corporateEmail(user ?? {});
    if (!email) {
      this.logger.warn(`No corporate email for creator ${reservation.creatorId}, skipping`);
      return;
    }

    const dateFormatted = this.formatDate(reservation.date);
    const group = this.ayudantiaGroupLabel(reservation.location);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0f766e;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Solicitud de videoconferencia generada exitosamente</h2>
          <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">
            Tu solicitud fue registrada. A continuación te detallamos los pasos que seguirá:
          </p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">

          <!-- Steps -->
          <div style="margin-bottom:20px;padding:16px;background:#f9fafb;border-radius:8px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Estado actual del proceso:</p>
            <ol style="margin:0;padding-left:20px;font-size:13px;color:#374151;line-height:1.8;">
              <li><strong style="color:#d97706;">Pendiente de aprobación</strong> por <strong>${group}</strong> — en espera</li>
              <li style="color:#9ca3af;">Confirmación por <strong>TICOM</strong> — una vez aprobada por ${group}</li>
            </ol>
            <p style="margin:10px 0 0;font-size:12px;color:#6b7280;">
              Recibirás un correo en cada etapa informándote del estado de tu solicitud.
            </p>
          </div>

          <!-- Details -->
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            ${this.detailRows(reservation, dateFormatted)}
          </table>
        </div>
      </div>`;

    await this.send(email, `Solicitud registrada — pendiente de aprobación por ${group}`, html);
  }

  /**
   * AYUDANTIADIREDTOS (piso_8) or AYUDANTIARECTORADO (piso_6) receives 1 email:
   * "[Nombre Apellido] solicita la sala del piso X — debe autorizarla desde la intranet".
   * The creator's email is excluded to avoid duplicates if they're in both groups.
   */
  async sendNewReservationToAyudantia(reservation: Reservation): Promise<void> {
    const group = this.ayudantiaGroupLabel(reservation.location);
    const ayudantiaUsers = await this.usersService.findByRoleContaining(group);

    // Also include legacy 'AYUDANTIA' role users for piso_8 (backward compat)
    let allUsers = ayudantiaUsers;
    if (reservation.location === 'piso_8') {
      const legacyUsers = await this.usersService.findByRoleContaining('AYUDANTIA');
      const existingIds = new Set(ayudantiaUsers.map((u) => u.id));
      const extra = legacyUsers.filter((u) => !existingIds.has(u.id));
      allUsers = [...ayudantiaUsers, ...extra];
    }

    // Get creator email to exclude (avoid sending 2 emails to someone who is both creator and approver)
    const creator = await this.usersService.findById(reservation.creatorId);
    const creatorEmail = this.corporateEmail(creator ?? {});

    const recipients = [...new Set(
      allUsers
        .map((u) => this.corporateEmail(u))
        .filter((e): e is string => e !== null && e !== creatorEmail),
    )];

    if (recipients.length === 0) {
      this.logger.warn(`No recipients found for ${group} notification`);
      return;
    }

    const dateFormatted = this.formatDate(reservation.date);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#d97706;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Nueva solicitud de videoconferencia para autorizar</h2>
          <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">
            <strong>${reservation.creatorName}</strong> solicita el uso de la sala de videoconferencias
            del <strong>${reservation.location === 'piso_8' ? 'Piso 8' : 'Piso 6'}</strong>.
          </p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;width:140px;">Solicitante</td><td style="padding:8px 0;color:#111827;font-weight:600;">${reservation.creatorName}</td></tr>
            ${this.detailRows(reservation, dateFormatted)}
          </table>
          <div style="margin-top:20px;padding:14px 16px;background:#fefce8;border:1px solid #fde68a;border-radius:8px;">
            <p style="margin:0;font-size:13px;color:#92400e;">
              Para aprobar o rechazar esta solicitud, ingresa a la intranet y accede al módulo de
              <strong>Reservas</strong>. La solicitud estará visible en tu panel pendiente de aprobación.
            </p>
          </div>
        </div>
      </div>`;

    await this.send(recipients.join(', '), `Nueva solicitud de videoconferencia — ${reservation.creatorName} (${reservation.location === 'piso_8' ? 'Piso 8' : 'Piso 6'})`, html);
  }

  // ── Triggered after AYUDANTIA approves ───────────────────────────────────────

  /** Creator receives email: approved by AYUDANTIA group, now pending TICOM */
  async sendApprovalToCreator(reservation: Reservation): Promise<void> {
    const user = await this.usersService.findById(reservation.creatorId);
    const email = this.corporateEmail(user ?? {});
    if (!email) return;

    const dateFormatted = this.formatDate(reservation.date);
    const group = reservation.ayudantiaApprovedByGroup ?? this.ayudantiaGroupLabel(reservation.location);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1d4ed8;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Solicitud aprobada por ${group}</h2>
          <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">
            Tu solicitud avanzó al siguiente paso — ahora está pendiente de confirmación por TICOM.
          </p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">

          <div style="margin-bottom:20px;padding:16px;background:#eff6ff;border-radius:8px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#1e40af;">Estado actual del proceso:</p>
            <ol style="margin:0;padding-left:20px;font-size:13px;color:#374151;line-height:1.8;">
              <li style="color:#16a34a;"><strong>✓ Aprobada</strong> por <strong>${group}</strong></li>
              <li><strong style="color:#d97706;">Pendiente de confirmación</strong> por <strong>TICOM</strong></li>
            </ol>
          </div>

          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            ${this.detailRows(reservation, dateFormatted)}
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">
            Recibirás un correo cuando el equipo TICOM confirme la disponibilidad del equipamiento.
          </p>
        </div>
      </div>`;

    await this.send(email, `Solicitud aprobada por ${group} — pendiente de confirmación TICOM`, html);
  }

  /**
   * TICOM receives email: AYUDANTIA authorized the room, needs TICOM to confirm
   * to notify the creator of the resolution.
   */
  async sendNewReservationToTicom(reservation: Reservation): Promise<void> {
    const ticomUsers = await this.usersService.findByRoleContaining('TICOM');
    const recipients = [...new Set(
      ticomUsers
        .map((u) => this.corporateEmail(u))
        .filter((e): e is string => e !== null),
    )];
    if (recipients.length === 0) return;

    const dateFormatted = this.formatDate(reservation.date);
    const group = reservation.ayudantiaApprovedByGroup ?? this.ayudantiaGroupLabel(reservation.location);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1d4ed8;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">${group} ha autorizado una solicitud de videoconferencia</h2>
          <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">
            Esta solicitud debe ser <strong>confirmada por TICOM</strong> para notificar al solicitante de la resolución.
          </p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;width:140px;">Solicitante</td><td style="padding:8px 0;color:#111827;font-weight:600;">${reservation.creatorName}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;">Autorizado por</td><td style="padding:8px 0;color:#111827;">${reservation.ayudantiaApprovedByName ?? group} (${group})</td></tr>
            ${this.detailRows(reservation, dateFormatted)}
          </table>
          <div style="margin-top:20px;padding:14px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
            <p style="margin:0;font-size:13px;color:#1e3a8a;">
              Ingresa a la intranet, módulo <strong>Reservas</strong>, para confirmar la disponibilidad del
              equipamiento y notificar al solicitante.
            </p>
          </div>
        </div>
      </div>`;

    await this.send(recipients.join(', '), `Solicitud autorizada por ${group} — pendiente de confirmación TICOM`, html);
  }

  // ── Triggered after AYUDANTIA rejects ────────────────────────────────────────

  /** Creator receives email: rejected with reason, can edit and resubmit */
  async sendRejectionToCreator(reservation: Reservation): Promise<void> {
    const user = await this.usersService.findById(reservation.creatorId);
    const email = this.corporateEmail(user ?? {});
    if (!email) return;

    const dateFormatted = this.formatDate(reservation.date);
    const group = reservation.rejectedByGroup ?? this.ayudantiaGroupLabel(reservation.location);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#dc2626;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Solicitud rechazada por ${group}</h2>
          <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">
            Tu solicitud de videoconferencia no fue aprobada.
          </p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            ${this.detailRows(reservation, dateFormatted)}
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Rechazada por</td>
              <td style="padding:8px 0;color:#111827;">${reservation.rejectedByName ?? group} (${group})</td>
            </tr>
          </table>
          <div style="margin-top:16px;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#991b1b;">Motivo del rechazo:</p>
            <p style="margin:0;font-size:13px;color:#7f1d1d;">${reservation.rejectionReason ?? 'Sin motivo especificado'}</p>
          </div>
          <div style="margin-top:16px;padding:14px 16px;background:#f9fafb;border-radius:8px;">
            <p style="margin:0;font-size:13px;color:#374151;">
              Puedes ingresar a la intranet, editar tu solicitud con una fecha u horario diferente
              y volver a enviarla. El flujo de aprobación se reiniciará desde el inicio.
            </p>
          </div>
        </div>
      </div>`;

    await this.send(email, `Solicitud rechazada por ${group} — ${dateFormatted}`, html);
  }

  // ── Triggered after TICOM confirms ───────────────────────────────────────────

  /** Creator receives email: confirmed by TICOM with all reservation details */
  async sendTicomConfirmationToCreator(reservation: Reservation): Promise<void> {
    const user = await this.usersService.findById(reservation.creatorId);
    const email = this.corporateEmail(user ?? {});
    if (!email) return;

    const dateFormatted = this.formatDate(reservation.date);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#16a34a;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Videoconferencia confirmada por TICOM</h2>
          <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">
            El equipo TICOM confirmó la disponibilidad del equipamiento para tu videoconferencia.
          </p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">

          <div style="margin-bottom:20px;padding:16px;background:#f0fdf4;border-radius:8px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#166534;">Proceso completado:</p>
            <ol style="margin:0;padding-left:20px;font-size:13px;color:#374151;line-height:1.8;">
              <li style="color:#16a34a;"><strong>✓ Aprobada</strong> por ${reservation.ayudantiaApprovedByGroup ?? 'AYUDANTIA'}</li>
              <li style="color:#16a34a;"><strong>✓ Confirmada</strong> por <strong>TICOM</strong></li>
            </ol>
          </div>

          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            ${this.detailRows(reservation, dateFormatted)}
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;">Confirmada por</td>
              <td style="padding:8px 0;color:#111827;">${reservation.ticomConfirmedByName ?? 'TICOM'} (TICOM)</td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">
            Los equipos estarán listos para tu videoconferencia. Ante cualquier inconveniente, comunícate con el equipo de TICOM.
          </p>
        </div>
      </div>`;

    await this.send(email, `Videoconferencia confirmada por TICOM — ${dateFormatted} ${reservation.startTime}`, html);
  }

  // ── Triggered after TICOM cancels definitively ───────────────────────────────

  /**
   * Creator AND the responsible AYUDANTIA group receive an email:
   * TICOM cancelled the reservation definitively due to technical issues.
   * No re-activation is possible.
   */
  async sendTicomCancellation(reservation: Reservation): Promise<void> {
    const dateFormatted = this.formatDate(reservation.date);
    const cancelledBy = reservation.ticomCancelledByName ?? 'TICOM';
    const reason = reservation.ticomCancellationReason ?? 'Sin motivo especificado';
    const group = this.ayudantiaGroupLabel(reservation.location);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#7c3aed;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Videoconferencia cancelada por TICOM</h2>
          <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">
            La solicitud de videoconferencia de <strong>${reservation.creatorName}</strong>
            no podrá realizarse por un impedimento técnico.
          </p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;width:140px;">Solicitante</td><td style="padding:8px 0;color:#111827;font-weight:600;">${reservation.creatorName}</td></tr>
            ${this.detailRows(reservation, dateFormatted)}
            <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;">Cancelada por</td><td style="padding:8px 0;color:#111827;">${cancelledBy} (TICOM)</td></tr>
          </table>
          <div style="margin-top:16px;padding:14px 16px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#6d28d9;">Motivo de la cancelación:</p>
            <p style="margin:0;font-size:13px;color:#4c1d95;">${reason}</p>
          </div>
          <div style="margin-top:14px;padding:12px 16px;background:#f9fafb;border-radius:8px;">
            <p style="margin:0;font-size:12px;color:#6b7280;">
              Esta cancelación es definitiva. Si necesitas coordinar una nueva videoconferencia,
              deberás crear una nueva solicitud en la intranet en una fecha u horario diferente.
            </p>
          </div>
        </div>
      </div>`;

    // Notify creator
    const creator = await this.usersService.findById(reservation.creatorId);
    const creatorEmail = this.corporateEmail(creator ?? {});

    // Notify the responsible AYUDANTIA group (they approved it)
    const ayudantiaUsers = await this.usersService.findByRoleContaining(group);
    let allAyudantiaUsers = ayudantiaUsers;
    if (reservation.location === 'piso_8') {
      const legacyUsers = await this.usersService.findByRoleContaining('AYUDANTIA');
      const existingIds = new Set(ayudantiaUsers.map((u) => u.id));
      allAyudantiaUsers = [...ayudantiaUsers, ...legacyUsers.filter((u) => !existingIds.has(u.id))];
    }

    const ayudantiaEmails = allAyudantiaUsers
      .map((u) => this.corporateEmail(u))
      .filter((e): e is string => e !== null);

    const recipients = [...new Set([
      ...(creatorEmail ? [creatorEmail] : []),
      ...ayudantiaEmails,
    ])];

    if (recipients.length === 0) {
      this.logger.warn(`No recipients for TICOM cancellation of reservation ${reservation.id}`);
      return;
    }

    const subject = `Videoconferencia cancelada por TICOM — ${reservation.creatorName} (${reservation.location === 'piso_8' ? 'Piso 8' : 'Piso 6'}, ${dateFormatted})`;
    await this.send(recipients.join(', '), subject, html);
  }

  // ── Triggered when AYUDANTIA blocks a period and cancels reservations ────────

  /** Creator receives email: their reservation was cancelled because an AYUDANTIA group blocked the period */
  async sendBlockedPeriodCancellationToCreator(reservation: Reservation): Promise<void> {
    const user = await this.usersService.findById(reservation.creatorId);
    const email = this.corporateEmail(user ?? {});
    if (!email) {
      this.logger.warn(`No corporate email for creator ${reservation.creatorId}, skipping block cancellation email`);
      return;
    }

    const dateFormatted = this.formatDate(reservation.date);
    const blockedByName = reservation.blockCancelledByName ?? 'Ayudantía';
    const blockedByGroup = reservation.blockCancelledByGroup ?? '';
    const reason = reservation.blockCancellationReason ?? 'Sin motivo especificado';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#c2410c;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Tu videoconferencia fue cancelada — bloqueo de horario</h2>
          <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">
            El horario de tu videoconferencia ha sido bloqueado por ${blockedByGroup}, lo que impide el uso de la sala.
          </p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">

          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            ${this.detailRows(reservation, dateFormatted)}
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-weight:600;width:140px;">Bloqueado por</td>
              <td style="padding:8px 0;color:#111827;">${blockedByName}${blockedByGroup ? ' (' + blockedByGroup + ')' : ''}</td>
            </tr>
          </table>

          <div style="margin-top:16px;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#c2410c;">Motivo del bloqueo:</p>
            <p style="margin:0;font-size:13px;color:#9a3412;">${reason}</p>
          </div>

          <div style="margin-top:14px;padding:12px 16px;background:#f9fafb;border-radius:8px;">
            <p style="margin:0;font-size:12px;color:#6b7280;">
              El horario fue bloqueado por un evento o reunión que impide el uso de la sala en ese período.
              Puedes crear una nueva solicitud para una fecha u horario diferente desde la intranet.
            </p>
          </div>
        </div>
      </div>`;

    await this.send(email, `Videoconferencia cancelada por bloqueo — ${dateFormatted}`, html);
  }

  // ── Daily digest (cron Mon-Fri 6:30 AM) ──────────────────────────────────────

  @Cron('30 6 * * 1-5')
  async sendDailyDigest(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    this.logger.log(`Sending daily reservation digest for ${today}`);

    const reservations = await this.reservationsService.findByDate(today);
    const activeReservations = reservations.filter((r) => r.status !== 'rechazada' && r.status !== 'cancelada');
    if (activeReservations.length === 0) {
      this.logger.log('No active reservations today, skipping email');
      return;
    }

    const piso8 = activeReservations.filter((r) => r.location === 'piso_8');
    const piso6 = activeReservations.filter((r) => r.location === 'piso_6');

    const [ticomUsers, diredtosUsers, rectoradoUsers, legacyAyudantiaUsers] = await Promise.all([
      this.usersService.findByRoleContaining('TICOM'),
      this.usersService.findByRoleContaining('AYUDANTIADIREDTOS'),
      this.usersService.findByRoleContaining('AYUDANTIARECTORADO'),
      this.usersService.findByRoleContaining('AYUDANTIA'),
    ]);

    const creatorIds = [...new Set(activeReservations.map((r) => r.creatorId))];
    const creators = await Promise.all(creatorIds.map((id) => this.usersService.findById(id)));

    const transporter = this.createTransport();
    const staffEmailSet = new Set<string>();

    // TICOM: all reservations
    const ticomEmails = [...new Set(ticomUsers.map((u) => this.corporateEmail(u)).filter((e): e is string => e !== null))];
    ticomEmails.forEach((e) => staffEmailSet.add(e));
    if (ticomEmails.length > 0) {
      await this.sendDigestEmail(transporter, ticomEmails, activeReservations, today, 'Todas las salas');
    }

    // AYUDANTIADIREDTOS + legacy AYUDANTIA: piso_8
    const ticomIds = new Set(ticomUsers.map((u) => u.id));
    const allDiredtosUsers = [...diredtosUsers, ...legacyAyudantiaUsers.filter((u) => !diredtosUsers.find((d) => d.id === u.id))];
    const diredtosEmails = [...new Set(
      allDiredtosUsers.filter((u) => !ticomIds.has(u.id)).map((u) => this.corporateEmail(u)).filter((e): e is string => e !== null),
    )];
    diredtosEmails.forEach((e) => staffEmailSet.add(e));
    if (diredtosEmails.length > 0 && piso8.length > 0) {
      await this.sendDigestEmail(transporter, diredtosEmails, piso8, today, 'Piso 8');
    }

    // AYUDANTIARECTORADO: piso_6
    const diredtosAndTicomIds = new Set([...ticomIds, ...allDiredtosUsers.map((u) => u.id)]);
    const rectoradoEmails = [...new Set(
      rectoradoUsers.filter((u) => !diredtosAndTicomIds.has(u.id)).map((u) => this.corporateEmail(u)).filter((e): e is string => e !== null),
    )];
    rectoradoEmails.forEach((e) => staffEmailSet.add(e));
    if (rectoradoEmails.length > 0 && piso6.length > 0) {
      await this.sendDigestEmail(transporter, rectoradoEmails, piso6, today, 'Piso 6');
    }

    // Creators not in staff: their own reservations only
    for (const creator of creators) {
      if (!creator) continue;
      const email = this.corporateEmail(creator);
      if (!email || staffEmailSet.has(email)) continue;
      const mine = activeReservations.filter((r) => r.creatorId === creator.id);
      if (mine.length > 0) {
        await this.sendDigestEmail(transporter, [email], mine, today, 'Tus reservas del día');
      }
    }

    this.logger.log('Daily digest sent successfully');
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private statusLabel(status: string): string {
    if (status === 'pendiente_ayudantia') return 'Pend. aprobación';
    if (status === 'pendiente_ticom') return 'Pend. TICOM';
    if (status === 'confirmada') return 'Confirmada';
    if (status === 'rechazada') return 'Rechazada';
    if (status === 'cancelada') return 'Cancelada por TICOM';
    return status;
  }

  private createTransport() {
    const smtpUser = this.configService.get<string>('SMTP_USER');
    return nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST') ?? 'localhost',
      port: Number(this.configService.get<string>('SMTP_PORT') ?? '25'),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: smtpUser
        ? { user: smtpUser, pass: this.configService.get<string>('SMTP_PASS') ?? '' }
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
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    const rows = reservations.map((r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.startTime} - ${r.endTime}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.location === 'piso_8' ? 'Piso 8' : 'Piso 6'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.equipmentType === 'notebook' ? 'Notebook' : 'Equipo completo'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.creatorName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${this.statusLabel(r.status)}</td>
      </tr>`).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
        <div style="background:#0f766e;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">Videoconferencias programadas para hoy</h2>
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
            <tbody>${rows}</tbody>
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
        subject: `Videoconferencias del día — ${dateFormatted}`,
        html,
      });
      this.logger.log(`Digest sent to ${recipients.length} recipients (${scope})`);
    } catch (err) {
      this.logger.error(`Failed to send digest: ${err}`);
    }
  }
}
