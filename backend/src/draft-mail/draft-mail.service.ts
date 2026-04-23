import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { DraftEmail, DraftHistoryEntry } from './entities/draft-email.entity';
import { DraftEmailAttachment } from './entities/draft-email-attachment.entity';
import { DraftMailAuthorizer } from './entities/draft-mail-authorizer.entity';
import { DraftMailDirector } from './entities/draft-mail-director.entity';
import { Email } from '../mail/entities/email.entity';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { ReviewActionDto } from './dto/review-action.dto';
import { SendDraftDto } from './dto/send-draft.dto';
import { DelegateDto } from './dto/delegate.dto';
import { AddAuthorizerDto } from './dto/add-authorizer.dto';
import { SetDirectorDto } from './dto/set-director.dto';
import { User } from '../users/entities/user.entity';
import { SmtpSenderService } from '../mail/smtp-sender.service';
import { DraftMailGateway } from './draft-mail.gateway';

// Detects PON codes in email body
const PON_REGEX = /\bPON\s+\d+\/\d+/i;

// Expansión de abreviaturas de jerarquía GN
const RANK_EXPANSIONS: Record<string, string> = {
  'CTE GRL':       'COMANDANTE GENERAL',
  'SCTE GRL':      'SUBCOMANDANTE GENERAL',
  'SUB CTE GRL':   'SUBCOMANDANTE GENERAL',
  'GEN DIV':       'GENERAL DE DIVISIÓN',
  'GEN BRI':       'GENERAL DE BRIGADA',
  'GRL DIV':       'GENERAL DE DIVISIÓN',
  'GRL BRI':       'GENERAL DE BRIGADA',
  'CRL':           'CORONEL',
  'TCL':           'TENIENTE CORONEL',
  'TTE CRL':       'TENIENTE CORONEL',
  'MY':            'MAYOR',
  'CAP':           'CAPITÁN',
  'TTE 1°':        'TENIENTE PRIMERO',
  'TTE 2°':        'TENIENTE SEGUNDO',
  'ALF':           'ALFÉREZ',
  'SMYOR':         'SUBOFICIAL MAYOR',
  'SBRIG':         'SUBOFICIAL BRIGADIER',
};

function expandRank(raw: string | null | undefined): string {
  if (!raw) return '';
  const upper = raw.trim().toUpperCase();
  return RANK_EXPANSIONS[upper] ?? raw.trim();
}

@Injectable()
export class DraftMailService {
  private readonly ADMIN_USERNAME = 'mlopez';

  constructor(
    @InjectRepository(DraftEmail) private readonly draftRepo: Repository<DraftEmail>,
    @InjectRepository(DraftEmailAttachment) private readonly attachmentRepo: Repository<DraftEmailAttachment>,
    @InjectRepository(DraftMailAuthorizer) private readonly authorizerRepo: Repository<DraftMailAuthorizer>,
    @InjectRepository(DraftMailDirector) private readonly directorRepo: Repository<DraftMailDirector>,
    @InjectRepository(Email) private readonly emailRepo: Repository<Email>,
    private readonly configService: ConfigService,
    private readonly smtpSender: SmtpSenderService,
    @Inject(forwardRef(() => DraftMailGateway)) private readonly gateway: DraftMailGateway,
  ) {}

  isMlopez(user: User): boolean {
    return user.username.toLowerCase() === this.ADMIN_USERNAME;
  }

  async isSuperApprover(user: User): Promise<boolean> {
    if (this.isMlopez(user)) return true;
    const director = await this.directorRepo.findOne({ where: { userId: user.id } });
    return !!director;
  }

  async isAuthorizer(user: User): Promise<boolean> {
    if (await this.isSuperApprover(user)) return true;
    if (user.roles?.includes('MTOSAUTORIZADOS')) return true;
    const found = await this.authorizerRepo.findOne({ where: { userId: user.id } });
    return !!found;
  }

  isTicom(user: User): boolean {
    return user.roles?.includes('TICOM') ?? false;
  }

