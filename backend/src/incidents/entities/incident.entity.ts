import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('incidents')
@Index(['status', 'createdAt'])
@Index(['creatorId', 'createdAt'])
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  creatorId: string;

  @Column()
  creatorName: string;

  @Column({ type: 'text', nullable: true })
  creatorAvatar?: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  attachmentUrl?: string;

  @Column({ nullable: true })
  attachmentName?: string;

  @Column({ type: 'integer', nullable: true })
  attachmentSize?: number;

  @Column({ nullable: true })
  attachmentMimeType?: string;

  @Column({ type: 'varchar', default: 'pendiente' })
  status: 'pendiente' | 'en_proceso' | 'finalizada';

  @Column({ nullable: true })
  technicianId?: string;

  @Column({ nullable: true })
  technicianName?: string;

  @Column({ type: 'timestamp', nullable: true })
  assignedAt?: Date;

  @Column({ type: 'text', nullable: true })
  resolution?: string;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
