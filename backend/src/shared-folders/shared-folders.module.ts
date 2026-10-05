import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedFoldersController } from './shared-folders.controller';
import { SharedFoldersService } from './shared-folders.service';
import { SharesService } from './shares.service';
import { GoogleDriveService } from './google-drive.service';
import { FolderDownloadService } from './folder-download.service';
import { JwtModule } from '@nestjs/jwt';
import { OfficeDrive } from './entities/office-drive.entity';
import { SharedItem } from './entities/shared-item.entity';
import { GroupPermission } from '../admin/entities/group-permission.entity';
import { User } from '../users/entities/user.entity';
import { AdminModule } from '../admin/admin.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OfficeDrive, SharedItem, GroupPermission, User]),
    AdminModule,
    NotificationsModule,
    // Para los enlaces de descarga; el secreto se pasa al firmar (ver FolderDownloadService).
    JwtModule.register({}),
  ],
  controllers: [SharedFoldersController],
  providers: [SharedFoldersService, SharesService, GoogleDriveService, FolderDownloadService],
})
export class SharedFoldersModule {}
