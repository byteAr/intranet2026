import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reservation } from './entities/reservation.entity';

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
      status: 'pendiente',
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

  /** Returns all reservations for a given date (equipment is shared across rooms) */
  async findByDate(date: string): Promise<Reservation[]> {
    return this.reservationRepo.find({
      where: { date },
      order: { startTime: 'ASC' },
    });
  }

  async acknowledge(
    reservationId: string,
    technicianId: string,
    technicianName: string,
  ): Promise<Reservation> {
    const result = await this.reservationRepo
      .createQueryBuilder()
      .update(Reservation)
      .set({
        status: 'recibida',
        technicianId,
        technicianName,
        acknowledgedAt: new Date(),
      })
      .where('id = :id AND status = :status', {
        id: reservationId,
        status: 'pendiente',
      })
      .execute();

    if (result.affected === 0) {
      throw new ConflictException('Esta reserva ya fue recibida por otro técnico');
    }
    return this.findById(reservationId) as Promise<Reservation>;
  }

  /**
   * Equipment is shared between rooms. Notebook is always used (equipo_completo includes notebook).
   * 30-minute buffer required when consecutive reservations are in different rooms.
   */
  private async checkAvailability(
    date: string,
    startTime: string,
    endTime: string,
    location: string,
  ): Promise<boolean> {
    // Expand search window by 30 min on each side to catch cross-location buffer conflicts
    const searchStart = this.addMinutes(startTime, -30);
    const searchEnd = this.addMinutes(endTime, 30);

    const nearby = await this.reservationRepo
      .createQueryBuilder('r')
      .where('r.date = :date', { date })
      .andWhere('r.startTime < :searchEnd', { searchEnd })
      .andWhere('r.endTime > :searchStart', { searchStart })
      .getMany();

    for (const r of nearby) {
      if (r.location === location) {
        // Same room: direct time overlap
        if (r.startTime < endTime && r.endTime > startTime) return false;
      } else {
        // Different room: need 30-min buffer for equipment transport
        const rEndPlus30 = this.addMinutes(r.endTime, 30);
        const endTimePlus30 = this.addMinutes(endTime, 30);
        if (r.startTime < endTimePlus30 && rEndPlus30 > startTime) return false;
      }
    }
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
