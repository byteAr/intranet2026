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

  @Column({ nullable: true })
  upn: string; // userPrincipalName

  @Column({ nullable: true })
  title: string; // cargo

  @Column({ nullable: true })
  department: string;

  @Column({ nullable: true })
  company: string;

  @Column({ nullable: true })
  phone: string; // telephoneNumber

  @Column({ nullable: true })
  mobile: string;

  @Column({ nullable: true })
  office: string; // physicalDeliveryOfficeName

  @Column({ nullable: true })
  officeGroup: string; // CN del grupo AD con category='oficina' al que pertenece

  @Column({ nullable: true })
  manager: string; // CN del manager extraído del DN

  @Column({ nullable: true })
  employeeId: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ nullable: true })
  recoveryEmail: string;

  @Column({ type: 'text', nullable: true })
  avatar: string;

  @Column({ nullable: true, type: 'varchar' })
  rank: string | null;

  @Column({ default: false })
  mustChangePassword: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
