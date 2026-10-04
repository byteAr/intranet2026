import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Request } from '@nestjs/common';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from './notifications.service';

type AuthRequest = { user: User };

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@Request() req: AuthRequest, @Query('limit') limit?: string) {
    return this.service.list(req.user.username, Number(limit) || 30);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async readAll(@Request() req: AuthRequest) {
    await this.service.markAllRead(req.user.username);
  }

  @Get(':id')
  get(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.get(req.user.username, id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async read(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.service.markRead(req.user.username, id);
  }
}
