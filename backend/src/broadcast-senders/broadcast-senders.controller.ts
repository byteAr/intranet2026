import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req } from '@nestjs/common';
import { BroadcastSendersService } from './broadcast-senders.service';

@Controller('broadcast-senders')
export class BroadcastSendersController {
  constructor(private readonly senders: BroadcastSendersService) {}

  /** Si el usuario conectado puede enviar anuncios y mensajes a todos (botones del menú). */
  @Get('me')
  async me(@Req() req: any) {
    return {
      canSend: await this.senders.canSend(req.user?.username),
      canManage: this.senders.isOwner(req.user?.username),
    };
  }

  @Get()
  list(@Req() req: any) {
    this.assertOwner(req);
    return this.senders.list();
  }

  @Post()
  async add(@Req() req: any, @Body() body: { username?: string; displayName?: string }) {
    this.assertOwner(req);
    const username = body.username?.trim();
    if (!username || !/^[a-zA-Z0-9._-]+$/.test(username)) throw new BadRequestException('Usuario inválido');
    if (this.senders.isOwner(username)) throw new BadRequestException('Ese usuario ya puede enviar siempre');
    await this.senders.add(username, body.displayName ?? username, req.user.username);
    return { ok: true };
  }

  @Delete(':username')
  async remove(@Req() req: any, @Param('username') username: string) {
    this.assertOwner(req);
    await this.senders.remove(username, req.user.username);
    return { ok: true };
  }

  private assertOwner(req: any): void {
    if (!this.senders.isOwner(req.user?.username)) {
      throw new ForbiddenException('Solo mlopez decide quién puede enviar anuncios');
    }
  }
}
