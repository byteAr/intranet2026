import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Email } from './email.entity';

@Entity('siena_files')
export class SienaFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Email, { onDelete: 'CASCADE' })
  email: Email;

  @Index('idx_siena_files_email_id')
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

  @Column()
  uploadedById: string;

  @Column()
  uploadedByName: string;

  @CreateDateColumn({ type: 'timestamptz' })
  uploadedAt: Date;
}
