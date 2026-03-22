import { Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident, IncidentEvent } from './entities/incident.entity';
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
      history: [this.evt('creada', dto.creatorName)],
    });
    return this.incidentRepo.save(incident);
  }

  private evt(type: IncidentEvent['type'], byName?: string, detail?: string): IncidentEvent {
    return { type, at: new Date().toISOString(), byName, detail };
  }

  private pushHistory(incident: Incident, type: IncidentEvent['type'], byName?: string, detail?: string): void {
    incident.history = [...(incident.history ?? []), this.evt(type, byName, detail)];
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
    const incident = await this.findById(incidentId);
    if (!incident) throw new ConflictException('Incidencia no encontrada');
    if (incident.status !== 'pendiente') {
      throw new ConflictException('Esta incidencia ya fue tomada por otro técnico');
    }
    incident.status = 'en_proceso';
    incident.technicianId = technicianId;
    incident.technicianName = technicianName;
    incident.assignedAt = new Date();
    this.pushHistory(incident, 'tomada', technicianName);
    return this.incidentRepo.save(incident);
  }

  async resolve(
    incidentId: string,
    technicianId: string,
    resolution: string,
  ): Promise<Incident> {
    const incident = await this.findById(incidentId);
    if (!incident) throw new ConflictException('Incidencia no encontrada');
    if (incident.status !== 'en_proceso' && incident.status !== 'en_espera') {
      throw new ConflictException(
        'Solo se pueden finalizar incidencias en proceso o en espera',
      );
    }
    incident.status = 'finalizada';
    incident.resolution = resolution;
    incident.resolvedAt = new Date();
    this.pushHistory(incident, 'finalizada', incident.technicianName, resolution);
    return this.incidentRepo.save(incident);
  }

  async putOnHold(
    incidentId: string,
    technicianId: string,
    waitingReason: string,
  ): Promise<Incident> {
    const incident = await this.findById(incidentId);
    if (!incident) throw new ConflictException('Incidencia no encontrada');
    if (incident.status !== 'en_proceso') {
      throw new ConflictException(
        'Solo se pueden poner en espera incidencias en proceso',
      );
    }
    incident.status = 'en_espera';
    incident.waitingReason = waitingReason;
    incident.waitingSince = new Date();
    this.pushHistory(incident, 'en_espera', incident.technicianName, waitingReason);
    return this.incidentRepo.save(incident);
  }

  async reactivate(
    incidentId: string,
    technicianId: string,
  ): Promise<Incident> {
    const incident = await this.findById(incidentId);
    if (!incident) throw new ConflictException('Incidencia no encontrada');
    if (incident.status !== 'en_espera') {
      throw new ConflictException(
        'Solo se pueden reactivar incidencias en espera',
      );
    }
    incident.status = 'en_proceso';
    incident.waitingReason = undefined;
    incident.waitingSince = undefined;
    this.pushHistory(incident, 'reactivada', incident.technicianName);
    return this.incidentRepo.save(incident);
  }

  async closeUnresolved(
    incidentId: string,
    technicianId: string,
    technicianName: string,
    unresolvedReason: string,
  ): Promise<Incident> {
    const incident = await this.findById(incidentId);
    if (!incident) throw new ConflictException('Incidencia no encontrada');
    if (incident.status !== 'en_proceso' && incident.status !== 'en_espera') {
      throw new ConflictException(
        'Solo se pueden cerrar incidencias en proceso o en espera',
      );
    }
    incident.status = 'no_resuelta';
    incident.unresolvedReason = unresolvedReason;
    incident.unresolvedAt = new Date();
    incident.unresolvedById = technicianId;
    incident.unresolvedByName = technicianName;
    this.pushHistory(incident, 'sin_solucion', technicianName, unresolvedReason);
    return this.incidentRepo.save(incident);
  }

  async findTicomUserIds(): Promise<string[]> {
    const users = await this.usersService.findByRoleContaining('TICOM');
    return users.map((u) => u.id);
  }
}
