import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface ChatAttachment {
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

@Entity('messages')
@Index(['senderId', 'recipientId', 'createdAt'])
@Index(['recipientId', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  senderId: string;

  @Column()
  senderName: string;

  @Column({ type: 'text', nullable: true })
  senderAvatar?: string;

  @Column({ nullable: true })
  recipientId?: string; // null = chat global

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'text', nullable: true })
  attachmentUrl?: string;

  @Column({ nullable: true })
  attachmentName?: string;

  @Column({ type: 'integer', nullable: true })
  attachmentSize?: number;

  @Column({ nullable: true })
  attachmentMimeType?: string;

  /**
   * Todos los adjuntos del mensaje, cuando son varios (desde la 1.5.4). El primero
   * también va en attachmentUrl/Name/Size/MimeType, que es lo que leen la vista
   * previa de la lista de conversaciones y las pestañas con la versión anterior.
   */
  @Column({ type: 'jsonb', nullable: true })
  attachments?: ChatAttachment[] | null;

  @Column('simple-array', { default: '' })
  readBy: string[];

  @CreateDateColumn()
  createdAt: Date;
}
