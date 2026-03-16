import { Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident } from './entities/incident.entity';
import { UsersService } from '../users/users.service';

export interface CreateIncidentDto {
  creatorId: string;
  creatorName: string;
  creatorAvatar?: string;
  description: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  attachmentMimeType?: string;
}

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidentRepo: Repository<Incident>,
    private readonly usersService: UsersService,
  ) {}

  async create(dto: CreateIncidentDto): Promise<Incident> {
    const incident = this.incidentRepo.create({
      ...dto,
      status: 'pendiente',
    });
    return this.incidentRepo.save(incident);
  }

  async findAll(filters?: {
    status?: string;
    creatorId?: string;
  }): Promise<Incident[]> {
    const qb = this.incidentRepo.createQueryBuilder('i');
    if (filters?.status) {
      qb.andWhere('i.status = :status', { status: filters.status });
    }
    if (filters?.creatorId) {
      qb.andWhere('i.creatorId = :creatorId', { creatorId: filters.creatorId });
    }
    return qb.orderBy('i.createdAt', 'DESC').getMany();
  }

  async findById(id: string): Promise<Incident | null> {
    return this.incidentRepo.findOne({ where: { id } });
  }

  async assign(
    incidentId: string,
    technicianId: string,
    technicianName: string,
  ): Promise<Incident> {
    const result = await this.incidentRepo
      .createQueryBuilder()
      .update(Incident)
      .set({
        status: 'en_proceso',
        technicianId,
        technicianName,
        assignedAt: new Date(),
      })
      .where('id = :id AND status = :status', {
        id: incidentId,
        status: 'pendiente',
      })
      .execute();

    if (result.affected === 0) {
      throw new ConflictException(
        'Esta incidencia ya fue tomada por otro técnico',
      );
    }
    return this.findById(incidentId) as Promise<Incident>;
  }

  async resolve(
    incidentId: string,
    technicianId: string,
    resolution: string,
  ): Promise<Incident> {
    const incident = await this.findById(incidentId);
    if (!incident) throw new ConflictException('Incidencia no encontrada');
    if (incident.technicianId !== technicianId) {
      throw new ForbiddenException(
        'Solo el técnico asignado puede finalizar esta incidencia',
      );
    }
    if (incident.status !== 'en_proceso') {
      throw new ConflictException(
        'Solo se pueden finalizar incidencias en proceso',
      );
    }
    incident.status = 'finalizada';
    incident.resolution = resolution;
    incident.resolvedAt = new Date();
    return this.incidentRepo.save(incident);
  }

  async findTicomUserIds(): Promise<string[]> {
    const users = await this.usersService.findByRoleContaining('TICOM');
    return users.map((u) => u.id);
  }
}
