import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('active_situations')
@Index(['username'], { unique: true })
export class ActiveSituation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  username: string;

  @Column()
  officeGroup: string;

  @Column()
  situationTypeCode: string;

  @Column({ type: 'date' })
  fromDate: string; // YYYY-MM-DD

  @Column({ type: 'date', nullable: true })
  toDate: string | null; // null = open-ended (illness, etc.)

  // For AUTORIZADO
  @Column({ type: 'varchar', nullable: true })
  authorizedBy: string | null;

  @Column({ type: 'int', nullable: true })
  authorizedDays: number | null;

  @Column({ default: false })
  authorizedChargedToLao: boolean;

  // For TURNO
  @Column({ type: 'varchar', nullable: true })
  shiftType: string | null;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
