import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DraftEmailAttachment } from './draft-email-attachment.entity';

export interface DraftHistoryEntry {
  type: 'created' | 'submitted' | 'resubmitted' | 'approved' | 'rejected' | 'cancelled' | 'ticom_cancelled' | 'sent' | 'delegated' | 'edited';
  at: string;
  byId: string;
  byName: string;
  detail?: string;
  changes?: {
    bodyBefore?: string;
    bodyAfter?: string;
    toAdded?: string[];
    toRemoved?: string[];
    ccAdded?: string[];
    ccRemoved?: string[];
    subjectBefore?: string;
    subjectAfter?: string;
  };
}

@Entity('draft_emails')
export class DraftEmail {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'varchar', nullable: true, unique: true }) hash: string | null;

  @Column() creatorId: string;
  @Column() creatorName: string;
  @Column() creatorUsername: string;

  @Column() subject: string;
  @Column('text') bodyText: string;

  @Column('simple-json') toAddresses: string[];
  @Column('simple-json') ccAddresses: string[];

  // status: draft | pending_review | needs_correction | approved | sent | cancelled
  @Column({ default: 'draft' }) status: string;

  @Column({ default: false }) requiresEncryption: boolean;
  @Column({ default: false }) encryptionManualOverride: boolean;

  // Delegation (specific reviewer for this email)
  @Column({ type: 'varchar', nullable: true }) assignedReviewerId: string | null;
  @Column({ type: 'varchar', nullable: true }) assignedReviewerName: string | null;

  // Approval info
  @Column({ type: 'varchar', nullable: true }) approvedById: string | null;
  @Column({ type: 'varchar', nullable: true }) approvedByName: string | null;
  @Column({ type: 'varchar', nullable: true }) approvedByRank: string | null;
  @Column({ type: 'timestamp', nullable: true }) approvedAt: Date | null;

  // Correction notes (from MTOSAUTORIZADOS or TICOM)
  @Column({ type: 'text', nullable: true }) correctionNotes: string | null;

  // MailCode assigned by TICOM before sending (e.g. "DEI 125/26")
  @Column({ type: 'varchar', nullable: true }) mailCode: string | null;

  // Timestamp when TICOM enters hash (BT: field in print)
  @Column({ type: 'timestamp', nullable: true }) hashEnteredAt: Date | null;

  // TICOM who entered hash
  @Column({ type: 'varchar', nullable: true }) hashEnteredById: string | null;
  @Column({ type: 'varchar', nullable: true }) hashEnteredByName: string | null;
  @Column({ type: 'varchar', nullable: true }) hashEnteredByRank: string | null;

  // Sent info
  @Column({ type: 'varchar', nullable: true }) sentById: string | null;
  @Column({ type: 'varchar', nullable: true }) sentByName: string | null;
  @Column({ type: 'varchar', nullable: true }) sentByRank: string | null;
  @Column({ type: 'timestamp', nullable: true }) sentAt: Date | null;
  @Column({ type: 'varchar', nullable: true }) sentMessageId: string | null;

  // Cancellation (permanent, by MTOSAUTORIZADOS)
  @Column({ type: 'varchar', nullable: true }) cancelledById: string | null;
  @Column({ type: 'varchar', nullable: true }) cancelledByName: string | null;
  @Column({ type: 'text', nullable: true }) cancellationReason: string | null;
  @Column({ type: 'timestamp', nullable: true }) cancelledAt: Date | null;

  @Column({ type: 'jsonb', default: '[]' }) history: DraftHistoryEntry[];

  @OneToMany(() => DraftEmailAttachment, (att) => att.draftEmail, { cascade: true, eager: false })
  attachments: DraftEmailAttachment[];

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
