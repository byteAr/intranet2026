import { Controller, Post, Body, Req, ForbiddenException, BadRequestException } from '@nestjs/common';
import { AnnouncementsGateway } from './announcements.gateway';
import { NotificationsService } from '../notifications/notifications.service';

@Controller('announcements')
export class AnnouncementsController {
  constructor(
    private readonly gateway: AnnouncementsGateway,
    private readonly notifications: NotificationsService,
  ) {}

  @Post('broadcast')
  broadcast(@Body() body: { message: string }, @Req() req: any) {
    if (req.user.username !== 'mlopez') {
      throw new ForbiddenException('Solo el administrador puede enviar anuncios');
    }
    if (!body.message?.trim()) {
      throw new BadRequestException('El mensaje no puede estar vacío');
    }
    const senderName = req.user.displayName ?? req.user.username;
    const message = body.message.trim();
    this.gateway.broadcast(message, senderName);
    // También queda en la campanita de cada usuario (y llega por push), así
    // lo ve quien no estaba conectado y se puede volver a abrir.
    void this.notifications.notifyAllActive({
      type: 'announcement',
      title: `Anuncio de ${senderName}`,
      body: message,
      data: { message, senderName, sentAt: new Date().toISOString() },
    });
    return { ok: true };
  }
}
