import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { PermissionsController } from './permissions.controller';
import { AdminService } from './admin.service';
import { GoogleWorkspaceService } from './google-workspace.service';
import { WelcomeEmailService } from './welcome-email.service';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { GroupPermission } from './entities/group-permission.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, AdminAuditLog, GroupPermission])],
  controllers: [AdminController, PermissionsController],
  providers: [AdminService, GoogleWorkspaceService, WelcomeEmailService],
})
export class AdminModule {}
