import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { DraftEmail, DraftHistoryEntry } from './entities/draft-email.entity';
import { DraftEmailAttachment } from './entities/draft-email-attachment.entity';
import { DraftMailSigner } from './entities/draft-mail-signer.entity';
import { Email } from '../mail/entities/email.entity';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { ReviewActionDto } from './dto/review-action.dto';
import { SendDraftDto } from './dto/send-draft.dto';
import { SetSignerDto } from './dto/set-signer.dto';
import { User } from '../users/entities/user.entity';
import { SmtpSenderService } from '../mail/smtp-sender.service';
import { DraftMailGateway } from './draft-mail.gateway';

const PON_REGEX = /\bPON\s+\d+\/\d+/i;

const RANK_EXPANSIONS: Record<string, string> = {
  'CTE GRL':   'COMANDANTE GENERAL',
  'CTE MY':    'COMANDANTE MAYOR',
  'CTE PR':    'COMANDANTE PRINCIPAL',
  'CTE':       'COMANDANTE',
  '2DO CTE':   'SEGUNDO COMANDANTE',
  '1ER ALF':   'PRIMER ALFÉREZ',
  'ALF':       'ALFÉREZ',
  'SUBALF':    'SUBALFÉREZ',
  'SUBOF MY':  'SUBOFICIAL MAYOR',
  'SUBOF PR':  'SUBOFICIAL PRINCIPAL',
  'SARG AY':   'SARGENTO AYUDANTE',
  'SARG 1RO':  'SARGENTO PRIMERO',
  'SARG':      'SARGENTO',
  'CRO':       'CABO PRIMERO',
  'CBO':       'CABO',
  'GEND':      'GENDARME',
  'GEND II':   'GENDARME DE SEGUNDA',
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
    @InjectRepository(DraftMailSigner) private readonly signerRepo: Repository<DraftMailSigner>,
    @InjectRepository(Email) private readonly emailRepo: Repository<Email>,
    private readonly configService: ConfigService,
    private readonly smtpSender: SmtpSenderService,
    @Inject(forwardRef(() => DraftMailGateway)) private readonly gateway: DraftMailGateway,
  ) {}

  isMlopez(user: User): boolean {
    return user.username.toLowerCase() === this.ADMIN_USERNAME;
  }

  isTicom(user: User): boolean {
    return user.roles?.includes('TICOM') ?? false;
  }

  private generateHash(): string {
    return randomBytes(4).toString('hex').toUpperCase();
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
    const isTicom = this.isTicom(user);

    const qb = this.draftRepo.createQueryBuilder('d')
      .leftJoinAndSelect('d.attachments', 'att')
      .orderBy('d.createdAt', 'DESC');

    if (isTicom) {
      qb.where('d.creatorId = :uid OR d.status IN (:...statuses)', {
        uid: user.id,
        statuses: ['approved', 'sent'],
      });
    } else {
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
    this.assertCanView(draft, user);
    return draft;
  }

  private assertCanView(draft: DraftEmail, user: User): void {
    if (draft.creatorId === user.id) return;
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

  async confirmDraft(id: string, user: User): Promise<DraftEmail> {
    const draft = await this.findOne(id, user);
    if (draft.creatorId !== user.id) throw new ForbiddenException('Solo el creador puede confirmar su borrador');
    if (!['draft', 'needs_correction'].includes(draft.status)) {
      throw new BadRequestException('No se puede confirmar en el estado actual');
    }

    const signer = await this.getSigner();

    draft.status = 'approved';
    draft.approvedById = user.id;
    draft.approvedByName = signer?.displayName ?? null;
    draft.approvedByRank = signer?.rank ?? null;
    draft.approvedAt = new Date();
    draft.hash = await this.generateUniqueHash();
    draft.correctionNotes = null;

    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    draft.history = [...draft.history, {
      type: 'confirmed',
      at: new Date().toISOString(),
      byId: user.id,
      byName,
    }];

    const saved = await this.draftRepo.save(draft);
    this.gateway.notifyRole('', 'draft_ready_to_send', { id: draft.id, subject: draft.subject });
    this.gateway.notifyRole('', 'draft_status_changed', { id: draft.id });
    return saved;
  }

  async cancel(id: string, dto: ReviewActionDto, user: User): Promise<DraftEmail> {
    const draft = await this.findOne(id, user);
    const isCreator = draft.creatorId === user.id;
    if (!isCreator) throw new ForbiddenException('Solo el creador puede cancelar su borrador');
    if (!['draft', 'needs_correction'].includes(draft.status)) {
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

    const lastDraft = await this.draftRepo
      .createQueryBuilder('d')
      .where('d.status = :status', { status: 'sent' })
      .andWhere("d.\"mailCode\" LIKE :pattern", { pattern })
      .orderBy('d."sentAt"', 'DESC')
      .getOne();

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

    const fdoDate = new Date(dto.fdoTimestamp);
    if (isNaN(fdoDate.getTime())) throw new BadRequestException('Fecha/hora del firmado (FDO) inválida');
    const fdoGroup = this.fmtDateGroup(fdoDate);
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
    if (!['draft', 'needs_correction'].includes(draft.status)) {
      throw new BadRequestException('No se puede eliminar en el estado actual');
    }
    await this.draftRepo.remove(draft);
  }

  async getApprovedCount(): Promise<number> {
    return this.draftRepo.count({ where: { status: 'approved' } });
  }

  // Signer management (solo mlopez)
  async getSigner(): Promise<DraftMailSigner | null> {
    const [signer] = await this.signerRepo.find({ take: 1 });
    return signer ?? null;
  }

  async setSigner(dto: SetSignerDto, user: User): Promise<DraftMailSigner> {
    if (!this.isMlopez(user)) throw new ForbiddenException('Solo mlopez puede configurar el firmante');
    await this.signerRepo.createQueryBuilder().delete().execute();
    const byName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName;
    const signer = this.signerRepo.create({
      displayName: dto.displayName,
      rank: dto.rank,
      setById: user.id,
      setByName: byName,
    });
    return this.signerRepo.save(signer);
  }

  async removeSigner(user: User): Promise<void> {
    if (!this.isMlopez(user)) throw new ForbiddenException('Solo mlopez puede quitar el firmante');
    await this.signerRepo.createQueryBuilder().delete().execute();
  }

  async getBodyReferences(id: string, user: User): Promise<{ referencedCode: string; referencedEmailId: string | null }[]> {
    const draft = await this.findOne(id, user);
    const body = draft.bodyText ?? '';
    const CODE_RE = /\b([A-ZÁÉÍÓÚÑ]{1,4})[ \t]*(\d+)[^\w\/]*\/[^\w]*(\d[^\w\/]*\d)\b/g;
    const EXCLUDED = new Set(['PON', 'DDNG']);
    const seen = new Set<string>();
    const results: { referencedCode: string; referencedEmailId: string | null }[] = [];
    let m: RegExpExecArray | null;
    while ((m = CODE_RE.exec(body)) !== null) {
      const prefix = m[1].toUpperCase();
      if (EXCLUDED.has(prefix)) continue;
      const code = `${prefix} ${m[2]}/${m[3].replace(/\D/g, '')}`;
      if (seen.has(code)) continue;
      seen.add(code);
      const email = await this.emailRepo.findOne({ where: { mailCode: code } });
      results.push({ referencedCode: code, referencedEmailId: email?.id ?? null });
    }
    return results;
  }
}
