import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { Email } from './entities/email.entity';
import { Attachment } from './entities/attachment.entity';
import { EmailReadStatus } from './entities/email-read-status.entity';
import { EmailReference } from './entities/email-reference.entity';
import { QueryEmailsDto } from './dto/query-emails.dto';

@Injectable()
export class MailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailService.name);
  constructor(
    @InjectRepository(Email)
    private readonly emailRepo: Repository<Email>,
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(EmailReadStatus)
    private readonly readStatusRepo: Repository<EmailReadStatus>,
    @InjectRepository(EmailReference)
    private readonly referenceRepo: Repository<EmailReference>,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Check if trigger needs upgrade (from 'simple' to 'spanish' or new fields)
      const currentFn = await this.dataSource
        .query(`SELECT prosrc FROM pg_proc WHERE proname = 'emails_search_vector_update'`)
        .then((r: { prosrc: string }[]) => r[0]?.prosrc ?? '');
      // Rebuild if not using 'simple' config yet (spanish has stop words that drop "ES", "DE", etc.)
      const needsRebuild = !currentFn.includes("'simple'") || currentFn.includes('fromAddress');

      // Trigger function: 'simple' config — no stop words, no stemming, just lowercase+split
      // 'spanish' config was dropping abbreviations like "ES", "DE", "AL" used in mail codes
      await this.dataSource.query(`
        CREATE OR REPLACE FUNCTION emails_search_vector_update() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector := to_tsvector('simple',
            coalesce(NEW.subject, '') || ' ' ||
            coalesce(left(NEW."bodyText", 50000), '') || ' ' ||
            coalesce(NEW."mailCode", '')
          );
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await this.dataSource.query(`
        DROP TRIGGER IF EXISTS emails_search_vector_trigger ON emails;
        CREATE TRIGGER emails_search_vector_trigger
        BEFORE INSERT OR UPDATE ON emails
        FOR EACH ROW EXECUTE FUNCTION emails_search_vector_update();
      `);

      // GIN index for fast full-text search
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_emails_search_vector ON emails USING GIN (search_vector);
      `);

      // Force rebuild if config changed (one-time migration)
      if (needsRebuild) {
        this.logger.log('FTS: config changed to simple — rebuilding all search_vectors...');
        await this.dataSource.query(`UPDATE emails SET search_vector = NULL`);
      }

      // Backfill missing search_vectors
      const { count } = await this.dataSource
        .query(`SELECT COUNT(*) AS count FROM emails WHERE search_vector IS NULL`)
        .then((r: { count: string }[]) => r[0]);

      if (parseInt(count, 10) > 0) {
        await this.dataSource.query(`
          UPDATE emails SET search_vector = to_tsvector('simple',
            coalesce(subject, '') || ' ' ||
            coalesce(left("bodyText", 50000), '') || ' ' ||
            coalesce("mailCode", '')
          ) WHERE search_vector IS NULL
        `);
        this.logger.log(`FTS: search_vector rebuilt for ${count} emails`);
      }

      this.logger.log('FTS: trigger, GIN index, and search_vector ready');
    } catch (err) {
      this.logger.error('FTS: failed to initialize', (err as Error).message);
    }
  }

  async findAll(
    dto: QueryEmailsDto,
    userId: string,
  ): Promise<{ data: Email[]; total: number; page: number; limit: number }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 30;
    const offset = (page - 1) * limit;

    const qb = this.emailRepo
      .createQueryBuilder('e')
      .select([
        'e.id', 'e.internetMessageId', 'e.mailCode', 'e.subject',
        'e.fromAddress', 'e.toAddresses', 'e.ccAddresses',
        'e.date', 'e.folder', 'e.isFromPstImport', 'e.createdAt',
      ])
      .orderBy('e.date', 'DESC')
      .skip(offset)
      .take(limit);

    // No cargar readStatuses para históricos — no se trackea lectura y evita JOIN costoso
    if (!dto.historical) {
      qb.leftJoin('e.readStatuses', 'rs', 'rs.userId = :userId', { userId })
        .addSelect(['rs.isRead', 'rs.readAt']);
    }

    if (dto.folder) {
      qb.andWhere('e.folder = :folder', { folder: dto.folder });
    }

    const currentYear = new Date().getFullYear();
    const hasAdvancedDate = !!(dto.year || dto.dateFrom || dto.dateTo);

    if (dto.year) {
      qb.andWhere('EXTRACT(YEAR FROM e.date) = :exactYear', { exactYear: dto.year });
    } else if (!hasAdvancedDate) {
      if (dto.historical) {
        qb.andWhere('EXTRACT(YEAR FROM e.date) < :year', { year: currentYear });
      } else if (!dto.q?.trim()) {
        qb.andWhere('EXTRACT(YEAR FROM e.date) = :year', { year: currentYear });
      }
    }

    if (dto.dateFrom) {
      qb.andWhere('e.date >= :dateFrom', { dateFrom: new Date(dto.dateFrom + 'T00:00:00') });
    }
    if (dto.dateTo) {
      qb.andWhere('e.date <= :dateTo', { dateTo: new Date(dto.dateTo + 'T23:59:59') });
    }

    if (dto.q?.trim()) {
      const searchTerm = dto.q.trim();
      // Regex for mailCode: escape special chars then add negative lookahead for digits.
      // Prevents "ES 240" from matching "ES 2408/24" (240 is a prefix of 2408).
      const mailCodePattern = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9])';
      qb.andWhere(new Brackets((qb2) => {
        // Full-text search via GIN-indexed tsvector (subject, body, mailCode)
        // phraseto_tsquery requires words to be adjacent — avoids false positives
        qb2.where(
          `e.search_vector @@ phraseto_tsquery('simple', :searchTerm)`,
          { searchTerm },
        )
        // mailCode regex match with word boundary — ~* is case-insensitive regex
        .orWhere(`e."mailCode" ~* :mailCodePattern`, { mailCodePattern })
        // Attachment filename match
        .orWhere(
          `EXISTS (SELECT 1 FROM attachments att WHERE att."emailId" = e.id AND att.filename ILIKE :attTerm)`,
          { attTerm: `%${searchTerm}%` },
        );
      }));
    }

    qb.loadRelationCountAndMap('e.attachmentCount', 'e.attachments');

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async findOne(id: string, userId: string): Promise<Email> {
    const email = await this.emailRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.attachments', 'att')
      .leftJoinAndSelect('e.readStatuses', 'rs', 'rs.userId = :userId', { userId })
      .leftJoinAndSelect('e.outgoingRefs', 'ref')
      .where('e.id = :id', { id })
      .getOne();

    if (!email) throw new NotFoundException('Correo no encontrado');
    return email;
  }

  async getTree(rootCode: string): Promise<unknown[]> {
    const result: { id: string; mailCode: string; subject: string; fromAddress: string; date: Date; depth: number }[] =
      await this.dataSource.query(
        `
        WITH RECURSIVE mail_tree AS (
          SELECT e.id, e."mailCode", e.subject, e."fromAddress", e.date,
                 0 AS depth,
                 ARRAY[e.id] AS path
          FROM emails e
          WHERE e."mailCode" = $1

          UNION ALL

          SELECT child.id, child."mailCode", child.subject, child."fromAddress", child.date,
                 tree.depth + 1,
                 tree.path || child.id
          FROM mail_tree tree
          JOIN email_references ref ON ref."emailId" = tree.id
          JOIN emails child ON child.id = ref."referencedEmailId"
          WHERE child.id != ALL(tree.path)
            AND tree.depth < 10
        )
        SELECT * FROM mail_tree ORDER BY depth, "mailCode"
        `,
        [rootCode],
      );
    return result;
  }

  async markRead(emailId: string, userId: string): Promise<void> {
    const email = await this.emailRepo.findOne({ where: { id: emailId } });
    if (!email) throw new NotFoundException('Correo no encontrado');

    const existing = await this.readStatusRepo.findOne({
      where: { emailId, userId },
    });

    if (existing) {
      if (!existing.isRead) {
        existing.isRead = true;
        existing.readAt = new Date();
        await this.readStatusRepo.save(existing);
      }
      return;
    }

    await this.readStatusRepo.save(
      this.readStatusRepo.create({
        emailId,
        userId,
        isRead: true,
        readAt: new Date(),
      }),
    );
  }

  async getUnreadCounts(userId: string): Promise<{ total: number; informativos: number; ejecutivos: number; redgen: number; tx: number }> {
    const currentYear = new Date().getFullYear();
    const rows = await this.emailRepo
      .createQueryBuilder('e')
      .select('e.folder', 'folder')
      .addSelect('COUNT(*)', 'count')
      .leftJoin('e.readStatuses', 'rs', 'rs.userId = :userId', { userId })
      .where('EXTRACT(YEAR FROM e.date) = :year', { year: currentYear })
      .andWhere('(rs.id IS NULL OR rs."isRead" = false)')
      .groupBy('e.folder')
      .getRawMany<{ folder: string; count: string }>();

    const map: Record<string, number> = {};
    for (const row of rows) {
      map[row.folder] = parseInt(row.count, 10);
    }
    const informativos = map['informativos'] ?? 0;
    const ejecutivos = map['ejecutivos'] ?? 0;
    const redgen = map['redgen'] ?? 0;
    const tx = map['tx'] ?? 0;
    return { total: informativos + ejecutivos + redgen + tx, informativos, ejecutivos, redgen, tx };
  }

  async getAttachment(emailId: string, attachmentId: string): Promise<Attachment> {
    const att = await this.attachmentRepo.findOne({
      where: { id: attachmentId, emailId },
    });
    if (!att) throw new NotFoundException('Adjunto no encontrado');
    return att;
  }
}
