import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('admin_audit_logs')
export class AdminAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  actorUsername: string;

  @Column()
  actorDisplayName: string;

  @Column('text')
  description: string;

  @CreateDateColumn()
  createdAt: Date;
}
