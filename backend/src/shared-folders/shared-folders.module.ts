import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedFoldersController } from './shared-folders.controller';
import { SharedFoldersService } from './shared-folders.service';
import { GoogleDriveService } from './google-drive.service';
import { OfficeDrive } from './entities/office-drive.entity';
import { GroupPermission } from '../admin/entities/group-permission.entity';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [TypeOrmModule.forFeature([OfficeDrive, GroupPermission]), AdminModule],
  controllers: [SharedFoldersController],
  providers: [SharedFoldersService, GoogleDriveService],
})
export class SharedFoldersModule {}
