import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('mail_pending_sends')
export class MailPendingSend {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ID del email ya ingresado en DB (para actualizar internetMessageId luego) */
  @Column({ type: 'varchar', nullable: true })
  emailId: string | null;

  @Column()
  fromAddr: string;

  @Column('simple-json')
  to: string[];

  @Column('simple-json', { nullable: true })
  cc: string[] | null;

  @Column('simple-json', { nullable: true })
  bcc: string[] | null;

  @Column()
  subject: string;

  @Column('text')
  bodyText: string;

  @Column('text', { nullable: true })
  bodyHtml: string | null;

  /** Adjuntos codificados en base64 */
  @Column('simple-json', { nullable: true })
  attachments: Array<{ filename: string; contentType: string; base64: string }> | null;

  @Column({ default: 'pending' })
  status: string; // 'pending' | 'sent' | 'failed'

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  messageId: string | null;

  @Column({ type: 'varchar', nullable: true })
  errorMessage: string | null;
}