  private generateHash(): string {
    return randomBytes(4).toString('hex').toUpperCase(); // 8 chars hex uppercase
  }

  private async generateUniqueHash(): Promise<string> {
    let hash: string;
    let attempts = 0;
    do {
      hash = this.generateHash();
      const existing = await this.draftRepo.findOne({ where: { hash } });
      if (!existing) return hash;
      attempts++;
    } while (attempts < 10);
    throw new Error('Could not generate unique hash');
  }

  async create(dto: CreateDraftDto, user: User): Promise<DraftEmail> {
    const requiresEncryption = PON_REGEX.test(dto.bodyText);
    const draft = this.draftRepo.create({
      creatorId: user.id,
      creatorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName,
      creatorUsername: user.username,
      subject: dto.subject,
      bodyText: dto.bodyText,
      toAddresses: dto.toAddresses,
      ccAddresses: dto.ccAddresses ?? [],
      status: 'draft',
      requiresEncryption,
      sendMode: dto.sendMode ?? 'normal',
      history: [{
        type: 'created',
        at: new Date().toISOString(),
        byId: user.id,
        byName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName,
      }],
    });
    return this.draftRepo.save(draft);
  }

  async findAllForUser(user: User): Promise<DraftEmail[]> {
    const isAuth = await this.isAuthorizer(user);
    const isTicom = this.isTicom(user);

    const qb = this.draftRepo.createQueryBuilder('d')
      .leftJoinAndSelect('d.attachments', 'att')
      .orderBy('d.createdAt', 'DESC');

    if (isTicom && isAuth) {
      // Sees everything
    } else if (isTicom) {
      // TICOM sees own drafts + approved/sent
      qb.where('d.creatorId = :uid OR d.status IN (:...statuses)', {
        uid: user.id,
        statuses: ['approved', 'sent'],
      });
    } else if (isAuth) {
      // Authorizer sees own drafts + pending_review + needs_correction + approved + sent + cancelled + assigned
      qb.where('d.creatorId = :uid OR d.status IN (:...statuses) OR d.assignedReviewerId = :uid', {
        uid: user.id,
        statuses: ['pending_review', 'needs_correction', 'approved', 'sent', 'cancelled'],
      });
    } else {
      // Regular user: only own drafts
      qb.where('d.creatorId = :uid', { uid: user.id });
    }

    return qb.getMany();
  }

  async findApproved(): Promise<DraftEmail[]> {
    return this.draftRepo.find({
      where: { status: 'approved' },
      relations: ['attachments'],
      order: { approvedAt: 'DESC' },
    });
  }

  async findByHash(hash: string): Promise<DraftEmail | null> {
    return this.draftRepo.findOne({
      where: { hash: hash.toUpperCase() },
      relations: ['attachments'],
    });
  }

  async findOne(id: string, user: User): Promise<DraftEmail> {
    const draft = await this.draftRepo.findOne({ where: { id }, relations: ['attachments'] });
    if (!draft) throw new NotFoundException('Borrador no encontrado');
    await this.assertCanView(draft, user);
    return draft;
  }

  private async assertCanView(draft: DraftEmail, user: User): Promise<void> {
    if (draft.creatorId === user.id) return;
    if (draft.assignedReviewerId === user.id) return;
    if (await this.isAuthorizer(user)) return;
    if (this.isTicom(user) && ['approved', 'sent'].includes(draft.status)) return;
    throw new ForbiddenException('No tenés acceso a este borrador');
  }

