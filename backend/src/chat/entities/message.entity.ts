import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('messages')
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

  @Column('text')
  content: string;

  @Column('simple-array', { default: '' })
  readBy: string[];

  @CreateDateColumn()
  createdAt: Date;
}
