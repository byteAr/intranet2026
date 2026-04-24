import { Controller, Post, Body, Req, ForbiddenException, BadRequestException } from '@nestjs/common';
import { AnnouncementsGateway } from './announcements.gateway';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly gateway: AnnouncementsGateway) {}

  @Post('broadcast')
  broadcast(@Body() body: { message: string }, @Req() req: any) {
    if (req.user.username !== 'mlopez') {
      throw new ForbiddenException('Solo el administrador puede enviar anuncios');
    }
    if (!body.message?.trim()) {
      throw new BadRequestException('El mensaje no puede estar vacío');
    }
    const senderName = req.user.displayName ?? req.user.username;
    this.gateway.broadcast(body.message.trim(), senderName);
    return { ok: true };
  }
}
