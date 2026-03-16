import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reservation } from './entities/reservation.entity';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { ReservationsGateway } from './reservations.gateway';
import { ReservationsEmailService } from './reservations-email.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
      }),
    }),
    UsersModule,
  ],
  controllers: [ReservationsController],
  providers: [ReservationsService, ReservationsGateway, ReservationsEmailService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
