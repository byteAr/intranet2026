import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Message } from './entities/message.entity';
import { BroadcastMessage } from './entities/broadcast-message.entity';
import { BroadcastDelivery } from './entities/broadcast-delivery.entity';
import { ChatService } from './chat.service';
import { BroadcastDmService } from './broadcast-dm.service';
import { ChatGateway } from './chat.gateway';
import { ChatController } from './chat.controller';
import { UsersModule } from '../users/users.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, BroadcastMessage, BroadcastDelivery]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
      }),
    }),
    UsersModule,
    PushModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, BroadcastDmService, ChatGateway],
  exports: [ChatService, BroadcastDmService],
})
export class ChatModule {}
