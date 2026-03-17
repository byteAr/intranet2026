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

  /**
   * pendiente_ayudantia → pendiente_ticom → confirmada
   * pendiente_ayudantia → rechazada        (creator can edit → pendiente_ayudantia again)
   * pendiente_ticom     → cancelada        (TICOM cancels definitively — no re-activation)
   */
  @Column({ type: 'varchar', default: 'pendiente_ayudantia' })
  status: 'pendiente_ayudantia' | 'pendiente_ticom' | 'confirmada' | 'rechazada' | 'cancelada';

  // Ayudantia approval fields
  @Column({ nullable: true })
  ayudantiaApprovedById?: string;

  @Column({ nullable: true })
  ayudantiaApprovedByName?: string;

  @Column({ nullable: true })
  ayudantiaApprovedByGroup?: string;

  @Column({ type: 'timestamp', nullable: true })
  ayudantiaApprovedAt?: Date;

  // Rejection fields
  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ nullable: true })
  rejectedById?: string;

  @Column({ nullable: true })
  rejectedByName?: string;

  @Column({ nullable: true })
  rejectedByGroup?: string;

  @Column({ type: 'timestamp', nullable: true })
  rejectedAt?: Date;

  // TICOM confirmation fields
  @Column({ nullable: true })
  ticomConfirmedById?: string;

  @Column({ nullable: true })
  ticomConfirmedByName?: string;

  @Column({ type: 'timestamp', nullable: true })
  ticomConfirmedAt?: Date;

  // Creator self-cancellation
  @Column({ type: 'timestamp', nullable: true })
  creatorCancelledAt?: Date;

  // TICOM cancellation fields (definitive — no re-activation)
  @Column({ type: 'text', nullable: true })
  ticomCancellationReason?: string;

  @Column({ nullable: true })
  ticomCancelledById?: string;

  @Column({ nullable: true })
  ticomCancelledByName?: string;

  @Column({ type: 'timestamp', nullable: true })
  ticomCancelledAt?: Date;

  // Block cancellation fields (cancelled because a period was blocked by AYUDANTIA)
  @Column({ type: 'text', nullable: true })
  blockCancellationReason?: string;

  @Column({ nullable: true })
  blockCancelledById?: string;

  @Column({ nullable: true })
  blockCancelledByName?: string;

  @Column({ nullable: true })
  blockCancelledByGroup?: string;

  @Column({ type: 'timestamp', nullable: true })
  blockCancelledAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
