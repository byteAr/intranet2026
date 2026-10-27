import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { SharedFoldersModule } from '../shared-folders/shared-folders.module';
import { MtoBackupController } from './mto-backup.controller';
import { MtoBackupService } from './mto-backup.service';

/** Respaldo nocturno de los MTO en Google Drive (ver MtoBackupService). */
@Module({
  imports: [MailModule, SharedFoldersModule],
  controllers: [MtoBackupController],
  providers: [MtoBackupService],
})
export class MtoBackupModule {}
