import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, In, IsNull, LessThan, Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { User } from '../users/entities/user.entity';
import { PushService } from '../push/push.service';
import { NotificationsGateway } from './notifications.gateway';

/** Las notificaciones más viejas que esto se borran. */
const RETENTION_DAYS = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Solo se notifica lo que sale de "Enviar anuncio" (09/10/2026). Compartir,
 * subir a la oficina y los escaneos no avisan: ni campanita, ni en vivo, ni push.
 * Para volver a prenderlos, agregar el tipo acá.
 */
const NOTIFIED_TYPES: NotificationType[] = ['announcement'];

export interface NewNotification {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}

/**
 * Campanita de notificaciones: guarda una fila por destinatario, la entrega
 * en vivo por /notifications y manda la notificación push (el service worker
 * solo la muestra si la intranet no está a la vista).
 */
@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly gateway: NotificationsGateway,
    private readonly push: PushService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  /** Con NODE_ENV=production TypeORM no sincroniza: la tabla se crea acá si falta. */
  async onApplicationBootstrap(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "username" varchar NOT NULL,
        "type" varchar NOT NULL,
        "title" varchar NOT NULL,
        "body" text NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}',
        "readAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )`);
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS "idx_notifications_user_date" ON "notifications" ("username", "createdAt")`,
    );
  }

  // ─── Enviar ────────────────────────────────────────────────────────────────

  async notify(usernames: string[], input: NewNotification): Promise<void> {
    if (!NOTIFIED_TYPES.includes(input.type)) return;
    const onlyTo = this.onlyTo();
    const unique = [...new Set(usernames.map((u) => u.toLowerCase()).filter(Boolean))].filter(
      (u) => !onlyTo || onlyTo.has(u),
    );
    if (!unique.length) return;
    const rows = await this.repo.save(
      unique.map((username) =>
        this.repo.create({ username, type: input.type, title: input.title, body: input.body, data: input.data ?? {} }),
      ),
    );
    for (const row of rows) this.gateway.toUser(row.username, this.toDto(row));
    void this.sendPush(rows);
  }

  /**
   * NOTIFICATIONS_ONLY_TO (usuarios separados por coma) limita a quiénes se
   * notifica. Es para staging: comparte la base con producción, incluidas las
   * suscripciones push, y sin esto un anuncio de prueba le llegaría a todos.
   */
  private onlyTo(): Set<string> | null {
    const raw = this.config.get<string>('NOTIFICATIONS_ONLY_TO')?.trim();
    return raw ? new Set(raw.split(',').map((u) => u.trim().toLowerCase()).filter(Boolean)) : null;
  }

  /**
   * Aviso en vivo para que una pantalla abierta se actualice sola: no se guarda,
   * no suena ni manda push, y no depende de NOTIFIED_TYPES. Va a todas las
   * sesiones: el payload no debe llevar nada que no pueda ver cualquiera.
   */
  signal(event: string, payload: Record<string, unknown>): void {
    this.gateway.broadcast(event, payload);
  }

  /** Igual que signal(), pero solo a esos usuarios (cuando el payload trae nombres de archivos). */
  signalTo(usernames: string[], event: string, payload: Record<string, unknown>): void {
    for (const u of new Set(usernames.map((x) => x.toLowerCase()).filter(Boolean))) this.gateway.toUserEvent(u, event, payload);
  }

  /** A todos los usuarios activos de la intranet (los anuncios). */
  async notifyAllActive(input: NewNotification): Promise<void> {
    const users = await this.userRepo.find({ where: { isActive: true }, select: ['username'] });
    await this.notify(users.map((u) => u.username), input);
  }

  private async sendPush(rows: Notification[]): Promise<void> {
    try {
      const users = await this.userRepo
        .createQueryBuilder('u')
        .select(['u.id', 'u.username'])
        .where('LOWER(u.username) IN (:...names)', { names: rows.map((r) => r.username) })
        .getMany();
      const idByName = new Map(users.map((u) => [u.username.toLowerCase(), u.id]));
      await Promise.allSettled(
        rows
          .filter((r) => idByName.has(r.username))
          .map((r) =>
            this.push.sendToUser(idByName.get(r.username)!, {
              title: r.title,
              body: r.body.length > 180 ? `${r.body.slice(0, 177)}…` : r.body,
              data: { onActionClick: { default: { operation: 'openWindow', url: this.linkFor(r) } } },
            }),
          ),
      );
    } catch (err) {
      this.logger.warn(`No se pudieron enviar las notificaciones push: ${(err as Error).message}`);
    }
  }

  /** A dónde lleva la notificación push al tocarla. */
  private linkFor(n: Notification): string {
    if (n.type === 'share') return `/archivos?compartido=${n.data['shareId']}&notificacion=${n.id}`;
    if (n.type === 'upload') {
      const fileIds = (n.data['fileIds'] as string[] | undefined) ?? [];
      const params = new URLSearchParams({
        oficina: String(n.data['groupName'] ?? ''),
        carpeta: String(n.data['folderId'] ?? ''),
        archivo: fileIds[0] ?? '',
        notificacion: n.id,
      });
      return `/archivos?${params.toString()}`;
    }
    if (n.type === 'scan') {
      const params = new URLSearchParams({
        escaneos: String(n.data['groupName'] ?? ''),
        escaneo: String(n.data['scanId'] ?? ''),
        notificacion: n.id,
      });
      return `/archivos?${params.toString()}`;
    }
    return `/cuenta?notificacion=${n.id}`;
  }

  // ─── Leer ──────────────────────────────────────────────────────────────────

  async list(username: string, limit = 30): Promise<{ items: NotificationDto[]; unread: number }> {
    const name = username.toLowerCase();
    // Las de los tipos que ya no se notifican (compartir, escaneos) quedan en la tabla pero no se muestran.
    const type = In(NOTIFIED_TYPES);
    const [rows, unread] = await Promise.all([
      this.repo.find({ where: { username: name, type }, order: { createdAt: 'DESC' }, take: Math.min(limit, 100) }),
      this.repo.count({ where: { username: name, type, readAt: IsNull() } }),
    ]);
    return { items: rows.map((r) => this.toDto(r)), unread };
  }

  async get(username: string, id: string): Promise<NotificationDto> {
    const row = UUID.test(id) ? await this.repo.findOne({ where: { id, username: username.toLowerCase() } }) : null;
    if (!row) throw new NotFoundException('La notificación no existe.');
    return this.toDto(row);
  }

  async markRead(username: string, id: string): Promise<void> {
    if (!UUID.test(id)) return;
    await this.repo.update({ id, username: username.toLowerCase(), readAt: IsNull() }, { readAt: new Date() });
  }

  async markAllRead(username: string): Promise<void> {
    await this.repo.update({ username: username.toLowerCase(), readAt: IsNull() }, { readAt: new Date() });
  }

  @Cron('30 3 * * *')
  async purgeOld(): Promise<void> {
    const limit = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.repo.delete({ createdAt: LessThan(limit) });
  }

  private toDto(n: Notification): NotificationDto {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data ?? {},
      read: !!n.readAt,
      createdAt: n.createdAt,
    };
  }
}
