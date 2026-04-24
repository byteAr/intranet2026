import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Attachment } from './attachment.entity';

@Entity('decrypted_attachments')
export class DecryptedAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Attachment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attachmentId' })
  attachment: Attachment;

  @Column({ unique: true })
  attachmentId: string;

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
