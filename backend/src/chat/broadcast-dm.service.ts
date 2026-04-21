import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BroadcastMessage } from './entities/broadcast-message.entity';
import { BroadcastDelivery } from './entities/broadcast-delivery.entity';
import { ChatService } from './chat.service';
import { Message } from './entities/message.entity';

export interface CreateBroadcastDto {
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  attachmentMimeType?: string;
}

@Injectable()
export class BroadcastDmService {
  constructor(
    @InjectRepository(BroadcastMessage)
    private readonly bcRepo: Repository<BroadcastMessage>,
    @InjectRepository(BroadcastDelivery)
    private readonly deliveryRepo: Repository<BroadcastDelivery>,
  ) {}

  async create(dto: CreateBroadcastDto): Promise<BroadcastMessage> {
    const bc = this.bcRepo.create(dto);
    return this.bcRepo.save(bc);
  }

  /**
   * Entrega todos los broadcasts pendientes (no entregados) a un usuario.
   * Se llama al conectar al chat — garantiza que usuarios nuevos o que
   * no estaban en la DB cuando se envió el broadcast lo reciban igual.
   */
  async deliverPendingToUser(
    userId: string,
    chatService: ChatService,
    emitFn?: (msg: Message) => void,
  ): Promise<void> {
    const pending = await this.bcRepo
      .createQueryBuilder('bc')
      .where((qb) => {
        const sub = qb
          .subQuery()
          .select('d.broadcastId')
          .from(BroadcastDelivery, 'd')
          .where('d.userId = :userId')
          .getQuery();
        return `bc.id NOT IN ${sub}`;
      })
      .setParameter('userId', userId)
      .orderBy('bc.createdAt', 'ASC')
      .getMany();

    for (const bc of pending) {
      try {
        // Insertar delivery primero — si falla por unique constraint,
        // significa que otro proceso ya entregó este broadcast a este usuario
        await this.deliveryRepo.save(
          this.deliveryRepo.create({ broadcastId: bc.id, userId }),
        );
      } catch {
        // Unique constraint violation: ya entregado, saltar
        continue;
      }
      const msg = await chatService.saveMessage({
        senderId: bc.senderId,
        senderName: bc.senderName,
        senderAvatar: bc.senderAvatar,
        recipientId: userId,
        content: bc.content,
        attachmentUrl: bc.attachmentUrl ?? undefined,
        attachmentName: bc.attachmentName ?? undefined,
        attachmentSize: bc.attachmentSize ?? undefined,
        attachmentMimeType: bc.attachmentMimeType ?? undefined,
      });
      emitFn?.(msg);
    }
  }
}