  async update(id: string, dto: UpdateDraftDto, user: User): Promise<DraftEmail> {
    const draft = await this.findOne(id, user);
    if (draft.creatorId !== user.id) throw new ForbiddenException('Solo el creador puede editar este borrador');
    if (!['draft', 'needs_correction'].includes(draft.status)) {
      throw new BadRequestException('No se puede editar en el estado actual');
    }

    const changes: DraftHistoryEntry['changes'] = {};
    if (dto.bodyText !== undefined && dto.bodyText !== draft.bodyText) {
      changes.bodyBefore = draft.bodyText;
      changes.bodyAfter = dto.bodyText;
    }
    if (dto.toAddresses) {
      const prev = new Set(draft.toAddresses);
      const next = new Set(dto.toAddresses);
      changes.toAdded = dto.toAddresses.filter((a) => !prev.has(a));
      changes.toRemoved = draft.toAddresses.filter((a) => !next.has(a));
    }
    if (dto.ccAddresses) {
      const prev = new Set(draft.ccAddresses);
      const next = new Set(dto.ccAddresses);
      changes.ccAdded = dto.ccAddresses.filter((a) => !prev.has(a));
      changes.ccRemoved = draft.ccAddresses.filter((a) => !next.has(a));
    }
    if (dto.subject !== undefined && dto.subject !== draft.subject) {
      changes.subjectBefore = draft.subject;
      changes.subjectAfter = dto.subject;
    }

    if (dto.bodyText !== undefined) {
      draft.bodyText = dto.bodyText;
      draft.requiresEncryption = PON_REGEX.test(dto.bodyText) || draft.encryptionManualOverride;
    }
    if (dto.toAddresses) draft.toAddresses = dto.toAddresses;
    if (dto.ccAddresses) draft.ccAddresses = dto.ccAddresses;
    if (dto.subject !== undefined) draft.subject = dto.subject;
    if (dto.sendMode !== undefined) draft.sendMode = dto.sendMode;

    const entry: DraftHistoryEntry = {
      type: 'edited',
      at: new Date().toISOString(),
      byId: user.id,
      byName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName,
      changes: Object.keys(changes).length > 0 ? changes : undefined,
    };
    draft.history = [...draft.history, entry];
    return this.draftRepo.save(draft);
  }

  async submit(id: string, user: User): Promise<DraftEmail> {
    const draft = await this.findOne(id, user);
    if (draft.creatorId !== user.id) throw new ForbiddenException();
    if (!['draft', 'needs_correction'].includes(draft.status)) {
      throw new BadRequestException('No se puede enviar a revisión en el estado actual');
    }
    const type = draft.status === 'draft' ? 'submitted' : 'resubmitted';
    draft.status = 'pending_review';
    draft.correctionNotes = null;
    draft.history = [...draft.history, {
      type,
      at: new Date().toISOString(),
      byId: user.id,
      byName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName,
    }];
    const saved = await this.draftRepo.save(draft);
    this.gateway.notifyRole('', 'draft_submitted', { id: draft.id, subject: draft.subject, creatorName: draft.creatorName });
    this.gateway.notifyRole('', 'draft_status_changed', { id: draft.id });
    return saved;
  }

  async approve(id: string, user: User): Promise<DraftEmail> {
    const draft = await this.findOne(id, user);
    const canApprove = await this.isAuthorizer(user) || draft.assignedReviewerId === user.id;
    if (!canApprove) throw new ForbiddenException('No tenés permiso para aprobar');
    if (draft.status !== 'pending_review') throw new BadRequestException('El borrador no está pendiente de revisión');

    draft.status = 'approved';
    draft.approvedById = user.id;
    draft.approvedByName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    draft.approvedByRank = expandRank((user as any).rank || user.title);
    draft.approvedAt = new Date();
    draft.hash = await this.generateUniqueHash();
    draft.history = [...draft.history, {
      type: 'approved',
      at: new Date().toISOString(),
      byId: user.id,
      byName: draft.approvedByName,
    }];
    const saved = await this.draftRepo.save(draft);
    this.gateway.notifyUser(draft.creatorId, 'draft_approved', { id: draft.id, subject: draft.subject, hash: draft.hash });
    this.gateway.notifyRole('', 'draft_ready_to_send', { id: draft.id, subject: draft.subject });
    this.gateway.notifyRole('', 'draft_status_changed', { id: draft.id });
    return saved;
  }

