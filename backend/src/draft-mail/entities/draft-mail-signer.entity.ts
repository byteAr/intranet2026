import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('draft_mail_signer')
export class DraftMailSigner {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() displayName: string;
  @Column() rank: string;
  @Column() setById: string;
  @Column() setByName: string;
  @CreateDateColumn() createdAt: Date;
}
