import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type NotificationType = 'announcement' | 'share' | 'upload';

/** Notificación de la campanita: una fila por destinatario. */
@Entity('notifications')
@Index(['username', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Destinatario (sAMAccountName en minúsculas). */
  @Column()
  username: string;

  @Column({ type: 'varchar' })
  type: NotificationType;

  @Column()
  title: string;

  @Column({ type: 'text' })
  body: string;

  /** Lo necesario para abrirla: el anuncio completo o el id de lo compartido. */
  @Column({ type: 'jsonb', default: {} })
  data: Record<string, unknown>;

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
