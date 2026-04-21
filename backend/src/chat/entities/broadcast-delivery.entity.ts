import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

@Entity('broadcast_deliveries')
@Unique(['broadcastId', 'userId'])
export class BroadcastDelivery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() broadcastId: string;
  @Index() @Column() userId: string;
  @CreateDateColumn({ type: 'timestamptz' }) deliveredAt: Date;
}
