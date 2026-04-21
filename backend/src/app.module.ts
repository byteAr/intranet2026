import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import ldapConfig from './config/ldap.config';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChatModule } from './chat/chat.module';
import { IncidentsModule } from './incidents/incidents.module';
import { ReservationsModule } from './reservations/reservations.module';
import { PushModule } from './push/push.module';
import { MailModule } from './mail/mail.module';
import { DraftMailModule } from './draft-mail/draft-mail.module';
import { AdminModule } from './admin/admin.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { User } from './users/entities/user.entity';
import { Department } from './admin/entities/department.entity';
import { AdminAuditLog } from './admin/entities/admin-audit-log.entity';
import { GroupPermission } from './admin/entities/group-permission.entity';
import { Message } from './chat/entities/message.entity';
import { BroadcastMessage } from './chat/entities/broadcast-message.entity';
import { BroadcastDelivery } from './chat/entities/broadcast-delivery.entity';
import { Incident } from './incidents/entities/incident.entity';
import { Reservation } from './reservations/entities/reservation.entity';
import { BlockedPeriod } from './reservations/entities/blocked-period.entity';
import { PushSubscription } from './push/entities/push-subscription.entity';
import { Email } from './mail/entities/email.entity';
import { Attachment } from './mail/entities/attachment.entity';
import { EmailReadStatus } from './mail/entities/email-read-status.entity';
import { EmailReference } from './mail/entities/email-reference.entity';
import { PstImportLog } from './mail/entities/pst-import-log.entity';
import { MailPendingSend } from './mail/entities/mail-pending-send.entity';
import { DecryptedAttachment } from './mail/entities/decrypted-attachment.entity';
import { SienaFile } from './mail/entities/siena-file.entity';
import { DraftEmail } from './draft-mail/entities/draft-email.entity';
import { DraftEmailAttachment } from './draft-mail/entities/draft-email-attachment.entity';
import { DraftMailAuthorizer } from './draft-mail/entities/draft-mail-authorizer.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, ldapConfig],
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        database: configService.get<string>('database.database'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        entities: [User, Message, BroadcastMessage, BroadcastDelivery, Incident, Reservation, BlockedPeriod, PushSubscription, Email, Attachment, EmailReadStatus, EmailReference, PstImportLog, MailPendingSend, DecryptedAttachment, SienaFile, DraftEmail, DraftEmailAttachment, DraftMailAuthorizer, Department, AdminAuditLog, GroupPermission],
        synchronize: configService.get<string>('app.nodeEnv') !== 'production',
        logging: configService.get<string>('app.nodeEnv') === 'development',
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    ChatModule,
    IncidentsModule,
    ReservationsModule,
    PushModule,
    MailModule,
    DraftMailModule,
    AdminModule,
    AnnouncementsModule,
  ],
  providers: [
    // Apply JwtAuthGuard globally; routes marked @Public() bypass it
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
