import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import { existsSync } from 'fs';
import { Email } from './entities/email.entity';
import { Attachment } from './entities/attachment.entity';
import { EmailReadStatus } from './entities/email-read-status.entity';
import { EmailReference } from './entities/email-reference.entity';
import { DecryptedAttachment } from './entities/decrypted-attachment.entity';
import { decryptedDisplayName } from './decrypted-name.util';
import { SienaFile } from './entities/siena-file.entity';
import { SienaFileService } from './siena-file.service';
import { QueryEmailsDto } from './dto/query-emails.dto';
import { cp1252SqlRepair } from './mail-text.util';
import { argentinaYear } from '../common/argentina-time';

/**
 * Versión del índice de búsqueda. Cambiarla fuerza, una sola vez y en segundo
 * plano, la reparación de caracteres y la reindexación de todos los correos.
 */
const FTS_VERSION = 'fts:v3';

/** Marcadores del resaltado: caracteres de control que el ingreso ya elimina del texto. */
const HL_START = '\u0002';
const HL_STOP = '\u0003';
const HEADLINE_OPTIONS =
  `StartSel="${HL_START}", StopSel="${HL_STOP}", MaxWords=30, MinWords=12, ` +
  `ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "`;

type SearchConfig = 'es_unaccent' | 'simple';

