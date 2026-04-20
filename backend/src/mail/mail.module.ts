import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Email } from './entities/email.entity';
import { Attachment } from './entities/attachment.entity';
import { EmailReadStatus } from './entities/email-read-status.entity';
import { EmailReference } from './entities/email-reference.entity';
import { PstImportLog } from './entities/pst-import-log.entity';
import { MailPendingSend } from './entities/mail-pending-send.entity';
import { MailParserService } from './mail-parser.service';
import { ImapPollerService } from './imap-poller.service';
import { MailIngestService } from './mail-ingest.service';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { DecryptedAttachment } from './entities/decrypted-attachment.entity';
import { DecryptedAttachmentService } from './decrypted-attachment.service';
import { SienaFile } from './entities/siena-file.entity';
import { SienaFileService } from './siena-file.service';
import { MailGateway } from './mail.gateway';
import { SmtpSenderService } from './smtp-sender.service';
import { LdapRecipientsService } from './ldap-recipients.service';
import { BridgeSecretGuard } from './guards/bridge-secret.guard';
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
      MailPendingSend,
      DecryptedAttachment,
      SienaFile,
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
  providers: [MailParserService, MailIngestService, ImapPollerService, MailService, MailGateway, SmtpSenderService, LdapRecipientsService, BridgeSecretGuard, PstImportService, DecryptedAttachmentService, SienaFileService],
  exports: [MailParserService, MailIngestService, ImapPollerService, MailService, SmtpSenderService],
})
export class MailModule {}
