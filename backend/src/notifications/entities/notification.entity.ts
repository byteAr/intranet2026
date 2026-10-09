import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** mto: un MTO seguido o que coincide con "Mis alertas" (MailAlertsService). */
export type NotificationType = 'announcement' | 'share' | 'upload' | 'scan' | 'mto';

/** Notificación de la campanita: una fila por destinatario. */
@Entity('notifications')
@Index(['username', 'createdAt'])
// El que crea NotificationsService a mano (staging no sincroniza): que TypeORM no lo borre.
@Index('idx_notifications_user_date', { synchronize: false })
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
