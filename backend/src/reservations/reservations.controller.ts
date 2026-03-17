import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsGateway } from './reservations.gateway';
import { ReservationsEmailService } from './reservations-email.service';
import { BlockedPeriodsService } from './blocked-periods.service';
import { UsersService } from '../users/users.service';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly reservationsGateway: ReservationsGateway,
    private readonly reservationsEmailService: ReservationsEmailService,
    private readonly blockedPeriodsService: BlockedPeriodsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const { date, startTime, durationHours, location, equipmentType, conferenceUrl } = body;
    if (!date || !startTime || !durationHours || !location || !equipmentType) {
      throw new BadRequestException('Todos los campos obligatorios deben completarse');
    }

    const validLocations = ['piso_8', 'piso_6'];
    const validEquipment = ['notebook', 'equipo_completo'];
    if (!validLocations.includes(location)) {
      throw new BadRequestException('Ubicación inválida');
    }
    if (!validEquipment.includes(equipmentType)) {
      throw new BadRequestException('Tipo de equipo inválido');
    }

    const user = req.user;
    const reservation = await this.reservationsService.create({
      creatorId: user.id,
      creatorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username,
      creatorAvatar: user.avatar,
      date,
      startTime,
      durationHours: Number(durationHours),
      location,
      equipmentType,
      conferenceUrl: conferenceUrl?.trim() || undefined,
    });

    this.reservationsGateway.notifyNewReservation(reservation);
    this.reservationsEmailService.sendConfirmationToCreator(reservation).catch(() => {});
    this.reservationsEmailService.sendNewReservationToAyudantia(reservation).catch(() => {});
    return reservation;
  }

  @Get()
  async findAll(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
    @Query('date') date?: string,
  ) {
    const user = req.user;
    // Fetch fresh roles from DB to avoid stale JWT claims after role changes
    const dbUser = await this.usersService.findById(user.id);
    const roles: string[] = dbUser?.roles ?? user.roles ?? [];
    const isTicom = roles.includes('TICOM');
    // New specific groups + backward compat with old generic 'AYUDANTIA' role
    const isAyudantiaDiredtos = roles.includes('AYUDANTIADIREDTOS') || roles.includes('AYUDANTIA');
    const isAyudantiaRectorado = roles.includes('AYUDANTIARECTORADO');

    // Privileged users always get the full scoped view regardless of the `mine` param
    // (their JWT may be stale when roles were recently assigned).
    const isPrivileged = isTicom || isAyudantiaDiredtos || isAyudantiaRectorado;
    if (!isPrivileged) {
      return this.reservationsService.findAll({ creatorId: user.id, status, date });
    }
    if (isTicom) {
      return this.reservationsService.findAll({ status, date });
    }
    if (isAyudantiaRectorado && !isAyudantiaDiredtos) {
      return this.reservationsService.findAll({ status, date, location: 'piso_6' });
    }
    // AYUDANTIADIREDTOS (or legacy AYUDANTIA) → piso_8
    return this.reservationsService.findAll({ status, date, location: 'piso_8' });
  }

  @Get('availability')
  async checkAvailability(@Query('date') date: string) {
    if (!date) {
      throw new BadRequestException('Parámetros incompletos');
    }
    return this.reservationsService.findByDate(date, true);
  }

  @Get('blocked-periods')
  async getBlockedPeriods(@Query('date') date?: string, @Query('location') location?: string) {
    if (date) return this.blockedPeriodsService.findByDate(date, location);
    return this.blockedPeriodsService.findAll(location);
  }

  @Post('blocked-periods')
  async createBlockedPeriod(@Body() body: any, @Req() req: any) {
    const { date, startTime, endTime, reason } = body;
    if (!date || !startTime || !endTime || !reason?.trim()) {
      throw new BadRequestException('Todos los campos son obligatorios');
    }
    const user = req.user;
    const dbUser = await this.usersService.findById(user.id);
    const roles: string[] = dbUser?.roles ?? user.roles ?? [];
    const isAyudantiaDiredtos = roles.includes('AYUDANTIADIREDTOS') || roles.includes('AYUDANTIA');
    const isAyudantiaRectorado = roles.includes('AYUDANTIARECTORADO');
    if (!isAyudantiaDiredtos && !isAyudantiaRectorado) {
      throw new ForbiddenException('No tienes permisos para bloquear horarios');
    }
    const location: 'piso_8' | 'piso_6' = isAyudantiaDiredtos ? 'piso_8' : 'piso_6';
    const group = isAyudantiaDiredtos ? 'AYUDANTIADIREDTOS' : 'AYUDANTIARECTORADO';
    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username;
    return this.blockedPeriodsService.create({
      date,
      startTime,
      endTime,
      location,
      reason: reason.trim(),
      createdById: user.id,
      createdByName: userName,
      createdByGroup: group,
    });
  }

  @Delete('blocked-periods/:blockId')
  async deleteBlockedPeriod(@Param('blockId') blockId: string, @Req() req: any) {
    const user = req.user;
    const dbUser = await this.usersService.findById(user.id);
    const roles: string[] = dbUser?.roles ?? user.roles ?? [];
    const isAyudantiaDiredtos = roles.includes('AYUDANTIADIREDTOS') || roles.includes('AYUDANTIA');
    const isAyudantiaRectorado = roles.includes('AYUDANTIARECTORADO');
    if (!isAyudantiaDiredtos && !isAyudantiaRectorado) throw new ForbiddenException('No tienes permisos');
    const group = isAyudantiaDiredtos ? 'AYUDANTIADIREDTOS' : 'AYUDANTIARECTORADO';
    await this.blockedPeriodsService.delete(blockId, user.id, group);
    return { ok: true };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const reservation = await this.reservationsService.findById(id);
    if (!reservation) throw new NotFoundException('Reserva no encontrada');
    return reservation;
  }

  /** AYUDANTIADIREDTOS (piso_8) or AYUDANTIARECTORADO (piso_6) approves a reservation */
  @Patch(':id/approve')
  async approve(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    const dbUser = await this.usersService.findById(user.id);
    const roles: string[] = dbUser?.roles ?? user.roles ?? [];
    const isAyudantiaDiredtos = roles.includes('AYUDANTIADIREDTOS') || roles.includes('AYUDANTIA');
    const isAyudantiaRectorado = roles.includes('AYUDANTIARECTORADO');

    if (!isAyudantiaDiredtos && !isAyudantiaRectorado) {
      throw new ForbiddenException('No tienes permisos para aprobar reservas');
    }

    const group = roles.includes('AYUDANTIARECTORADO') ? 'AYUDANTIARECTORADO' : 'AYUDANTIADIREDTOS';
    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username;

    const reservation = await this.reservationsService.approveByAyudantia(id, user.id, userName, group);
    this.reservationsGateway.notifyReservationUpdate(reservation);
    this.reservationsEmailService.sendApprovalToCreator(reservation).catch(() => {});
    this.reservationsEmailService.sendNewReservationToTicom(reservation).catch(() => {});
    return reservation;
  }

  /** AYUDANTIADIREDTOS (piso_8) or AYUDANTIARECTORADO (piso_6) rejects a reservation */
  @Patch(':id/reject')
  async reject(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const { reason } = body;
    if (!reason?.trim()) {
      throw new BadRequestException('Debes indicar el motivo del rechazo');
    }

    const user = req.user;
    const dbUser = await this.usersService.findById(user.id);
    const roles: string[] = dbUser?.roles ?? user.roles ?? [];
    const isAyudantiaDiredtos = roles.includes('AYUDANTIADIREDTOS') || roles.includes('AYUDANTIA');
    const isAyudantiaRectorado = roles.includes('AYUDANTIARECTORADO');

    if (!isAyudantiaDiredtos && !isAyudantiaRectorado) {
      throw new ForbiddenException('No tienes permisos para rechazar reservas');
    }

    const group = roles.includes('AYUDANTIARECTORADO') ? 'AYUDANTIARECTORADO' : 'AYUDANTIADIREDTOS';
    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username;

    const reservation = await this.reservationsService.rejectByAyudantia(id, user.id, userName, group, reason.trim());
    this.reservationsGateway.notifyReservationUpdate(reservation);
    this.reservationsEmailService.sendRejectionToCreator(reservation).catch(() => {});
    return reservation;
  }

  /** TICOM confirms a reservation already approved by AYUDANTIA */
  @Patch(':id/confirm')
  @Roles('TICOM')
  async confirm(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username;
    const reservation = await this.reservationsService.confirmByTicom(id, user.id, userName);
    this.reservationsGateway.notifyReservationUpdate(reservation);
    this.reservationsEmailService.sendTicomConfirmationToCreator(reservation).catch(() => {});
    return reservation;
  }

  /** TICOM definitively cancels a pendiente_ticom reservation (equipment failure / technical issue) */
  @Patch(':id/ticom-cancel')
  @Roles('TICOM')
  async ticomCancel(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const { reason } = body;
    if (!reason?.trim()) {
      throw new BadRequestException('Debes indicar el motivo de la cancelación');
    }
    const user = req.user;
    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username;
    const reservation = await this.reservationsService.cancelByTicom(id, user.id, userName, reason.trim());
    this.reservationsGateway.notifyReservationUpdate(reservation);
    this.reservationsEmailService.sendTicomCancellation(reservation).catch(() => {});
    return reservation;
  }

  /** Creator cancels their own reservation — frees the slot */
  @Patch(':id/cancel')
  async cancelByCreator(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    const reservation = await this.reservationsService.cancelByCreator(id, user.id);
    this.reservationsGateway.notifyReservationUpdate(reservation);
    return reservation;
  }

  /** Creator edits a rejected reservation — resets workflow to pendiente_ayudantia */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const { date, startTime, durationHours, location, equipmentType, conferenceUrl } = body;
    const user = req.user;

    const reservation = await this.reservationsService.updateByCreator(id, user.id, {
      date,
      startTime,
      durationHours: durationHours ? Number(durationHours) : undefined,
      location,
      equipmentType,
      conferenceUrl: conferenceUrl?.trim() || undefined,
    });

    this.reservationsGateway.notifyReservationUpdate(reservation);
    this.reservationsEmailService.sendConfirmationToCreator(reservation).catch(() => {});
    this.reservationsEmailService.sendNewReservationToAyudantia(reservation).catch(() => {});
    return reservation;
  }
}
