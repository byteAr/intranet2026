import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DailyReport } from './daily-report.entity';

export type RankCategory =
  | 'of_sup'
  | 'of_jef'
  | 'of_sub'
  | 'subof_sup'
  | 'subof_sub'
  | 'tropa'
  | 'civil';

@Entity('daily_report_entries')
export class DailyReportEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => DailyReport, (report) => report.entries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'dailyReportId' })
  dailyReport: DailyReport;

  @Column()
  dailyReportId: number;

  @Column()
  username: string; // AD username

  @Column()
  fullName: string; // Nombre y Apellido (snapshot)

  @Column()
  rank: string; // e.g. 'CTE', 'SARG', 'GEND II'

  @Column()
  rankCategory: RankCategory; // for sorting/grouping

  @Column()
  situationTypeCode: string; // FK via code for flexibility

  @Column({ type: 'date', nullable: true })
  situationFromDate: string | null; // YYYY-MM-DD

  @Column({ type: 'date', nullable: true })
  situationToDate: string | null; // YYYY-MM-DD

  // For AUTORIZADO
  @Column({ nullable: true })
  authorizedBy: string | null;

  @Column({ nullable: true })
  authorizedDays: number | null;

  @Column({ default: false })
  authorizedChargedToLao: boolean;

  // For TURNO
  @Column({ nullable: true })
  shiftType: string | null; // 'mañana' | 'tarde' | null

  @Column({ nullable: true })
  notes: string | null;

  @Column({ default: 0 })
  sortOrder: number; // based on rank hierarchy
}
