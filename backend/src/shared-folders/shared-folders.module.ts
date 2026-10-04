import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedFoldersController } from './shared-folders.controller';
import { SharedFoldersService } from './shared-folders.service';
import { SharesService } from './shares.service';
import { GoogleDriveService } from './google-drive.service';
import { OfficeDrive } from './entities/office-drive.entity';
import { SharedItem } from './entities/shared-item.entity';
import { GroupPermission } from '../admin/entities/group-permission.entity';
import { User } from '../users/entities/user.entity';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [TypeOrmModule.forFeature([OfficeDrive, SharedItem, GroupPermission, User]), AdminModule],
  controllers: [SharedFoldersController],
  providers: [SharedFoldersService, SharesService, GoogleDriveService],
})
export class SharedFoldersModule {}
