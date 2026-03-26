import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Email } from './entities/email.entity';
import { Attachment } from './entities/attachment.entity';
import { EmailReadStatus } from './entities/email-read-status.entity';
import { EmailReference } from './entities/email-reference.entity';
import { QueryEmailsDto } from './dto/query-emails.dto';

@Injectable()
export class MailService {
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
      .leftJoin('e.readStatuses', 'rs', 'rs.userId = :userId', { userId })
      .addSelect(['rs.isRead', 'rs.readAt'])
      .orderBy('e.date', 'DESC')
      .skip(offset)
      .take(limit);

    if (dto.folder) {
      qb.andWhere('e.folder = :folder', { folder: dto.folder });
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

  async getAttachment(emailId: string, attachmentId: string): Promise<Attachment> {
    const att = await this.attachmentRepo.findOne({
      where: { id: attachmentId, emailId },
    });
    if (!att) throw new NotFoundException('Adjunto no encontrado');
    return att;
  }
}
