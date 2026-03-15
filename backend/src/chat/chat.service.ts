import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Message } from './entities/message.entity';

export interface SaveMessageDto {
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  recipientId?: string;
  content: string;
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
    msg.readBy = [dto.senderId];
    return this.messageRepo.save(msg);
  }

  async getHistory(userId: string, recipientId?: string): Promise<Message[]> {
    if (recipientId) {
      // DM: mensajes entre userId y recipientId en ambas direcciones
      return this.messageRepo
        .createQueryBuilder('m')
        .where(
          '(m.senderId = :a AND m.recipientId = :b) OR (m.senderId = :b AND m.recipientId = :a)',
          { a: userId, b: recipientId },
        )
        .orderBy('m.createdAt', 'ASC')
        .take(50)
        .getMany();
    }
    // Global: mensajes sin recipientId
    return this.messageRepo.find({
      where: { recipientId: IsNull() },
      order: { createdAt: 'ASC' },
      take: 50,
    });
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
      .select('DISTINCT m.senderId', 'id')
      .where('m.recipientId = :userId', { userId })
      .getRawMany<{ id: string }>();

    const sent = await this.messageRepo
      .createQueryBuilder('m')
      .select('DISTINCT m.recipientId', 'id')
      .where('m.senderId = :userId AND m.recipientId IS NOT NULL', { userId })
      .getRawMany<{ id: string }>();

    const global = await this.messageRepo
      .createQueryBuilder('m')
      .select('DISTINCT m.senderId', 'id')
      .where('m.recipientId IS NULL AND m.senderId != :userId', { userId })
      .getRawMany<{ id: string }>();

    const ids = new Set([
      ...rows.map((r) => r.id),
      ...sent.map((r) => r.id),
      ...global.map((r) => r.id),
    ].filter(Boolean));

    return Array.from(ids);
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
