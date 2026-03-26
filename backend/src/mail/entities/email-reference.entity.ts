import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Email } from './email.entity';

@Entity('email_references')
export class EmailReference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Email, { onDelete: 'CASCADE' })
  email: Email;

  @Index('idx_references_email_id')
  @Column()
  emailId: string;

  @Index('idx_references_code')
  @Column()
  referencedCode: string;

  @ManyToOne(() => Email, { nullable: true, onDelete: 'SET NULL' })
  referencedEmail: Email;

  @Index('idx_references_referenced_email_id')
  @Column({ nullable: true })
  referencedEmailId: string;
}
