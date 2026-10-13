import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Email } from './entities/email.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertTerm, MIN_TERM_LENGTH, normalizeForAlert, PreparedText, prepareText, termMatches } from './mail-alert-match.util';
import { extractAttachmentText } from './attachment-text.util';

/** Tope de términos por usuario. */
const MAX_TERMS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AlertTermDto {
  id: string;
  term: string;
  allWords: boolean;
  createdAt: Date;
}

export interface FollowDto {
  emailId: string;
  mailCode: string | null;
  subject: string;
  date: Date | null;
  /** Lo siguió el usuario (false: se sumó solo porque citaba a uno que sigue). */
  manual: boolean;
  followedAt: Date;
}

/**
 * Avisos de MTO en la campanita (09/10/2026), cada usuario los suyos:
 * - Seguir un MTO (megáfono): avisa cuando llega uno que lo cita como
 *   referencia o una corrección con el mismo código (SVC). El que llega queda
 *   seguido también, así se sigue la cadena de respuestas.
 * - Mis alertas: términos (DNI, nombre, expediente...) que se buscan en el
 *   asunto, el cuerpo y los nombres de los adjuntos de cada MTO nuevo.
 * Solo para lo que llega desde ahora (MailIngestService): no revisa lo guardado.
 * Tablas sin entidad (staging no sincroniza): mail_follows, mail_alert_terms.
 */