  async reject(id: string, dto: ReviewActionDto, user: User): Promise<DraftEmail> {
    const draft = await this.findOne(id, user);
    const canReview = await this.isAuthorizer(user) || draft.assignedReviewerId === user.id;
    if (!canReview) throw new ForbiddenException();
    if (draft.status !== 'pending_review') throw new BadRequestException();

    draft.status = 'needs_correction';
    draft.correctionNotes = dto.notes ?? null;
    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    draft.history = [...draft.history, {
      type: 'rejected',
      at: new Date().toISOString(),
      byId: user.id,
      byName,
      detail: dto.notes,
    }];
    const saved = await this.draftRepo.save(draft);
    this.gateway.notifyUser(draft.creatorId, 'draft_rejected', { id: draft.id, subject: draft.subject, notes: dto.notes });
    this.gateway.notifyRole('', 'draft_status_changed', { id: draft.id });
    return saved;
  }

  async cancel(id: string, dto: ReviewActionDto, user: User): Promise<DraftEmail> {
    const draft = await this.findOne(id, user);
    const isAuth = await this.isAuthorizer(user);
    const isCreator = draft.creatorId === user.id;
    if (!isAuth && !isCreator) throw new ForbiddenException('No tenés permiso para cancelar este borrador');
    if (!['pending_review', 'needs_correction'].includes(draft.status)) {
      throw new BadRequestException('No se puede cancelar en el estado actual');
    }
    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    draft.status = 'cancelled';
    draft.hash = null;
    draft.cancelledById = user.id;
    draft.cancelledByName = byName;
    draft.cancellationReason = dto.notes ?? null;
    draft.cancelledAt = new Date();
    draft.history = [...draft.history, {
      type: 'cancelled',
      at: new Date().toISOString(),
      byId: user.id,
      byName,
      detail: dto.notes,
    }];
    const saved = await this.draftRepo.save(draft);
    this.gateway.notifyUser(draft.creatorId, 'draft_cancelled', { id: draft.id });
    this.gateway.notifyRole('', 'draft_status_changed', { id: draft.id });
    return saved;
  }

  async ticomCancel(id: string, dto: ReviewActionDto, user: User): Promise<DraftEmail> {
    if (!this.isTicom(user)) throw new ForbiddenException();
    const draft = await this.findOne(id, user);
    if (draft.status !== 'approved') throw new BadRequestException('Solo se puede rechazar un email aprobado');
    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    draft.status = 'needs_correction';
    draft.hash = null;
    draft.correctionNotes = dto.notes ?? null;
    draft.hashEnteredAt = null;
    draft.hashEnteredById = null;
    draft.hashEnteredByName = null;
    draft.hashEnteredByRank = null;
    draft.history = [...draft.history, {
      type: 'ticom_cancelled',
      at: new Date().toISOString(),
      byId: user.id,
      byName,
      detail: dto.notes,
    }];
    const saved = await this.draftRepo.save(draft);
    this.gateway.notifyUser(draft.creatorId, 'draft_rejected', { id: draft.id, subject: draft.subject, notes: dto.notes });
    this.gateway.notifyRole('', 'draft_status_changed', { id: draft.id });
    return saved;
  }

  async delegate(id: string, dto: DelegateDto, user: User): Promise<DraftEmail> {
    if (!(await this.isSuperApprover(user))) throw new ForbiddenException('Solo el director o mlopez pueden delegar aprobación');
    const draft = await this.findOne(id, user);
    if (draft.status !== 'pending_review') throw new BadRequestException();
    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    draft.assignedReviewerId = dto.userId;
    draft.assignedReviewerName = dto.displayName;
    draft.history = [...draft.history, {
      type: 'delegated',
      at: new Date().toISOString(),
      byId: user.id,
      byName,
      detail: `Delegado a ${dto.displayName}`,
    }];
    return this.draftRepo.save(draft);
  }

  async toggleEncryption(id: string, user: User): Promise<DraftEmail> {
    if (!this.isTicom(user)) throw new ForbiddenException();
    const draft = await this.findOne(id, user);
    if (draft.status !== 'approved') throw new BadRequestException();
    draft.encryptionManualOverride = !draft.encryptionManualOverride;
    draft.requiresEncryption = PON_REGEX.test(draft.bodyText) || draft.encryptionManualOverride;
    return this.draftRepo.save(draft);
  }

