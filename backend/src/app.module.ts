import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomThrottlerGuard } from './common/custom-throttler.guard';
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
import { DailyReportModule } from './daily-report/daily-report.module';
import { DailyReport } from './daily-report/entities/daily-report.entity';
import { DailyReportEntry } from './daily-report/entities/daily-report-entry.entity';
import { SituationType } from './daily-report/entities/situation-type.entity';
import { ActiveSituation } from './daily-report/entities/active-situation.entity';
import { NonWorkingDay } from './daily-report/entities/non-working-day.entity';
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
import { DraftMailSigner } from './draft-mail/entities/draft-mail-signer.entity';

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
        entities: [User, Message, BroadcastMessage, BroadcastDelivery, Incident, Reservation, BlockedPeriod, PushSubscription, Email, Attachment, EmailReadStatus, EmailReference, PstImportLog, MailPendingSend, DecryptedAttachment, SienaFile, DraftEmail, DraftEmailAttachment, DraftMailSigner, Department, AdminAuditLog, GroupPermission, DailyReport, DailyReportEntry, SituationType, ActiveSituation, NonWorkingDay],
        synchronize: configService.get<string>('app.nodeEnv') !== 'production',
        logging: configService.get<string>('app.nodeEnv') === 'development',
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 300, // Límite general permisivo — auth endpoints lo sobreescriben con @Throttle()
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
    DailyReportModule,
  ],
  providers: [
    // Apply JwtAuthGuard globally; routes marked @Public() bypass it
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
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
