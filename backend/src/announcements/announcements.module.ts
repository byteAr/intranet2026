import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AnnouncementsGateway } from './announcements.gateway';
import { AnnouncementsController } from './announcements.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsGateway],
})
export class AnnouncementsModule {}
