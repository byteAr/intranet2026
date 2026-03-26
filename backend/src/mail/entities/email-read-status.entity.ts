import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Email } from './email.entity';
import { User } from '../../users/entities/user.entity';

@Entity('email_read_status')
@Unique(['emailId', 'userId'])
export class EmailReadStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Email, { onDelete: 'CASCADE' })
  email: Email;

  @Column()
  emailId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: string;

  @Column({ default: false })
  isRead: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date;
}