@Injectable()
export class MailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailService.name);

  /** 'es_unaccent' ignora tildes; 'simple' es el respaldo si no se pudo crear la extensión. */
  private searchConfig: SearchConfig = 'simple';

  /**
   * Los correos ingresados antes de esta fecha cuentan como leídos para todos
   * (MAIL_UNREAD_SINCE). Sin ella, cada usuario arrastraba como "no leído"
   * todo el correo del año cargado antes de que existiera el seguimiento.
   */
  private readonly unreadCutoff: Date | null;

  constructor(
    @InjectRepository(Email)
    private readonly emailRepo: Repository<Email>,
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(EmailReadStatus)
    private readonly readStatusRepo: Repository<EmailReadStatus>,
    @InjectRepository(EmailReference)
    private readonly referenceRepo: Repository<EmailReference>,
    @InjectRepository(DecryptedAttachment)
    private readonly decryptedRepo: Repository<DecryptedAttachment>,
    @InjectRepository(SienaFile)
    private readonly sienaRepo: Repository<SienaFile>,
    private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    const raw = configService.get<string>('MAIL_UNREAD_SINCE');
    const fecha = raw ? new Date(raw) : null;
    if (raw && (!fecha || isNaN(fecha.getTime()))) {
      this.logger.warn(`MAIL_UNREAD_SINCE inválida ("${raw}"); se ignora`);
    }
    this.unreadCutoff = fecha && !isNaN(fecha.getTime()) ? fecha : null;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureMarkTables();
    try {
      this.searchConfig = await this.ensureSearchConfig();
      await this.ensureTrigramIndexes();
      await this.installSearchTrigger();
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_emails_search_vector ON emails USING GIN (search_vector)`,
      );
      this.logger.log(`FTS: listo con la configuración '${this.searchConfig}'`);
    } catch (err) {
      this.logger.error('FTS: failed to initialize', (err as Error).message);
      return;
    }
    // Puede tardar varios minutos con cientos de miles de correos: no bloquea
    // el arranque. Mientras corre, la búsqueda funciona con el índice anterior.
    void this.migrateSearchData();
  }

  /**
   * Tablas sin entidad (staging no sincroniza):
   * - mail_read_marks: "Marcar todo como leído" de cada usuario. Lo ingresado
   *   antes de esa fecha cuenta como leído para él, sin crear una fila por
   *   correo (así no aparece en "Visto por" de cosas que no abrió).
   * - mail_flags: la banderita de TICOM (compartida entre ellos), como en Outlook.
   */
  private async ensureMarkTables(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "mail_read_marks" (
          "userId" character varying PRIMARY KEY,
          "readAllAt" TIMESTAMP WITH TIME ZONE NOT NULL
        )`);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "mail_flags" (
          "emailId" character varying PRIMARY KEY,
          "flaggedBy" character varying NOT NULL,
          "flaggedByName" character varying NOT NULL,
          "flaggedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )`);
    } catch (err) {
      this.logger.error(`No se pudieron crear mail_read_marks / mail_flags: ${(err as Error).message}`);
    }
  }

  /** Corte de "no leídos" para este usuario: el global (MAIL_UNREAD_SINCE) o su "Marcar todo como leído", el más nuevo. */
  private async cutoffFor(userId: string): Promise<Date | null> {
    let mark: Date | null = null;
    try {
      const [row] = await this.dataSource.query(`SELECT "readAllAt" FROM "mail_read_marks" WHERE "userId" = $1`, [userId]);
      mark = row?.readAllAt ? new Date(row.readAllAt) : null;
    } catch {
      /* sin la tabla, solo el corte global */
    }
    if (!mark) return this.unreadCutoff;
    if (!this.unreadCutoff) return mark;
    return mark > this.unreadCutoff ? mark : this.unreadCutoff;
  }

  /** Todo lo que llegó hasta ahora cuenta como leído para este usuario (las 4 carpetas). */
  async markAllRead(userId: string) {
    await this.dataSource.query(
      `INSERT INTO "mail_read_marks" ("userId", "readAllAt") VALUES ($1, now())
       ON CONFLICT ("userId") DO UPDATE SET "readAllAt" = EXCLUDED."readAllAt"`,
      [userId],
    );
    return this.getUnreadCounts(userId);
  }

  // ─── Banderita (solo TICOM) ────────────────────────────────────────────────

  async setFlag(emailId: string, user: { id: string; username: string; displayName?: string; firstName?: string; lastName?: string }) {
    const email = await this.emailRepo.findOne({ where: { id: emailId }, select: ['id'] });
    if (!email) throw new NotFoundException('Correo no encontrado');
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username;
    await this.dataSource.query(
      `INSERT INTO "mail_flags" ("emailId", "flaggedBy", "flaggedByName", "flaggedAt") VALUES ($1, $2, $3, now())
       ON CONFLICT ("emailId") DO UPDATE SET "flaggedBy" = EXCLUDED."flaggedBy", "flaggedByName" = EXCLUDED."flaggedByName", "flaggedAt" = now()`,
      [emailId, user.username, name],
    );
    return (await this.flagsOf([emailId])).get(emailId) ?? null;
  }

  async clearFlag(emailId: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM "mail_flags" WHERE "emailId" = $1`, [emailId]);
  }

  private async flagsOf(ids: string[]): Promise<Map<string, { byName: string; at: Date }>> {
    if (!ids.length) return new Map();
    try {
      const rows: { emailId: string; flaggedByName: string; flaggedAt: Date }[] = await this.dataSource.query(
        `SELECT "emailId", "flaggedByName", "flaggedAt" FROM "mail_flags" WHERE "emailId" = ANY($1::varchar[])`,
        [ids],
      );
      return new Map(rows.map((r) => [r.emailId, { byName: r.flaggedByName, at: r.flaggedAt }]));
    } catch {
      return new Map();
    }
  }

  private static isTicom(roles?: string[]): boolean {
    return (roles ?? []).some((r) => r.toUpperCase() === 'TICOM');
  }

  /**
   * Configuración de texto que ignora tildes: "tactica" encuentra "TÁCTICAS".
   * Se basa en 'simple' (sin stopwords ni raíces) porque la 'spanish' descartaba
   * abreviaturas como "ES", "DE" o "AL" que forman parte de los códigos de MTO.
   */
  private async ensureSearchConfig(): Promise<SearchConfig> {
    try {
      await this.dataSource.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
      await this.dataSource.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'es_unaccent') THEN
            CREATE TEXT SEARCH CONFIGURATION es_unaccent (COPY = simple);
            ALTER TEXT SEARCH CONFIGURATION es_unaccent
              ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;
          END IF;
        END $$;
      `);
      return 'es_unaccent';
    } catch (err) {
      this.logger.warn(
        `FTS: no se pudo habilitar unaccent (${(err as Error).message}); ` +
          `se usa 'simple' y la búsqueda distinguirá tildes`,
      );
      return 'simple';
    }
  }

  /**
   * Índices de trigramas para que los códigos de MTO y los nombres de adjuntos
   * se busquen por índice y no recorriendo la tabla entera. Son opcionales: sin
   * ellos la búsqueda funciona igual, solo más lento.
   */
  private async ensureTrigramIndexes(): Promise<void> {
    try {
      await this.dataSource.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_emails_mailcode_trgm ON emails USING GIN ("mailCode" gin_trgm_ops)`,
      );
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_attachments_filename_trgm ON attachments USING GIN (filename gin_trgm_ops)`,
      );
    } catch (err) {
      this.logger.warn(`FTS: sin índices de trigramas (${(err as Error).message})`);
    }
  }

  /**
   * El asunto y el código pesan más que el remitente, y el remitente más que el
   * cuerpo: una coincidencia en el asunto aparece antes que una perdida en el
   * texto. Del remitente se indexa solo la parte local ("DIRTICOM"): el dominio
   * @MTO.GNA está en todos los correos y haría que cualquier búsqueda coincida.
   */
  private async installSearchTrigger(): Promise<void> {
    const cfg = this.searchConfig;
    await this.dataSource.query(`
      CREATE OR REPLACE FUNCTION emails_search_vector_update() RETURNS trigger AS $$
      BEGIN
        -- ${FTS_VERSION}:${cfg}
        NEW.search_vector :=
          setweight(to_tsvector('${cfg}', coalesce(NEW."mailCode", '')), 'A') ||
          setweight(to_tsvector('${cfg}', coalesce(NEW.subject, '')), 'A') ||
          setweight(to_tsvector('${cfg}', split_part(coalesce(NEW."fromAddress", ''), '@', 1)), 'B') ||
          setweight(to_tsvector('${cfg}', coalesce(left(NEW."bodyText", 50000), '')), 'D');
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
  }

  /**
   * Migración única: repara los caracteres mal decodificados de los correos ya
   * guardados y recalcula el índice de todos con la configuración nueva. La
   * marca se escribe al terminar, así que si el proceso se corta a la mitad se
   * retoma entera en el próximo arranque.
   */
  private async migrateSearchData(): Promise<void> {
    const marca = `${FTS_VERSION}:${this.searchConfig}`;
    try {
      // La marca va en una tabla propia: antes era el comentario de "emails",
      // pero la sincronización de TypeORM lo borra en cada arranque (la entidad
      // no declara comentario) y la reindexación se repetía siempre.
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "app_markers" (
          "key" varchar PRIMARY KEY,
          "value" text NOT NULL,
          "updatedAt" timestamptz NOT NULL DEFAULT now()
        )`);
      const [fila] = await this.dataSource.query(`SELECT "value" AS marca FROM "app_markers" WHERE "key" = 'emails.fts'`);
      if (fila?.marca === marca) return;

      this.logger.log('FTS: reparando caracteres y reindexando correos en segundo plano...');
      const inicio = Date.now();
      const reparados = await this.repairMailEncoding();
      const reindexados = await this.rebuildSearchVectors();
      await this.dataSource.query(
        `INSERT INTO "app_markers" ("key", "value") VALUES ('emails.fts', $1)
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`,
        [marca],
      );
      this.logger.log(
        `FTS: migración completa en ${Math.round((Date.now() - inicio) / 1000)} s — ` +
          `${reparados} correos con caracteres reparados, ${reindexados} reindexados`,
      );
    } catch (err) {
      this.logger.error(
        'FTS: la migración falló; se reintenta en el próximo arranque',
        (err as Error).message,
      );
    }
  }

  /** Aplica a los correos existentes la misma limpieza que hoy se hace al ingresarlos. */
  private async repairMailEncoding(): Promise<number> {
    const { translateFrom, translateTo, c0Pattern, dirtyPattern } = cp1252SqlRepair();
    const limpiar = (col: string) =>
      `CASE WHEN ${col} ~ $4 THEN regexp_replace(translate(${col}, $1, $2), $3, '', 'g') ELSE ${col} END`;

    const [{ n }] = await this.dataSource.query(
      `WITH reparados AS (
         UPDATE emails SET
           subject    = ${limpiar('subject')},
           "bodyText" = ${limpiar('"bodyText"')},
           "bodyHtml" = ${limpiar('"bodyHtml"')}
         WHERE subject ~ $4 OR "bodyText" ~ $4 OR "bodyHtml" ~ $4
         RETURNING 1
       )
       SELECT count(*)::int AS n FROM reparados`,
      [translateFrom, translateTo, c0Pattern, dirtyPattern],
    );
    return n;
  }

  /**
   * Recalcula el índice en lotes de 1000 para no bloquear la tabla entera. El
   * UPDATE no cambia ningún dato: solo dispara el trigger, que regenera el vector.
   */
  private async rebuildSearchVectors(): Promise<number> {
    let ultimoId = '00000000-0000-0000-0000-000000000000';
    let total = 0;
    for (;;) {
      const [{ n, ultimo }] = await this.dataSource.query(
        `WITH lote AS (SELECT id FROM emails WHERE id > $1 ORDER BY id LIMIT 1000),
              tocados AS (
                UPDATE emails e SET "mailCode" = e."mailCode"
                FROM lote WHERE e.id = lote.id
                RETURNING e.id
              )
         SELECT count(*)::int AS n, max(id::text) AS ultimo FROM tocados`,
        [ultimoId],
      );
      if (n === 0) break;
      total += n;
      ultimoId = ultimo;
    }
    return total;
  }

  async findAll(
    dto: QueryEmailsDto,
    userId: string,
    roles?: string[],
  ): Promise<{ data: Email[]; total: number; page: number; limit: number }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 30;
    const offset = (page - 1) * limit;

    const searchTerm = dto.q?.trim() || null;

    // El estado de lectura NO se carga con un JOIN: con skip/take, TypeORM
    // pagina los JOIN mediante una subconsulta DISTINCT que descarta el orden
    // por relevancia de la búsqueda. Se carga aparte en attachReadStatuses().
    const qb = this.emailRepo
      .createQueryBuilder('e')
      .select([
        'e.id', 'e.internetMessageId', 'e.mailCode', 'e.subject',
        'e.fromAddress', 'e.toAddresses', 'e.ccAddresses',
        'e.date', 'e.folder', 'e.isFromPstImport', 'e.createdAt',
      ])
      .skip(offset)
      .take(limit);

    if (dto.folder) {
      qb.andWhere('e.folder = :folder', { folder: dto.folder });
    }

    const currentYear = argentinaYear();
    const hasAdvancedDate = !!(dto.year || dto.dateFrom || dto.dateTo);

    if (dto.year) {
      qb.andWhere('EXTRACT(YEAR FROM e.date) = :exactYear', { exactYear: dto.year });
    } else if (!hasAdvancedDate) {
      if (dto.historical) {
        qb.andWhere('EXTRACT(YEAR FROM e.date) < :year', { year: currentYear });
      } else if (!searchTerm) {
        qb.andWhere('EXTRACT(YEAR FROM e.date) = :year', { year: currentYear });
      }
    }

    if (dto.dateFrom) {
      qb.andWhere('e.date >= :dateFrom', { dateFrom: new Date(dto.dateFrom + 'T00:00:00') });
    }
    if (dto.dateTo) {
      qb.andWhere('e.date <= :dateTo', { dateTo: new Date(dto.dateTo + 'T23:59:59') });
    }

    if (dto.sender?.trim()) {
      qb.andWhere('e.fromAddress = :sender', { sender: dto.sender.trim() });
    }

    if (searchTerm) {
      this.applySearch(qb, searchTerm);
    } else {
      qb.orderBy('e.date', 'DESC');
    }

    qb.loadRelationCountAndMap('e.attachmentCount', 'e.attachments');

    const [data, total] = await qb.getManyAndCount();

    // Para históricos no se sigue la lectura: el frontend los muestra todos como leídos.
    if (!dto.historical) await this.attachReadStatuses(data, userId);
    if (searchTerm) await this.attachSnippets(data, searchTerm);
    // La banderita la ven solo TICOM.
    if (MailService.isTicom(roles)) {
      const flags = await this.flagsOf(data.map((e) => e.id));
      for (const e of data) (e as any).flag = flags.get(e.id) ?? null;
    }

    return { data, total, page, limit };
  }

  /**
   * Texto del buscador → tsquery. `websearch_to_tsquery` entiende la sintaxis
   * que la gente ya usa ("frase exacta", -excluir, OR) y tokeniza igual que el
   * índice. Después se le agrega `:*` a cada término de 2+ letras para que
   * coincida por prefijo: "desconv" encuentra "desconvoca" mientras se escribe.
   */
  private tsquerySql(param: string): string {
    const cfg = this.searchConfig;
    return (
      `regexp_replace(websearch_to_tsquery('${cfg}', ${param})::text, ` +
      `'''([^'']{2,})''', '''\\1'':*', 'g')::tsquery`
    );
  }

  /**
   * Cada fuente de coincidencia (texto, código de MTO, nombre de adjunto) se
   * resuelve con su propio índice y se unen los resultados. Antes estaban
   * combinadas con OR en el WHERE, y el EXISTS sobre adjuntos obligaba a
   * PostgreSQL a recorrer la tabla de correos entera en cada búsqueda.
   *
   * Orden: primero los que coinciden exactamente con el código de MTO buscado,
   * después por relevancia (asunto > remitente > cuerpo), y a igualdad, los
   * más recientes.
   */
  private applySearch(qb: SelectQueryBuilder<Email>, searchTerm: string): void {
    const tsquery = this.tsquerySql(':searchTerm');

    // Código de MTO con límites de palabra: "ES 32" no debe encontrar "SES 32"
    // (lookbehind) ni "ES 2408/24" al buscar "ES 240" (lookahead).
    const escapado = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mailCodePattern = `(?<![a-zA-Z0-9])${escapado}(?![0-9])`;
    const attTerm = `%${searchTerm.replace(/[\\%_]/g, '\\$&')}%`;

    qb.andWhere(
      `e.id IN (
         SELECT s.id FROM emails s WHERE s.search_vector @@ ${tsquery}
         UNION
         SELECT c.id FROM emails c WHERE c."mailCode" ~* :mailCodePattern
         UNION
         SELECT att."emailId" FROM attachments att WHERE att.filename ILIKE :attTerm
       )`,
      { searchTerm, mailCodePattern, attTerm },
    )
      .addSelect(`CASE WHEN e."mailCode" ~* :mailCodePattern THEN 1 ELSE 0 END`, 'coincide_codigo')
      .addSelect(`ts_rank_cd(e.search_vector, ${tsquery})`, 'relevancia')
      .orderBy('coincide_codigo', 'DESC')
      .addOrderBy('relevancia', 'DESC')
      .addOrderBy('e.date', 'DESC');
  }

  /**
   * Estado de lectura del usuario para la página actual. Lo anterior al corte
   * (MAIL_UNREAD_SINCE) y lo importado desde PST cuenta como leído: no es
   * correo nuevo para nadie.
   */
  private async attachReadStatuses(emails: Email[], userId: string): Promise<void> {
    if (emails.length === 0) return;

    const ids = emails.map((e) => e.id);
    const estados = await this.readStatusRepo.find({
      select: { emailId: true, isRead: true, readAt: true },
      where: { userId, emailId: In(ids) },
    });
    const porCorreo = new Map(estados.map((s) => [s.emailId, s]));

    // Se decide en SQL y no en JavaScript por la zona horaria: ver cutoffSql().
    const corte = await this.cutoffFor(userId);
    const filas: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM emails
        WHERE id = ANY($1::uuid[])
          AND ("isFromPstImport" OR ($2::timestamptz IS NOT NULL AND "createdAt" < ${this.cutoffSql('$2')}))`,
      [ids, corte?.toISOString() ?? null],
    );
    const leidosPorDefecto = new Set(filas.map((f) => f.id));

    for (const email of emails) {
      const estado = porCorreo.get(email.id);
      if (estado) {
        email.readStatuses = [estado];
      } else if (leidosPorDefecto.has(email.id)) {
        email.readStatuses = [{ isRead: true } as EmailReadStatus];
      } else {
        email.readStatuses = [];
      }
    }
  }

  /**
   * La fecha de corte expresada para comparar contra `createdAt`.
   *
   * `@CreateDateColumn` crea en PostgreSQL una columna SIN zona horaria que se
   * llena con now() en la zona de la sesión. Comparar directamente contra una
   * fecha con zona descarta el desplazamiento y corre el corte unas horas; así
   * se convierte primero a la misma zona en la que se guardó el dato.
   */
  private cutoffSql(param: string): string {
    return `(CAST(${param} AS timestamptz) AT TIME ZONE current_setting('TimeZone'))`;
  }

  /**
   * Fragmento del cuerpo con los términos resaltados, para mostrar en la lista
   * por qué coincidió cada correo. Se calcula solo para la página visible.
   * Los marcadores son caracteres de control que el frontend reemplaza por
   * <mark> después de escapar el HTML.
   */
  private async attachSnippets(emails: Email[], searchTerm: string): Promise<void> {
    if (emails.length === 0) return;

    const filas: { id: string; snippet: string }[] = await this.dataSource.query(
      `SELECT id, ts_headline('${this.searchConfig}', left(coalesce("bodyText", ''), 20000),
                              ${this.tsquerySql('$2')}, $3) AS snippet
         FROM emails WHERE id = ANY($1::uuid[])`,
      [emails.map((e) => e.id), searchTerm, HEADLINE_OPTIONS],
    );
    const porCorreo = new Map(filas.map((f) => [f.id, f.snippet]));
    for (const email of emails) {
      Object.assign(email, { snippet: porCorreo.get(email.id) ?? '' });
    }
  }

  async groupedBySender(folder?: string, historical?: boolean): Promise<{ sender: string; count: number; lastDate: string }[]> {
    const qb = this.emailRepo
      .createQueryBuilder('e')
      .select('e.fromAddress', 'sender')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(e.date)', 'lastDate')
      .groupBy('e.fromAddress')
      .orderBy('e.fromAddress', 'ASC');

    if (folder) qb.andWhere('e.folder = :folder', { folder });

    const currentYear = argentinaYear();
    if (historical) {
      qb.andWhere('EXTRACT(YEAR FROM e.date) < :year', { year: currentYear });
    } else {
      qb.andWhere('EXTRACT(YEAR FROM e.date) = :year', { year: currentYear });
    }

    const rows = await qb.getRawMany<{ sender: string; count: string; lastDate: string }>();
    const mapped = rows.map(r => ({ sender: r.sender ?? '', count: parseInt(r.count, 10), lastDate: r.lastDate }));
    // Remitentes vacíos al final
    return [...mapped.filter(r => r.sender), ...mapped.filter(r => !r.sender)];
  }

  async findOne(id: string, userId: string, userRoles?: string[]): Promise<Email> {
    const email = await this.emailRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.attachments', 'att')
      .leftJoinAndSelect('e.readStatuses', 'rs', 'rs.userId = :userId', { userId })
      .leftJoinAndSelect('e.outgoingRefs', 'ref')
      .where('e.id = :id', { id })
      .getOne();

    if (!email) throw new NotFoundException('Correo no encontrado');

    // Enriquecer adjuntos .~00 con hasDecrypted para TICOM y ENCRIPTADO
    const canSeeDecrypted = userRoles?.some((r) => r === 'TICOM' || r === 'ENCRIPTADO') ?? false;
    if (canSeeDecrypted && email.attachments?.length) {
      const encryptedIds = email.attachments
        .filter((a) => /\.\~\d{2}$/.test(a.filename))
        .map((a) => a.id);
      if (encryptedIds.length > 0) {
        const decryptedRows = await this.decryptedRepo.find({
          where: encryptedIds.map((aid) => ({ attachmentId: aid })),
          select: ['id', 'attachmentId', 'storagePath', 'filename', 'size', 'uploadedByName', 'uploadedAt'],
          order: { uploadedAt: 'ASC' },
        });
        // Solo cuenta si el archivo existe: hasta el 06/10/2026 se guardaban fuera
        // de un volumen y se perdieron al recrear el backend. Así figuran como
        // pendientes y TICOM los puede volver a subir.
        const decryptedOf = new Map<string, { id: string; filename: string; displayName: string; size: number; uploadedByName: string; uploadedAt: Date }[]>();
        for (const d of decryptedRows) {
          if (!existsSync(d.storagePath)) continue;
          const list = decryptedOf.get(d.attachmentId) ?? [];
          list.push({
            id: d.id,
            filename: d.filename,
            displayName: decryptedDisplayName(d.filename, d.storagePath, email.bodyText),
            size: d.size,
            uploadedByName: d.uploadedByName,
            uploadedAt: d.uploadedAt,
          });
          decryptedOf.set(d.attachmentId, list);
        }
        // Puede haber varios por adjunto: un .rar encriptado trae varios documentos.
        (email as any).attachments = email.attachments.map((att) => {
          if (!/\.~\d{2}$/.test(att.filename)) return att;
          const decryptedFiles = decryptedOf.get(att.id) ?? [];
          return { ...att, hasDecrypted: decryptedFiles.length > 0, decryptedFiles };
        });
      }
    }

    // Incluir archivos SIENA para TICOM y ENCRIPTADO si el email es de tipo SIENA
    if (canSeeDecrypted && SienaFileService.isSienaBody(email.bodyText)) {
      const siena = await this.sienaRepo.find({
        where: { emailId: id },
        order: { uploadedAt: 'ASC' },
      });
      // Sin la ruta del servidor, y solo los que existen en disco (ver arriba).
      (email as any).sienaFiles = siena
        .filter((f) => existsSync(f.storagePath))
        .map(({ id: fileId, filename, size, uploadedByName, uploadedAt }) => ({ id: fileId, filename, size, uploadedByName, uploadedAt }));
    }

    // La banderita la ven solo TICOM.
    if (MailService.isTicom(userRoles)) {
      (email as any).flag = (await this.flagsOf([email.id])).get(email.id) ?? null;
    }

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

  /**
   * Quiénes abrieron el MTO y cuándo (la primera vez), del más antiguo al más
   * nuevo. Sin la foto (es base64): solo si tiene, para pedirla a /users/:id/avatar.
   */
  async getViewers(emailId: string): Promise<
    { userId: string; username: string; name: string; hasAvatar: boolean; readAt: Date }[]
  > {
    const email = await this.emailRepo.findOne({ where: { id: emailId }, select: ['id'] });
    if (!email) throw new NotFoundException('Correo no encontrado');
    const rows: { userId: string; username: string; displayName: string | null; firstName: string | null; lastName: string | null; hasAvatar: boolean; readAt: Date }[] =
      await this.dataSource.query(
        `SELECT u.id AS "userId", u.username, u."displayName", u."firstName", u."lastName",
                (u.avatar IS NOT NULL AND u.avatar <> '') AS "hasAvatar", rs."readAt"
           FROM email_read_status rs
           JOIN users u ON u.id::text = rs."userId"::text
          WHERE rs."emailId"::text = $1 AND rs."isRead" = true AND rs."readAt" IS NOT NULL
          ORDER BY rs."readAt" ASC`,
        [emailId],
      );
    return rows.map((r) => ({
      userId: r.userId,
      username: r.username,
      name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.displayName || r.username,
      hasAvatar: !!r.hasAvatar,
      readAt: r.readAt,
    }));
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
    const currentYear = argentinaYear();
    // Mismo criterio que attachReadStatuses(): lo importado desde PST y lo
    // ingresado antes del corte no es correo nuevo.
    const qb = this.emailRepo
      .createQueryBuilder('e')
      .select('e.folder', 'folder')
      .addSelect('COUNT(*)', 'count')
      .leftJoin('e.readStatuses', 'rs', 'rs.userId = :userId', { userId })
      .where('EXTRACT(YEAR FROM e.date) = :year', { year: currentYear })
      .andWhere('(rs.id IS NULL OR rs."isRead" = false)')
      .andWhere('e."isFromPstImport" = false')
      .groupBy('e.folder');

    // El corte global o el "Marcar todo como leído" del usuario, el más nuevo.
    const corte = await this.cutoffFor(userId);
    if (corte) {
      qb.andWhere(`e."createdAt" >= ${this.cutoffSql(':corte')}`, {
        corte: corte.toISOString(),
      });
    }

    const rows = await qb.getRawMany<{ folder: string; count: string }>();

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
