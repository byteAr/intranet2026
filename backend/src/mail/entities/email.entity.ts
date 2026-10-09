import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EmailReference } from './email-reference.entity';
import { Attachment } from './attachment.entity';
import { EmailReadStatus } from './email-read-status.entity';

export enum MailFolder {
  INFORMATIVOS = 'informativos',
  EJECUTIVOS = 'ejecutivos',
  REDGEN = 'redgen',
  TX = 'tx',
}

@Index('idx_emails_folder_date', ['folder', 'date'])
/*
 * Índices que crea MailService a mano (GIN, expresión): declarados con
 * synchronize: false para que la sincronización de TypeORM no los borre en cada
 * arranque. Hasta el 09/10/2026 los borraba y el backend los volvía a crear antes
 * de atender; con ~300k correos podía pasar los 180 s y el pase sin corte fallaba.
 */
@Index('idx_emails_search_vector', { synchronize: false })
@Index('idx_emails_mailcode_trgm', { synchronize: false })
@Index('idx_emails_from_local', { synchronize: false })
@Entity('emails')
export class Email {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  internetMessageId: string;

  @Index('idx_emails_mail_code')
  @Column({ nullable: true })
  mailCode: string;

  @Column()
  subject: string;

  @Column({ type: 'text', nullable: true })
  bodyText: string;

  @Column({ type: 'text', nullable: true })
  bodyHtml: string;

  @Column()
  fromAddress: string;

  @Column('simple-array', { default: '' })
  toAddresses: string[];

  @Column('simple-array', { default: '' })
  ccAddresses: string[];

  @Index('idx_emails_date')
  @Column({ type: 'timestamptz', nullable: true })
  date: Date;

  @Index('idx_emails_folder')
  @Column({ type: 'enum', enum: MailFolder })
  folder: MailFolder;

  @Column({ default: false })
  isFromPstImport: boolean;

  /** tsvector for full-text search — populated by DB trigger, never selected by default */
  @Column({ type: 'tsvector', name: 'search_vector', nullable: true, select: false })
  searchVector: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Attachment, (att) => att.email)
  attachments: Attachment[];

  @OneToMany(() => EmailReadStatus, (rs) => rs.email)
  readStatuses: EmailReadStatus[];

  @OneToMany(() => EmailReference, (ref) => ref.email)
  outgoingRefs: EmailReference[];
}
