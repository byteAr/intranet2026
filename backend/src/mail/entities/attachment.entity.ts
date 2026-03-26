import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Email } from './email.entity';

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
