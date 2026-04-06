import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
      await this.dataSource.query(`
        CREATE OR REPLACE FUNCTION emails_search_vector_update() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector := to_tsvector('simple',
            coalesce(NEW.subject, '') || ' ' ||
            coalesce(NEW."bodyText", '') || ' ' ||
            coalesce(NEW."fromAddress", '') || ' ' ||
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

      const { count } = await this.dataSource
        .query(`SELECT COUNT(*) AS count FROM emails WHERE search_vector IS NULL`)
        .then((r: { count: string }[]) => r[0]);

      if (parseInt(count, 10) > 0) {
        await this.dataSource.query(`
          UPDATE emails SET search_vector = to_tsvector('simple',
            coalesce(subject, '') || ' ' ||
            coalesce("bodyText", '') || ' ' ||
            coalesce("fromAddress", '') || ' ' ||
            coalesce("mailCode", '')
          ) WHERE search_vector IS NULL
        `);
        this.logger.log(`FTS: search_vector backfilled for ${count} emails`);
      }

      this.logger.log('FTS: trigger and search_vector ready');
    } catch (err) {
      this.logger.error('FTS: failed to initialize search_vector trigger', (err as Error).message);
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
      const term = dto.q.trim();
      qb.andWhere(
        `e.search_vector @@ plainto_tsquery('simple', :term)`,
        { term },
      );
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