  async enterHash(id: string, hash: string, user: User): Promise<DraftEmail> {
    if (!this.isTicom(user)) throw new ForbiddenException();
    const draft = await this.draftRepo.findOne({ where: { id }, relations: ['attachments'] });
    if (!draft) throw new NotFoundException();
    if (draft.hash?.toUpperCase() !== hash.toUpperCase()) {
      throw new BadRequestException('El hash ingresado no coincide con este correo');
    }
    if (draft.status !== 'approved') throw new BadRequestException('El correo no está en estado aprobado');
    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    draft.hashEnteredAt = new Date();
    draft.hashEnteredById = user.id;
    draft.hashEnteredByName = byName;
    draft.hashEnteredByRank = (user as any).rank ?? null;
    return this.draftRepo.save(draft);
  }

  async getNextMailCode(): Promise<string> {
    const currentYear = new Date().getFullYear().toString().slice(-2);
    const pattern = `DEI %/${currentYear}`;

    // Check sent drafts
    const lastDraft = await this.draftRepo
      .createQueryBuilder('d')
      .where('d.status = :status', { status: 'sent' })
      .andWhere("d.\"mailCode\" LIKE :pattern", { pattern })
      .orderBy('d."sentAt"', 'DESC')
      .getOne();

    // Also check main emails table (PST imports / received)
    const lastEmail = await this.emailRepo
      .createQueryBuilder('e')
      .where("e.\"mailCode\" LIKE :pattern", { pattern })
      .orderBy('e.date', 'DESC')
      .getOne();

    const extractNum = (code: string | null | undefined): number => {
      if (!code) return 0;
      const m = code.match(/DEI\s+(\d+)\//);
      return m ? parseInt(m[1], 10) : 0;
    };

    const maxNum = Math.max(
      extractNum(lastDraft?.mailCode),
      extractNum(lastEmail?.mailCode),
    );

    return `DEI ${maxNum + 1}/${currentYear}`;
  }

  private fmtDateGroup(d: Date): string {
    const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    const day = String(d.getDate()).padStart(2, '0');
    const hhmm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    return `${day}${hhmm}${months[d.getMonth()]}${String(d.getFullYear()).slice(-2)}`;
  }

  async send(id: string, dto: SendDraftDto, user: User): Promise<DraftEmail> {
    if (!this.isTicom(user)) throw new ForbiddenException();
    const draft = await this.findOne(id, user);
    if (draft.status !== 'approved') throw new BadRequestException('El correo no está aprobado');
    if (draft.hash?.toUpperCase() !== dto.hash.toUpperCase()) {
      throw new BadRequestException('Hash incorrecto');
    }

    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    const rank = expandRank((user as any).rank || user.title);
    const now = new Date();

    const fdoGroup = this.fmtDateGroup(draft.approvedAt ?? now);
    const btGroup = this.fmtDateGroup(draft.hashEnteredAt ?? now);
    const lastName = (user.lastName ?? user.displayName).toUpperCase();
    let composedBody = draft.bodyText;
    const deiPlaceholder = /^DEI\s+\/\d{2}/;
    if (deiPlaceholder.test(composedBody)) {
      composedBody = composedBody.replace(deiPlaceholder, `${dto.mailCode}.-`);
    } else {
      composedBody = `${dto.mailCode}.- ${composedBody}`;
    }
    const finalBody = `${composedBody}\n\nFDO: ${fdoGroup}     BT: ${btGroup}     TX: ${rank} ${lastName}`;
    const finalSubject = dto.subject ?? dto.mailCode;

    // Read attachment files from disk as buffers for SMTP
    const attachmentRows = await this.attachmentRepo.find({ where: { draftEmailId: id } });
    const multerFiles = attachmentRows.map((att) => ({
      originalname: att.filename,
      mimetype: att.contentType,
      buffer: readFileSync(att.storagePath),
      size: att.size,
      fieldname: 'files',
      encoding: '7bit',
      stream: null as any,
      destination: '',
      filename: att.storagePath,
      path: att.storagePath,
    })) as Express.Multer.File[];

    await this.smtpSender.send(
      {
        to: draft.toAddresses,
        cc: draft.ccAddresses,
        bcc: ['DIREDTOS@MTO.GNA'],
        subject: finalSubject,
        bodyText: finalBody,
      },
      multerFiles,
    );

    draft.status = 'sent';
    draft.mailCode = dto.mailCode;
    draft.sentById = user.id;
    draft.sentByName = byName;
    draft.sentByRank = rank;
    draft.sentAt = now;
    draft.history = [...draft.history, {
      type: 'sent',
      at: now.toISOString(),
      byId: user.id,
      byName,
      detail: `Enviado con código ${dto.mailCode}`,
    }];
    const saved = await this.draftRepo.save(draft);

    this.gateway.notifyUser(draft.creatorId, 'draft_sent', { id: draft.id, mailCode: dto.mailCode });
    this.gateway.notifyRole('', 'draft_status_changed', { id: draft.id });
    return saved;
  }

  async deleteDraft(id: string, user: User): Promise<void> {
    const draft = await this.findOne(id, user);
    if (draft.creatorId !== user.id) throw new ForbiddenException('Solo el creador puede eliminar el borrador');
    if (!['draft', 'needs_correction', 'pending_review'].includes(draft.status)) {
      throw new BadRequestException('No se puede eliminar en el estado actual');
    }
    await this.draftRepo.remove(draft);
  }

  // Authorizers management
  async getAuthorizers(): Promise<DraftMailAuthorizer[]> {
    return this.authorizerRepo.find({ order: { createdAt: 'DESC' } });
  }

  async addAuthorizer(dto: AddAuthorizerDto, user: User): Promise<DraftMailAuthorizer> {
    if (!(await this.isSuperApprover(user))) throw new ForbiddenException();
    const existing = await this.authorizerRepo.findOne({ where: { userId: dto.userId } });
    if (existing) throw new BadRequestException('El usuario ya es autorizador');
    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    const auth = this.authorizerRepo.create({
      userId: dto.userId,
      username: dto.username,
      displayName: dto.displayName,
      addedById: user.id,
      addedByName: byName,
    });
    return this.authorizerRepo.save(auth);
  }

  async removeAuthorizer(userId: string, user: User): Promise<void> {
    if (!(await this.isSuperApprover(user))) throw new ForbiddenException();
    const auth = await this.authorizerRepo.findOne({ where: { userId } });
    if (!auth) throw new NotFoundException();
    await this.authorizerRepo.remove(auth);
  }

  async getPendingCountForAuthorizer(user: User): Promise<number> {
    const isAuth = await this.isAuthorizer(user);
    if (!isAuth) return 0;
    return this.draftRepo.count({ where: { status: 'pending_review' } });
  }

  async getApprovedCount(): Promise<number> {
    return this.draftRepo.count({ where: { status: 'approved' } });
  }

  // Director management (solo mlopez puede gestionar esto)
  async getDirector(): Promise<DraftMailDirector | null> {
    const [director] = await this.directorRepo.find({ take: 1 });
    return director ?? null;
  }

  async setDirector(dto: SetDirectorDto, user: User): Promise<DraftMailDirector> {
    if (!this.isMlopez(user)) throw new ForbiddenException('Solo mlopez puede designar al director');
    await this.directorRepo.createQueryBuilder().delete().execute();
    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    const director = this.directorRepo.create({
      userId: dto.userId,
      username: dto.username,
      displayName: dto.displayName,
      setById: user.id,
      setByName: byName,
    });
    return this.directorRepo.save(director);
  }

  async removeDirector(user: User): Promise<void> {
    if (!this.isMlopez(user)) throw new ForbiddenException('Solo mlopez puede quitar al director');
    await this.directorRepo.createQueryBuilder().delete().execute();
  }
}
