import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('non_working_days')
@Index(['date'], { unique: true })
export class NonWorkingDay {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: string; // YYYY-MM-DD

  @Column({ default: 'auto' })
  reason: string; // 'auto' | 'manual' | holiday name
}
