import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DraftEmail } from './draft-email.entity';

@Entity('draft_email_attachments')
export class DraftEmailAttachment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() draftEmailId: string;
  @ManyToOne(() => DraftEmail, (d) => d.attachments, { onDelete: 'CASCADE' })
  draftEmail: DraftEmail;
  @Column() filename: string;
  @Column() contentType: string;
  @Column('int') size: number;
  @Column() storagePath: string;
  @CreateDateColumn() createdAt: Date;
}
