import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Acceso de una oficina a la bandeja de escaneo: la carpeta de red
 * \\<VM>\escaneo-<folder> (o FTP) con su usuario. TICOM lo carga en las impresoras.
 */
@Entity('scan_accounts')
export class ScanAccount {
  @PrimaryColumn()
  groupName: string;

  /** Nombre simple de la carpeta (minúsculas, sin tildes ni espacios). */
  @Column({ unique: true })
  folder: string;

  /** esc-<folder>: usuario de la carpeta de red y del FTP. */
  @Column({ unique: true })
  username: string;

  /** Cifrada (secret-box.util): TICOM la necesita ver para cargarla en la impresora. */
  @Column({ type: 'text' })
  passwordEnc: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastScanAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
