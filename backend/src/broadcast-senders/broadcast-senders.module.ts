import { Global, Module } from '@nestjs/common';
import { BroadcastSendersController } from './broadcast-senders.controller';
import { BroadcastSendersService } from './broadcast-senders.service';

/** Global: lo consultan los anuncios y el "Mensaje a todos" del chat. */
@Global()
@Module({
  controllers: [BroadcastSendersController],
  providers: [BroadcastSendersService],
  exports: [BroadcastSendersService],
})
export class BroadcastSendersModule {}
