import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** El único que decide quién más puede enviar (y que siempre puede). */
export const BROADCAST_OWNER = 'mlopez';

export interface BroadcastSender {
  username: string;
  displayName: string;
  addedBy: string;
  addedAt: Date;
}

/**
 * Quién puede enviar "Enviar anuncio" (cartel naranja + campanita) y "Mensaje a
 * todos" (un mensaje de Conversaciones a cada usuario). Hasta el 15/10/2026 era
 * solo mlopez, fijo en el código; ahora mlopez elige a otros desde
 * Administración → Anuncios. Tabla sin entidad, creada al arrancar.
 */
@Injectable()
export class BroadcastSendersService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastSendersService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "broadcast_senders" (
        "username" character varying PRIMARY KEY,
        "displayName" character varying NOT NULL,
        "addedBy" character varying NOT NULL,
        "addedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )`);
  }

  isOwner(username: string | undefined): boolean {
    return (username ?? '').toLowerCase() === BROADCAST_OWNER;
  }

  async canSend(username: string | undefined): Promise<boolean> {
    const u = (username ?? '').toLowerCase();
    if (!u) return false;
    if (this.isOwner(u)) return true;
    const [row] = await this.dataSource.query(`SELECT 1 FROM "broadcast_senders" WHERE "username" = $1`, [u]);
    return !!row;
  }

  list(): Promise<BroadcastSender[]> {
    return this.dataSource.query(
      `SELECT "username", "displayName", "addedBy", "addedAt" FROM "broadcast_senders" ORDER BY "displayName"`,
    );
  }

  async add(username: string, displayName: string, by: string): Promise<void> {
    const u = username.trim().toLowerCase();
    await this.dataSource.query(
      `INSERT INTO "broadcast_senders" ("username", "displayName", "addedBy") VALUES ($1, $2, $3)
       ON CONFLICT ("username") DO UPDATE SET "displayName" = EXCLUDED."displayName"`,
      [u, displayName.trim() || u, by],
    );
    this.logger.log(`${by} habilitó a ${u} para enviar anuncios y mensajes a todos`);
  }

  async remove(username: string, by: string): Promise<void> {
    const u = username.trim().toLowerCase();
    await this.dataSource.query(`DELETE FROM "broadcast_senders" WHERE "username" = $1`, [u]);
    this.logger.log(`${by} quitó a ${u} de los que envían anuncios y mensajes a todos`);
  }
}
