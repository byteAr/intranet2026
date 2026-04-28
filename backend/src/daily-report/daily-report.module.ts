import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyReportController } from './daily-report.controller';
import { DailyReportService } from './daily-report.service';
import { DailyReport } from './entities/daily-report.entity';
import { DailyReportEntry } from './entities/daily-report-entry.entity';
import { SituationType } from './entities/situation-type.entity';
import { ActiveSituation } from './entities/active-situation.entity';
import { NonWorkingDay } from './entities/non-working-day.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailyReport,
      DailyReportEntry,
      SituationType,
      ActiveSituation,
      NonWorkingDay,
    ]),
  ],
  controllers: [DailyReportController],
  providers: [DailyReportService],
  exports: [DailyReportService],
})
export class DailyReportModule {}
