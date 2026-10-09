import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Email } from './email.entity';

/** Índice de trigramas que crea MailService a mano: que la sincronización de TypeORM no lo borre. */
@Index('idx_attachments_filename_trgm', { synchronize: false })
@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Email, { onDelete: 'CASCADE' })
  email: Email;

  @Index('idx_attachments_email_id')
  @Column()
  emailId: string;

  @Column()
  filename: string;

  @Column()
  contentType: string;

  @Column()
  size: number;

  @Column()
  storagePath: string;

  @CreateDateColumn()
  createdAt: Date;
}
