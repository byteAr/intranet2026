import { Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reservation } from './entities/reservation.entity';
import { BlockedPeriod } from './entities/blocked-period.entity';

export interface CreateReservationDto {
  creatorId: string;
  creatorName: string;
  creatorAvatar?: string;
  date: string;
  startTime: string;
  durationHours: number;
  location: 'piso_8' | 'piso_6';
  equipmentType: 'notebook' | 'equipo_completo';
  conferenceUrl?: string;
}

@Injectable()
export class ReservationsService {
  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    @InjectRepository(BlockedPeriod)
    private readonly blockedPeriodRepo: Repository<BlockedPeriod>,
  ) {}

  async create(dto: CreateReservationDto): Promise<Reservation> {
    const endTime = this.computeEndTime(dto.startTime, dto.durationHours);

    const available = await this.checkAvailability(
      dto.date,
      dto.startTime,
      endTime,
      dto.location,
    );
    if (!available) {
      throw new ConflictException(
        'El horario no está disponible (equipo compartido entre salas, 30 min de margen entre pisos)',
      );
    }

    const reservation = this.reservationRepo.create({
      ...dto,
      endTime,
      status: 'pendiente_ayudantia',
    });
    return this.reservationRepo.save(reservation);
  }

  async findAll(filters?: {
    status?: string;
    creatorId?: string;
    date?: string;
    location?: string;
  }): Promise<Reservation[]> {
    const qb = this.reservationRepo.createQueryBuilder('r');
    if (filters?.status) {
      qb.andWhere('r.status = :status', { status: filters.status });
    }
    if (filters?.creatorId) {
      qb.andWhere('r.creatorId = :creatorId', { creatorId: filters.creatorId });
    }
    if (filters?.date) {
      qb.andWhere('r.date = :date', { date: filters.date });
    }
    if (filters?.location) {
      qb.andWhere('r.location = :location', { location: filters.location });
    }
    return qb.orderBy('r.date', 'DESC').addOrderBy('r.startTime', 'ASC').getMany();
  }

  async findById(id: string): Promise<Reservation | null> {
    return this.reservationRepo.findOne({ where: { id } });
  }

  /** Returns reservations for a given date. When forAvailability=true, excludes rejected ones. */
  async findByDate(date: string, forAvailability = false): Promise<Reservation[]> {
    const qb = this.reservationRepo
      .createQueryBuilder('r')
      .where('r.date = :date', { date })
      .orderBy('r.startTime', 'ASC');

    if (forAvailability) {
      qb.andWhere('r.status NOT IN (:...excluded)', { excluded: ['rechazada', 'cancelada'] });
    }

    return qb.getMany();
  }

  /** AYUDANTIADIREDTOS (piso_8) or AYUDANTIARECTORADO (piso_6) approves a pending reservation */
  async approveByAyudantia(
    reservationId: string,
    userId: string,
    userName: string,
    group: string,
  ): Promise<Reservation> {
    const reservation = await this.reservationRepo.findOne({ where: { id: reservationId } });
    if (!reservation) throw new NotFoundException('Reserva no encontrada');

    if (reservation.status !== 'pendiente_ayudantia') {
      throw new ConflictException('Esta reserva no está pendiente de aprobación');
    }

    // Verify the group matches the reservation location
    if (reservation.location === 'piso_8' && group !== 'AYUDANTIADIREDTOS') {
      throw new ForbiddenException('Solo AYUDANTIADIREDTOS puede aprobar reservas del Piso 8');
    }
    if (reservation.location === 'piso_6' && group !== 'AYUDANTIARECTORADO') {
      throw new ForbiddenException('Solo AYUDANTIARECTORADO puede aprobar reservas del Piso 6');
    }

    const result = await this.reservationRepo
      .createQueryBuilder()
      .update(Reservation)
      .set({
        status: 'pendiente_ticom',
        ayudantiaApprovedById: userId,
        ayudantiaApprovedByName: userName,
        ayudantiaApprovedByGroup: group,
        ayudantiaApprovedAt: new Date(),
      })
      .where('id = :id AND status = :status', { id: reservationId, status: 'pendiente_ayudantia' })
      .execute();

    if (result.affected === 0) {
      throw new ConflictException('Esta reserva ya fue procesada por otro usuario');
    }
    return this.findById(reservationId) as Promise<Reservation>;
  }

  /** AYUDANTIADIREDTOS or AYUDANTIARECTORADO rejects a pending reservation */
  async rejectByAyudantia(
    reservationId: string,
    userId: string,
    userName: string,
    group: string,
    reason: string,
  ): Promise<Reservation> {
    const reservation = await this.reservationRepo.findOne({ where: { id: reservationId } });
    if (!reservation) throw new NotFoundException('Reserva no encontrada');

    if (reservation.status !== 'pendiente_ayudantia') {
      throw new ConflictException('Esta reserva no está pendiente de aprobación');
    }

    if (reservation.location === 'piso_8' && group !== 'AYUDANTIADIREDTOS') {
      throw new ForbiddenException('Solo AYUDANTIADIREDTOS puede rechazar reservas del Piso 8');
    }
    if (reservation.location === 'piso_6' && group !== 'AYUDANTIARECTORADO') {
      throw new ForbiddenException('Solo AYUDANTIARECTORADO puede rechazar reservas del Piso 6');
    }

    const result = await this.reservationRepo
      .createQueryBuilder()
      .update(Reservation)
      .set({
        status: 'rechazada',
        rejectionReason: reason,
        rejectedById: userId,
        rejectedByName: userName,
        rejectedByGroup: group,
        rejectedAt: new Date(),
      })
      .where('id = :id AND status = :status', { id: reservationId, status: 'pendiente_ayudantia' })
      .execute();

    if (result.affected === 0) {
      throw new ConflictException('Esta reserva ya fue procesada por otro usuario');
    }
    return this.findById(reservationId) as Promise<Reservation>;
  }

  /** TICOM confirms a reservation that was already approved by AYUDANTIA */
  async confirmByTicom(
    reservationId: string,
    userId: string,
    userName: string,
  ): Promise<Reservation> {
    const result = await this.reservationRepo
      .createQueryBuilder()
      .update(Reservation)
      .set({
        status: 'confirmada',
        ticomConfirmedById: userId,
        ticomConfirmedByName: userName,
        ticomConfirmedAt: new Date(),
      })
      .where('id = :id AND status = :status', { id: reservationId, status: 'pendiente_ticom' })
      .execute();

    if (result.affected === 0) {
      throw new ConflictException('Esta reserva no está pendiente de confirmación por TICOM');
    }
    return this.findById(reservationId) as Promise<Reservation>;
  }

  /** Creator cancels their own reservation (frees the slot for others) */
  async cancelByCreator(reservationId: string, creatorId: string): Promise<Reservation> {
    const reservation = await this.reservationRepo.findOne({
      where: { id: reservationId, creatorId },
    });
    if (!reservation) throw new NotFoundException('Reserva no encontrada');
    if (reservation.status === 'cancelada') {
      throw new ConflictException('Esta reserva ya está cancelada');
    }

    await this.reservationRepo.update(reservationId, {
      status: 'cancelada',
      creatorCancelledAt: new Date(),
    });
    return this.findById(reservationId) as Promise<Reservation>;
  }

  /** TICOM definitively cancels a pendiente_ticom or confirmada reservation — no re-activation possible */
  async cancelByTicom(
    reservationId: string,
    userId: string,
    userName: string,
    reason: string,
  ): Promise<Reservation> {
    const result = await this.reservationRepo
      .createQueryBuilder()
      .update(Reservation)
      .set({
        status: 'cancelada',
        ticomCancellationReason: reason,
        ticomCancelledById: userId,
        ticomCancelledByName: userName,
        ticomCancelledAt: new Date(),
      })
      .where('id = :id AND status IN (:...statuses)', {
        id: reservationId,
        statuses: ['pendiente_ticom', 'confirmada'],
      })
      .execute();

    if (result.affected === 0) {
      throw new ConflictException('Esta reserva no puede ser cancelada (solo pendiente_ticom o confirmada)');
    }
    return this.findById(reservationId) as Promise<Reservation>;
  }

  /** Creator edits a rejected reservation — resets workflow back to pendiente_ayudantia */
  async updateByCreator(
    reservationId: string,
    creatorId: string,
    dto: Partial<CreateReservationDto>,
  ): Promise<Reservation> {
    const reservation = await this.reservationRepo.findOne({
      where: { id: reservationId, creatorId },
    });
    if (!reservation) throw new NotFoundException('Reserva no encontrada');
    if (reservation.status !== 'rechazada') {
      throw new ForbiddenException('Solo puedes editar reservas rechazadas');
    }

    const newDate = dto.date ?? reservation.date;
    const newStartTime = dto.startTime ?? reservation.startTime;
    const newDurationHours = dto.durationHours ?? reservation.durationHours;
    const newLocation = (dto.location ?? reservation.location) as 'piso_8' | 'piso_6';
    const endTime = this.computeEndTime(newStartTime, newDurationHours);

    const available = await this.checkAvailability(newDate, newStartTime, endTime, newLocation, reservationId);
    if (!available) {
      throw new ConflictException(
        'El horario no está disponible (equipo compartido entre salas, 30 min de margen entre pisos)',
      );
    }

    await this.reservationRepo.update(reservationId, {
      date: newDate,
      startTime: newStartTime,
      durationHours: newDurationHours,
      location: newLocation,
      equipmentType: dto.equipmentType ?? reservation.equipmentType,
      conferenceUrl: dto.conferenceUrl !== undefined ? (dto.conferenceUrl || undefined) : reservation.conferenceUrl,
      endTime,
      status: 'pendiente_ayudantia',
      // Clear rejection fields
      rejectionReason: undefined,
      rejectedById: undefined,
      rejectedByName: undefined,
      rejectedByGroup: undefined,
      rejectedAt: undefined,
    });

    return this.findById(reservationId) as Promise<Reservation>;
  }

  /**
   * Equipment is shared between rooms. Notebook is always used (equipo_completo includes notebook).
   * 30-minute buffer required when consecutive reservations are in different rooms.
   * Excludes rejected reservations and optionally a specific reservation (for edits).
   */
  private async checkAvailability(
    date: string,
    startTime: string,
    endTime: string,
    location: string,
    excludeId?: string,
  ): Promise<boolean> {
    const searchStart = this.addMinutes(startTime, -30);
    const searchEnd = this.addMinutes(endTime, 30);

    let qb = this.reservationRepo
      .createQueryBuilder('r')
      .where('r.date = :date', { date })
      .andWhere('r.status NOT IN (:...excluded)', { excluded: ['rechazada', 'cancelada'] })
      .andWhere('r.startTime < :searchEnd', { searchEnd })
      .andWhere('r.endTime > :searchStart', { searchStart });

    if (excludeId) {
      qb = qb.andWhere('r.id != :excludeId', { excludeId });
    }

    const nearby = await qb.getMany();

    for (const r of nearby) {
      if (r.location === location) {
        if (r.startTime < endTime && r.endTime > startTime) return false;
      } else {
        const rEndPlus30 = this.addMinutes(r.endTime, 30);
        const endTimePlus30 = this.addMinutes(endTime, 30);
        if (r.startTime < endTimePlus30 && rEndPlus30 > startTime) return false;
      }
    }

    // Also check for blocked periods
    const block = await this.blockedPeriodRepo
      .createQueryBuilder('bp')
      .where('bp.date = :date', { date })
      .andWhere('bp.location = :location', { location })
      .andWhere('bp.startTime < :endTime', { endTime })
      .andWhere('bp.endTime > :startTime', { startTime })
      .getOne();
    if (block) return false;

    return true;
  }

  computeEndTime(startTime: string, durationHours: number): string {
    return this.addMinutes(startTime, durationHours * 60);
  }

  addMinutes(time: string, minutes: number): string {
    const [h, m] = time.split(':').map(Number);
    let total = h * 60 + m + minutes;
    if (total < 0) total = 0;
    const endH = Math.floor(total / 60) % 24;
    const endM = total % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  }
}
