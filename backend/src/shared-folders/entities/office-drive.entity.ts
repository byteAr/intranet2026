import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, ValueTransformer } from 'typeorm';

/** Postgres devuelve los bigint como texto. */
const bigintNumber: ValueTransformer = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null || v === undefined ? null : Number(v)),
};

/** Unidad compartida de Google Drive de una oficina (grupo AD con category='oficina'). */
@Entity('office_drives')
export class OfficeDrive {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  groupName: string;

  @Column()
  driveId: string;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastSyncError: string | null;

  /** Espacio asignado; null = el de SHARED_FOLDERS_QUOTA_GB. */
  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber })
  quotaBytes: number | null;

  /** Lo que ocupa la unidad para Google, papelera incluida. */
  @Column({ type: 'bigint', default: 0, transformer: bigintNumber })
  usedBytes: number;

  /** La parte de usedBytes que está en la papelera de Drive. */
  @Column({ type: 'bigint', default: 0, transformer: bigintNumber })
  trashedBytes: number;

  @Column({ type: 'timestamp', nullable: true })
  usageAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
