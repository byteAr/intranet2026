import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('draft_mail_authorizers')
export class DraftMailAuthorizer {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) userId: string;
  @Column() username: string;
  @Column() displayName: string;
  @Column() addedById: string;
  @Column() addedByName: string;
  @CreateDateColumn() createdAt: Date;
}
