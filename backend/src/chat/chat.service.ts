import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ChatAttachment, Message } from './entities/message.entity';

export interface SaveMessageDto {
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  recipientId?: string;
  content: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  attachmentMimeType?: string;
  attachments?: ChatAttachment[];
}

/** Archivos que subió /api/chat/upload: /api/chat/files/<uuid>.<ext>. */
const CHAT_FILE_URL = /^\/api\/chat\/files\/[0-9a-f-]{36}(\.[A-Za-z0-9]{1,8})?$/i;
const MAX_ATTACHMENTS = 10;

/** Valida la lista que manda el navegador: solo archivos subidos al chat, hasta 10. */
export function sanitizeChatAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((a): a is ChatAttachment => !!a && typeof a.url === 'string' && CHAT_FILE_URL.test(a.url))
    .slice(0, MAX_ATTACHMENTS)
    .map((a) => ({
      url: a.url,
      name: String(a.name ?? 'archivo').slice(0, 255),
      size: Number(a.size) || 0,
      mimeType: String(a.mimeType ?? 'application/octet-stream').slice(0, 120),
    }));
}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async saveMessage(dto: SaveMessageDto): Promise<Message> {
    const msg = new Message();
    msg.senderId = dto.senderId;
    msg.senderName = dto.senderName;
    msg.senderAvatar = dto.senderAvatar ?? undefined;
    msg.recipientId = dto.recipientId ?? undefined;
    msg.content = dto.content;
    // Varios adjuntos: el primero también en las columnas de siempre (ver la entidad)
    const first = dto.attachments?.[0];
    msg.attachmentUrl = first?.url ?? dto.attachmentUrl;
    msg.attachmentName = first?.name ?? dto.attachmentName;
    msg.attachmentSize = first?.size ?? dto.attachmentSize;
    msg.attachmentMimeType = first?.mimeType ?? dto.attachmentMimeType;
    msg.attachments = dto.attachments?.length ? dto.attachments : null;
    msg.readBy = [dto.senderId];
    return this.messageRepo.save(msg);
  }

  async getHistory(userId: string, recipientId?: string): Promise<Message[]> {
    if (recipientId) {
      // DM: los 100 mensajes más recientes entre userId y recipientId
      const msgs = await this.messageRepo
        .createQueryBuilder('m')
        .where(
          '(m.senderId = :a AND m.recipientId = :b) OR (m.senderId = :b AND m.recipientId = :a)',
          { a: userId, b: recipientId },
        )
        .orderBy('m.createdAt', 'DESC')
        .take(100)
        .getMany();
      return msgs.reverse();
    }
    // Global: los 200 mensajes más recientes sin recipientId
    const global = await this.messageRepo.find({
      where: { recipientId: IsNull() },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return global.reverse();
  }

  async markRead(messageId: string, userId: string): Promise<void> {
    const msg = await this.messageRepo.findOne({ where: { id: messageId } });
    if (!msg) return;
    if (!msg.readBy.includes(userId)) {
      msg.readBy = [...msg.readBy, userId];
      await this.messageRepo.save(msg);
    }
  }

  /** Returns IDs of all users the given user has chatted with (DMs + global senders) */
  async getContactIds(userId: string): Promise<string[]> {
    const rows = await this.messageRepo
      .createQueryBuilder('m')
      .select(`DISTINCT CASE
        WHEN "m"."recipientId" = :userId THEN "m"."senderId"
        WHEN "m"."senderId" = :userId AND "m"."recipientId" IS NOT NULL THEN "m"."recipientId"
        ELSE "m"."senderId"
      END`, 'id')
      .where(
        '(m.recipientId = :userId) OR (m.senderId = :userId AND m.recipientId IS NOT NULL) OR (m.recipientId IS NULL AND m.senderId != :userId)',
        { userId },
      )
      .getRawMany<{ id: string }>();

    return rows.map((r) => r.id).filter(Boolean);
  }

  /** Returns the last DM message for each conversation of the user */
  async getLastDmMessages(userId: string): Promise<Record<string, Message>> {
    const messages = await this.messageRepo
      .createQueryBuilder('m')
      .where('(m.senderId = :userId OR m.recipientId = :userId) AND m.recipientId IS NOT NULL', { userId })
      .orderBy('m.createdAt', 'DESC')
      .take(500)
      .getMany();

    const last: Record<string, Message> = {};
    for (const msg of messages) {
      const otherUserId = msg.senderId === userId ? msg.recipientId! : msg.senderId;
      if (otherUserId && !last[otherUserId]) {
        last[otherUserId] = msg;
      }
    }
    return last;
  }

  async getUnreadCount(userId: string): Promise<number> {
    const all = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.senderId != :userId', { userId })
      .andWhere(
        '(m.recipientId = :userId OR m.recipientId IS NULL)',
        { userId },
      )
      .getMany();
    return all.filter((m) => !m.readBy.includes(userId)).length;
  }

  /** Returns unread counts per conversation key: senderId for DMs, 'global' for global */
  async getUnreadSummary(userId: string): Promise<Record<string, number>> {
    const messages = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.senderId != :userId', { userId })
      .andWhere('(m.recipientId = :userId OR m.recipientId IS NULL)', { userId })
      .getMany();

    const counts: Record<string, number> = {};
    messages.forEach((m) => {
      if (!m.readBy.includes(userId)) {
        const key = m.recipientId ? m.senderId : 'global';
        counts[key] = (counts[key] ?? 0) + 1;
      }
    });
    return counts;
  }
}
