import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string; // sAMAccountName / uid

  @Column({ unique: true })
  email: string; // mail

  @Column()
  displayName: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column('simple-array', { default: '' })
  roles: string[]; // grupos AD → roles de app

  @Column({ nullable: true })
  adDn: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ nullable: true })
  recoveryEmail: string;

  @Column({ type: 'text', nullable: true })
  avatar: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
