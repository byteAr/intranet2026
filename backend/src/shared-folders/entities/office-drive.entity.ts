import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, ValueTransformer } from 'typeorm';

/** Postgres devuelve los bigint como texto. */
const bigintNumber: ValueTransformer = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null || v === undefined ? null : Number(v)),
};

/**
 * Un espacio de archivos:
 *  - office: la unidad compartida de Google Drive de una oficina (grupo AD
 *    con category='oficina'); driveId es el id de la unidad.
 *  - personal: "Mis archivos" de un usuario, una carpeta en su propio Drive
 *    ("Mi unidad"); driveId es el id de esa carpeta, groupName '@usuario' y
 *    ownerEmail su cuenta. No cuenta para el espacio de la oficina.
 */
@Entity('office_drives')
export class OfficeDrive {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', default: 'office' })
  kind: 'office' | 'personal';

  @Column({ unique: true })
  groupName: string;

  @Column()
  driveId: string;

  /** Solo en los personales: la cuenta de Google dueña de la carpeta. */
  @Column({ type: 'varchar', nullable: true })
  ownerEmail: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastSyncError: string | null;

  /** Espacio fijado por TICOM; null = automático según los integrantes. */
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

  /** Integrantes habilitados del grupo en el AD, según la última sincronización. */
  @Column({ type: 'integer', default: 0 })
  memberCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
