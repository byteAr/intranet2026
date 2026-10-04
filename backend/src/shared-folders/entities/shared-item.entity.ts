import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ShareRole = 'reader' | 'writer';

/**
 * Archivo o carpeta de una unidad de oficina compartido con un usuario de la
 * intranet. Es un permiso de la intranet, no de Drive: quien lo recibe accede
 * a través de la intranet aunque no tenga cuenta de Google.
 */
@Entity('shared_items')
@Index(['fileId', 'sharedWith'], { unique: true })
export class SharedItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  driveId: string;

  @Column()
  groupName: string;

  @Column()
  fileId: string;

  /** Nombre al momento de compartir; la lista usa el nombre actual de Drive. */
  @Column()
  fileName: string;

  @Column({ default: false })
  isFolder: boolean;

  /** Usuario que lo recibe (sAMAccountName en minúsculas). */
  @Column()
  sharedWith: string;

  @Column({ type: 'varchar', nullable: true })
  sharedWithName: string | null;

  @Column()
  sharedBy: string;

  @Column()
  sharedByName: string;

  @Column({ type: 'varchar', default: 'reader' })
  role: ShareRole;

  /** Cuándo lo vio quien lo recibe; null = cuenta para el badge. */
  @Column({ type: 'timestamp', nullable: true })
  seenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
