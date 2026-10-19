import { BadRequestException, Body, Controller, Get, Put, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReservationsEmailService } from './reservations-email.service';

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * Administración → Avisos de reservas (TICOM): los correos que reciben el aviso
 * de todas las videoconferencias, a las 20:00 del día anterior y a las 6:30 del día.
 */
@Controller('reservation-reminders')
@Roles('TICOM')
export class ReservationRemindersController {
  constructor(private readonly emails: ReservationsEmailService) {}

  @Get()
  async get() {
    return { emails: await this.emails.getReminderEmails() };
  }

  @Put()
  async set(@Req() req: any, @Body() body: { emails?: unknown }) {
    if (!Array.isArray(body.emails)) throw new BadRequestException('Falta la lista de correos');
    const list = body.emails.map((e) => String(e ?? '').trim()).filter(Boolean);
    const wrong = list.filter((e) => !EMAIL.test(e));
    if (wrong.length) throw new BadRequestException(`Correo inválido: ${wrong.join(', ')}`);
    if (list.length > 100) throw new BadRequestException('Máximo 100 correos');
    return { emails: await this.emails.setReminderEmails(list, req.user?.username ?? '?') };
  }
}
