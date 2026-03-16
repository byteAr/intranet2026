import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('reservations')
@Index(['date', 'startTime', 'endTime'])
@Index(['status', 'date'])
@Index(['creatorId', 'date'])
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  creatorId: string;

  @Column()
  creatorName: string;

  @Column({ type: 'text', nullable: true })
  creatorAvatar?: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  @Column({ type: 'decimal', precision: 3, scale: 1 })
  durationHours: number;

  @Column({ type: 'varchar' })
  location: 'piso_8' | 'piso_6';

  @Column({ type: 'varchar' })
  equipmentType: 'notebook' | 'equipo_completo';

  @Column({ type: 'text', nullable: true })
  conferenceUrl?: string;

  @Column({ type: 'varchar', default: 'pendiente' })
  status: 'pendiente' | 'recibida';

  @Column({ nullable: true })
  technicianId?: string;

  @Column({ nullable: true })
  technicianName?: string;

  @Column({ type: 'timestamp', nullable: true })
  acknowledgedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
