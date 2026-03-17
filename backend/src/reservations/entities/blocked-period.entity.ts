import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('blocked_periods')
@Index(['date', 'location'])
export class BlockedPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  @Column({ type: 'varchar' })
  location: 'piso_8' | 'piso_6';

  @Column({ type: 'text' })
  reason: string;

  @Column()
  createdById: string;

  @Column()
  createdByName: string;

  @Column()
  createdByGroup: string;

  @CreateDateColumn()
  createdAt: Date;
}
