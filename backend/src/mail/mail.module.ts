import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Email } from './entities/email.entity';
import { Attachment } from './entities/attachment.entity';
import { EmailReadStatus } from './entities/email-read-status.entity';
import { EmailReference } from './entities/email-reference.entity';
import { PstImportLog } from './entities/pst-import-log.entity';
import { MailParserService } from './mail-parser.service';
import { ImapPollerService } from './imap-poller.service';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailGateway } from './mail.gateway';
import { SmtpSenderService } from './smtp-sender.service';
import { PstImportService } from './admin/pst-import.service';
import { PstImportController } from './admin/pst-import.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Email,
      Attachment,
      EmailReadStatus,
      EmailReference,
      PstImportLog,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [MailController, PstImportController],
  providers: [MailParserService, ImapPollerService, MailService, MailGateway, SmtpSenderService, PstImportService],
  exports: [MailParserService, ImapPollerService, MailService, SmtpSenderService],
})
export class MailModule {}
