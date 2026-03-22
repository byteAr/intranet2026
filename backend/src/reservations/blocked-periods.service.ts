import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockedPeriod } from './entities/blocked-period.entity';
import { Reservation } from './entities/reservation.entity';
import { ReservationsGateway } from './reservations.gateway';
import { ReservationsEmailService } from './reservations-email.service';

export interface CreateBlockedPeriodDto {
  date: string;
  startTime: string;
  endTime: string;
  location: 'piso_8' | 'piso_6';
  reason: string;
  createdById: string;
  createdByName: string;
  createdByGroup: string;
}

@Injectable()
export class BlockedPeriodsService {
  constructor(
    @InjectRepository(BlockedPeriod)
    private readonly blockedPeriodRepo: Repository<BlockedPeriod>,
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    private readonly gateway: ReservationsGateway,
    private readonly emailService: ReservationsEmailService,
  ) {}

  async create(dto: CreateBlockedPeriodDto): Promise<{ blockedPeriod: BlockedPeriod; cancelledCount: number }> {
    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException('La hora de inicio debe ser anterior a la hora de fin');
    }

    // Find active reservations that overlap the blocked period
    const overlapping = await this.reservationRepo
      .createQueryBuilder('r')
      .where('r.date = :date', { date: dto.date })
      .andWhere('r.location = :location', { location: dto.location })
      .andWhere('r.status NOT IN (:...excluded)', { excluded: ['rechazada', 'cancelada'] })
      .andWhere('r.startTime < :endTime', { endTime: dto.endTime })
      .andWhere('r.endTime > :startTime', { startTime: dto.startTime })
      .getMany();

    // Cancel each overlapping reservation
    for (const reservation of overlapping) {
      await this.reservationRepo.update(reservation.id, {
        status: 'cancelada',
        blockCancellationReason: dto.reason,
        blockCancelledById: dto.createdById,
        blockCancelledByName: dto.createdByName,
        blockCancelledByGroup: dto.createdByGroup,
        blockCancelledAt: new Date(),
      });
      const updated = await this.reservationRepo.findOne({ where: { id: reservation.id } });
      if (updated) {
        this.gateway.notifyReservationUpdate(updated);
        this.emailService.sendBlockedPeriodCancellationToCreator(updated).catch(() => {});
      }
    }

    const blockedPeriod = this.blockedPeriodRepo.create(dto);
    const saved = await this.blockedPeriodRepo.save(blockedPeriod);

    return { blockedPeriod: saved, cancelledCount: overlapping.length };
  }

  async findAll(location?: string): Promise<BlockedPeriod[]> {
    const qb = this.blockedPeriodRepo.createQueryBuilder('bp');
    if (location) {
      qb.where('bp.location = :location', { location });
    }
    return qb.orderBy('bp.date', 'DESC').addOrderBy('bp.startTime', 'ASC').getMany();
  }

  async findByDate(date: string, location?: string): Promise<BlockedPeriod[]> {
    const qb = this.blockedPeriodRepo
      .createQueryBuilder('bp')
      .where('bp.date = :date', { date });
    if (location) {
      qb.andWhere('bp.location = :location', { location });
    }
    return qb.orderBy('bp.startTime', 'ASC').getMany();
  }

  async delete(id: string, requesterId: string, requesterGroup: string): Promise<void> {
    const block = await this.blockedPeriodRepo.findOne({ where: { id } });
    if (!block) throw new NotFoundException('Bloqueo no encontrado');

    const expectedGroup =
      block.location === 'piso_8' ? 'AYUDANTIADIREDTOS' : 'AYUDANTIARECTORADO';
    if (requesterGroup !== expectedGroup) {
      throw new ForbiddenException('No tienes permisos para eliminar este bloqueo');
    }

    await this.blockedPeriodRepo.delete(id);
  }
}
