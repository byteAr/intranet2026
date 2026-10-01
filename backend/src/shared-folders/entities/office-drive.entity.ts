import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

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

  @CreateDateColumn()
  createdAt: Date;
}
