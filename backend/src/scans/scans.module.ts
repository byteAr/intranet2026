import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';
import { Scan } from './entities/scan.entity';
import { ScanAccount } from './entities/scan-account.entity';
import { GroupPermission } from '../admin/entities/group-permission.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SharedFoldersModule } from '../shared-folders/shared-folders.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Scan, ScanAccount, GroupPermission, User]),
    NotificationsModule,
    // "Guardar en Archivos": sube la copia a la unidad de la oficina o a Mis archivos.
    SharedFoldersModule,
  ],
  controllers: [ScansController],
  providers: [ScansService],
})
export class ScansModule {}
