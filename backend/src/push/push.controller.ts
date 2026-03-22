import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Request } from '@nestjs/common';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('vapid-public-key')
  getVapidKey() {
    return { key: this.pushService.getVapidPublicKey() };
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  async subscribe(
    @Request() req: { user: { id: string } },
    @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    await this.pushService.subscribe(req.user.id, body);
    return { message: 'Suscripción registrada' };
  }

  @Delete('unsubscribe')
  @HttpCode(HttpStatus.OK)
  async unsubscribe(
    @Request() req: { user: { id: string } },
    @Body() body: { endpoint: string },
  ) {
    await this.pushService.unsubscribe(req.user.id, body.endpoint);
    return { message: 'Suscripción eliminada' };
  }
}
