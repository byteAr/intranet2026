import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

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

  @Column('simple-array', { default: '' })
  readBy: string[];

  @CreateDateColumn()
  createdAt: Date;
}
