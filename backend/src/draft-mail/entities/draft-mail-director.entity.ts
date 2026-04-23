import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('draft_mail_director')
export class DraftMailDirector {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) userId: string;
  @Column() username: string;
  @Column() displayName: string;
  @Column() setById: string;
  @Column() setByName: string;
  @CreateDateColumn() createdAt: Date;
}
