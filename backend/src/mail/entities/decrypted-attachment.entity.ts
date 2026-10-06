import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Attachment } from './attachment.entity';

/**
 * Versión desencriptada de un adjunto .~NN, subida por TICOM. Puede haber varias
 * por adjunto (desde la 1.5.2): un .rar encriptado trae varios documentos.
 */
@Entity('decrypted_attachments')
export class DecryptedAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Attachment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attachmentId' })
  attachment: Attachment;

  @Index()
  @Column()
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
