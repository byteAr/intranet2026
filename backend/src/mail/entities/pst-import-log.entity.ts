import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PstImportStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('pst_import_logs')
export class PstImportLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  filename: string;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date;

  @Column({ type: 'enum', enum: PstImportStatus, default: PstImportStatus.RUNNING })
  status: PstImportStatus;

  @Column({ default: 0 })
  totalProcessed: number;

  @Column({ default: 0 })
  inserted: number;

  @Column({ default: 0 })
  skippedDuplicates: number;

  @Column({ default: 0 })
  referencesResolved: number;

  @Column({ default: 0 })
  attachmentsSaved: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'text', nullable: true })
  importedBy: string;

  /**
   * Latido mientras corre (cada minuto): si deja de moverse, el backend que la
   * hacía se reinició o se cayó y la importación se marca como fallida en vez
   * de quedar "en curso" para siempre (Año 2016.pst estuvo así desde abril).
   */
  @UpdateDateColumn({ type: 'timestamptz', nullable: true })
  updatedAt: Date;
}
