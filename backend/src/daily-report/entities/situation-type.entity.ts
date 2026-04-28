import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('situation_types')
export class SituationType {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  code: string; // e.g. 'PRESENTE', 'PARTE_ENFERMO', 'LAO'

  @Column()
  label: string; // Display name

  @Column({ default: false })
  isSystem: boolean; // System types cannot be deleted

  @Column({ default: false })
  requiresDateRange: boolean; // Requires fromDate + toDate

  @Column({ default: false })
  requiresFromDateOnly: boolean; // Requires fromDate only (illness)

  @Column({ default: false })
  requiresAuthorizationInfo: boolean; // For AUTORIZADO: who, how many days, if LAO

  @Column({ default: false })
  isAbsent: boolean; // Counts as absent from service

  @Column({ default: false })
  isEffective: boolean; // Counts toward fuerza efectiva

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;
}
