import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { DailyReportEntry } from './daily-report-entry.entity';

@Entity('daily_reports')
@Index(['officeGroup', 'reportDate'], { unique: true })
export class DailyReport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  officeGroup: string; // AD group CN of the office (e.g. 'TICOM')

  @Column({ type: 'date' })
  reportDate: string; // YYYY-MM-DD

  @Column()
  createdBy: string; // username

  @Column({ default: false })
  isLocked: boolean; // true after 07:45 Argentina time

  @OneToMany(() => DailyReportEntry, (entry) => entry.dailyReport, {
    cascade: true,
    eager: true,
  })
  entries: DailyReportEntry[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
