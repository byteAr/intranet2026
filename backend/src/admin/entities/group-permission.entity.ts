import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('group_permissions')
export class GroupPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  groupName: string;

  @Column('simple-json')
  allowedModules: string[];

  @UpdateDateColumn()
  updatedAt: Date;
}
