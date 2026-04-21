import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('broadcast_messages')
export class BroadcastMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() senderId: string;
  @Column() senderName: string;
  @Column({ nullable: true }) senderAvatar?: string;
  @Column({ type: 'text', default: '' }) content: string;
  @Column({ nullable: true }) attachmentUrl?: string;
  @Column({ nullable: true }) attachmentName?: string;
  @Column({ type: 'int', nullable: true }) attachmentSize?: number;
  @Column({ nullable: true }) attachmentMimeType?: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
