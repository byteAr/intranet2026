import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Req,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsGateway } from './reservations.gateway';
import { ReservationsEmailService } from './reservations-email.service';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly reservationsGateway: ReservationsGateway,
    private readonly reservationsEmailService: ReservationsEmailService,
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
    this.reservationsEmailService.sendNewReservationToTicom(reservation).catch(() => {});
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
    const isTicom = user.roles?.includes('TICOM');
    const isAyudantia = user.roles?.includes('AYUDANTIA');

    if (mine === 'true' || (!isTicom && !isAyudantia)) {
      return this.reservationsService.findAll({ creatorId: user.id, status, date });
    }
    if (isAyudantia && !isTicom) {
      // AYUDANTIA only sees piso_8 reservations
      return this.reservationsService.findAll({ status, date, location: 'piso_8' });
    }
    // TICOM sees all
    return this.reservationsService.findAll({ status, date });
  }

  @Get('availability')
  async checkAvailability(
    @Query('date') date: string,
  ) {
    if (!date) {
      throw new BadRequestException('Parámetros incompletos');
    }
    // Return all reservations for this date (equipment is shared across rooms)
    return this.reservationsService.findByDate(date);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const reservation = await this.reservationsService.findById(id);
    if (!reservation) throw new NotFoundException('Reserva no encontrada');
    return reservation;
  }

  @Patch(':id/acknowledge')
  @Roles('TICOM')
  async acknowledge(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    const techName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username;
    const reservation = await this.reservationsService.acknowledge(id, user.id, techName);
    this.reservationsGateway.notifyReservationUpdate(reservation);
    this.reservationsEmailService.sendAcknowledgementToCreator(reservation).catch(() => {});
    return reservation;
  }
}
