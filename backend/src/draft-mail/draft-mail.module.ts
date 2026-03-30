import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DraftEmail } from './entities/draft-email.entity';
import { DraftEmailAttachment } from './entities/draft-email-attachment.entity';
import { DraftMailAuthorizer } from './entities/draft-mail-authorizer.entity';
import { Email } from '../mail/entities/email.entity';
import { DraftMailService } from './draft-mail.service';
import { DraftMailController } from './draft-mail.controller';
import { DraftMailGateway } from './draft-mail.gateway';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DraftEmail, DraftEmailAttachment, DraftMailAuthorizer, Email]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
      }),
    }),
    MailModule,
  ],
  controllers: [DraftMailController],
  providers: [DraftMailService, DraftMailGateway],
  exports: [DraftMailService],
})
export class DraftMailModule {}