@Injectable()
export class MailAlertsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailAlertsService.name);

  constructor(
    @InjectRepository(Email) private readonly emailRepo: Repository<Email>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "mail_follows" (
          "username" character varying NOT NULL,
          "emailId" uuid NOT NULL,
          "manual" boolean NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          PRIMARY KEY ("username", "emailId")
        )`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "idx_mail_follows_email" ON "mail_follows" ("emailId")`);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "mail_alert_terms" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "username" character varying NOT NULL,
          "term" character varying NOT NULL,
          "allWords" boolean NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "idx_mail_alert_terms_user" ON "mail_alert_terms" ("username")`);
    } catch (err) {
      this.logger.error(`No se pudieron crear las tablas de alertas de MTO: ${(err as Error).message}`);
    }
  }

  // ─── Seguir un MTO ─────────────────────────────────────────────────────────

  async isFollowing(username: string, emailId: string): Promise<boolean> {
    try {
      const rows = await this.dataSource.query(
        `SELECT 1 FROM "mail_follows" WHERE "username" = $1 AND "emailId" = $2`,
        [username.toLowerCase(), emailId],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  async follow(username: string, emailId: string): Promise<{ following: true }> {
    const email = await this.emailRepo.findOne({ where: { id: emailId }, select: ['id'] });
    if (!email) throw new NotFoundException('MTO no encontrado');
    await this.dataSource.query(
      `INSERT INTO "mail_follows" ("username", "emailId", "manual") VALUES ($1, $2, true)
       ON CONFLICT ("username", "emailId") DO UPDATE SET "manual" = true`,
      [username.toLowerCase(), emailId],
    );
    return { following: true };
  }

  async unfollow(username: string, emailId: string): Promise<{ following: false }> {
    await this.dataSource.query(`DELETE FROM "mail_follows" WHERE "username" = $1 AND "emailId" = $2`, [
      username.toLowerCase(),
      emailId,
    ]);
    return { following: false };
  }

  async listFollows(username: string): Promise<FollowDto[]> {
    return this.dataSource.query(
      `SELECT f."emailId", e."mailCode", e.subject, e.date, f.manual, f."createdAt" AS "followedAt"
         FROM "mail_follows" f JOIN emails e ON e.id = f."emailId"
        WHERE f."username" = $1
        ORDER BY f."createdAt" DESC`,
      [username.toLowerCase()],
    );
  }

  // ─── Mis alertas ───────────────────────────────────────────────────────────

  async listTerms(username: string): Promise<AlertTermDto[]> {
    return this.dataSource.query(
      `SELECT id, term, "allWords", "createdAt" FROM "mail_alert_terms" WHERE "username" = $1 ORDER BY "createdAt"`,
      [username.toLowerCase()],
    );
  }

  private cleanTerm(term: string): string {
    const clean = String(term ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (normalizeForAlert(clean).length < MIN_TERM_LENGTH) {
      throw new BadRequestException(`Escribí al menos ${MIN_TERM_LENGTH} letras o números.`);
    }
    return clean;
  }

  async addTerm(username: string, term: string, allWords: boolean): Promise<AlertTermDto> {
    const clean = this.cleanTerm(term);
    const mine = await this.listTerms(username);
    if (mine.length >= MAX_TERMS) throw new BadRequestException(`Se pueden tener hasta ${MAX_TERMS} alertas.`);
    if (mine.some((t) => normalizeForAlert(t.term) === normalizeForAlert(clean) && t.allWords === !!allWords)) {
      throw new BadRequestException('Ya tenés esa alerta.');
    }
    const [row] = await this.dataSource.query(
      `INSERT INTO "mail_alert_terms" ("username", "term", "allWords") VALUES ($1, $2, $3)
       RETURNING id, term, "allWords", "createdAt"`,
      [username.toLowerCase(), clean, !!allWords],
    );
    return row;
  }

  async updateTerm(username: string, id: string, term: string, allWords: boolean): Promise<AlertTermDto> {
    if (!UUID.test(id)) throw new NotFoundException('Alerta no encontrada');
    const clean = this.cleanTerm(term);
    const rows: AlertTermDto[] = await this.dataSource.query(
      `UPDATE "mail_alert_terms" SET "term" = $3, "allWords" = $4 WHERE id = $1 AND "username" = $2
       RETURNING id, term, "allWords", "createdAt"`,
      [id, username.toLowerCase(), clean, !!allWords],
    );
    // Con RETURNING, TypeORM devuelve [filas, cantidad]
    const row = Array.isArray(rows[0]) ? (rows[0] as unknown as AlertTermDto[])[0] : rows[0];
    if (!row) throw new NotFoundException('Alerta no encontrada');
    return row;
  }

  async removeTerm(username: string, id: string): Promise<void> {
    if (!UUID.test(id)) return;
    await this.dataSource.query(`DELETE FROM "mail_alert_terms" WHERE id = $1 AND "username" = $2`, [
      id,
      username.toLowerCase(),
    ]);
  }

  // ─── Un MTO nuevo ──────────────────────────────────────────────────────────

  /**
   * Lo llama MailIngestService con cada MTO que entra (ya con sus referencias
   * guardadas). Una sola notificación por usuario, con todos los motivos.
   */
  async onNewEmail(email: Email): Promise<void> {
    try {
      const { reasons, followersOf } = await this.reasonsFor(email);
      if (!reasons.size) return;

      // La cadena: quien seguía al citado sigue también al nuevo (avisa de las respuestas a la respuesta).
      for (const username of followersOf) {
        await this.dataSource.query(
          `INSERT INTO "mail_follows" ("username", "emailId", "manual") VALUES ($1, $2, false) ON CONFLICT DO NOTHING`,
          [username, email.id],
        );
      }

      const code = email.mailCode ?? email.subject;
      for (const [username, list] of reasons) {
        await this.notifications.notify([username], {
          type: 'mto',
          title: `Llegó el MTO ${code}`,
          body: `${list.join(' · ')}. ${email.subject}`.slice(0, 500),
          data: { emailId: email.id, mailCode: email.mailCode ?? null },
        });
      }
      this.logger.log(`Alertas de MTO: ${email.mailCode ?? email.id} avisado a ${reasons.size} usuario(s)`);
    } catch (err) {
      this.logger.warn(`Alertas de MTO: no se pudo avisar ${email.id}: ${(err as Error).message}`);
    }
  }

  /** Por qué se le avisa a cada usuario por este MTO. followersOf: quienes lo siguen por citar a uno que seguían. */
  private async reasonsFor(email: Email) {
    const reasons = new Map<string, string[]>();
    const add = (username: string, reason: string) => {
      const list = reasons.get(username) ?? [];
      if (!list.includes(reason)) list.push(reason);
      reasons.set(username, list);
    };

    // 1) MTO seguidos: los que cita este (referencias resueltas) y los de su mismo código (SVC).
    const related: { emailId: string; mailCode: string | null; subject: string }[] = await this.dataSource.query(
      `SELECT DISTINCT e.id AS "emailId", e."mailCode", e.subject FROM emails e
        WHERE e.id::text <> $1 AND (
              e.id::text IN (SELECT "referencedEmailId"::text FROM email_references
                              WHERE "emailId"::text = $1 AND "referencedEmailId" IS NOT NULL)
           OR ($2::text IS NOT NULL AND e."mailCode" = $2))`,
      [email.id, email.mailCode ?? null],
    );
    const followersOf = new Set<string>();
    if (related.length) {
      const follows: { username: string; emailId: string }[] = await this.dataSource.query(
        `SELECT "username", "emailId" FROM "mail_follows" WHERE "emailId" = ANY($1::uuid[])`,
        [related.map((r) => r.emailId)],
      );
      const byId = new Map(related.map((r) => [r.emailId, r]));
      for (const f of follows) {
        const r = byId.get(f.emailId);
        if (!r) continue;
        add(f.username, `relacionado con ${r.mailCode ?? r.subject}, que seguís`);
        followersOf.add(f.username);
      }
    }

    // 2) Términos de "Mis alertas".
    const terms: (AlertTerm & { username: string })[] = await this.dataSource.query(
      `SELECT "username", "term", "allWords" FROM "mail_alert_terms"`,
    );
    if (terms.length) {
      const sources = await this.textSources(email);
      for (const t of terms) {
        const where = sources.filter((s) => termMatches(s.prepared, t)).map((s) => s.label);
        if (where.length) add(t.username, `tu alerta «${t.term}» aparece en ${listEs(where)}`);
      }
    }
    return { reasons, followersOf };
  }

  /**
   * Dónde se buscan los términos, cada lugar por separado para poder decir
   * dónde apareció: el asunto, el texto del MTO y cada adjunto (su contenido
   * si es PDF, Word, Excel o texto, y su nombre). Los cifrados .~NN solo por el
   * nombre. Los desencriptados y los de SIENA no: los ven solo TICOM y
   * ENCRIPTADO, y avisar que un término está ahí ya revelaría su contenido.
   */
  private async textSources(email: Email): Promise<{ label: string; prepared: PreparedText }[]> {
    const sources: { label: string; prepared: PreparedText }[] = [];
    if (email.subject) sources.push({ label: 'el asunto', prepared: prepareText(email.subject) });
    if (email.bodyText) sources.push({ label: 'el texto del MTO', prepared: prepareText(email.bodyText) });
    const atts: { filename: string; storagePath: string }[] = await this.dataSource.query(
      `SELECT filename, "storagePath" FROM attachments WHERE "emailId"::text = $1 ORDER BY filename`,
      [email.id],
    );
    for (const a of atts.slice(0, MAX_ATTACHMENTS_READ)) {
      const content = await extractAttachmentText(a.storagePath, a.filename);
      // El nombre y el contenido juntos: si aparece en cualquiera de los dos, "en el adjunto «X»"
      sources.push({ label: `el adjunto «${a.filename}»`, prepared: prepareText(`${a.filename}\n${content ?? ''}`) });
    }
    return sources;
  }
}

/** Cuántos adjuntos de un MTO se revisan como mucho (los que pasen de eso no se revisan). */
const MAX_ATTACHMENTS_READ = 15;

/** "a", "a y b", "a, b y c"; más de 4: los 3 primeros "y N lugares más". */
function listEs(items: string[]): string {
  if (items.length > 4) return `${items.slice(0, 3).join(', ')} y ${items.length - 3} lugares más`;
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}
