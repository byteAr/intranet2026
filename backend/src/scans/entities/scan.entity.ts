import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Un escaneo que llegó de una impresora a la bandeja de una oficina. Lo ven
 * solo los integrantes de esa oficina; se borra solo a los 90 días.
 */
@Entity('scans')
@Index(['groupName', 'receivedAt'])
export class Scan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** La oficina (grupo del AD con category='oficina'). */
  @Column()
  groupName: string;

  /** Nombre que se muestra ("Escaneo 08-10-2026 10.32.15.pdf"); la oficina lo puede cambiar. */
  @Column()
  filename: string;

  @Column()
  contentType: string;

  @Column({ type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  size: number;

  @Column()
  storagePath: string;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;
}
