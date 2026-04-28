import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import { DailyReportService } from './daily-report.service';
import { CreateReportDto } from './dto/create-report.dto';
import { CreateSituationTypeDto } from './dto/create-situation-type.dto';

@Controller('daily-report')
export class DailyReportController {
  constructor(private readonly service: DailyReportService) {}

  // ─── Countdown & status ───────────────────────────────────────────────────

  @Get('countdown')
  getCountdown() {
    return this.service.getCountdownInfo();
  }

  // ─── Situation types ──────────────────────────────────────────────────────

  @Get('situation-types')
  getSituationTypes() {
    return this.service.getSituationTypes();
  }

  @Post('situation-types')
  createSituationType(@Body() dto: CreateSituationTypeDto, @Request() req: any) {
    return this.service.createSituationTypeCustom(dto, req.user);
  }

  @Delete('situation-types/:id')
  deleteSituationType(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteSituationTypeCustom(id);
  }

  // ─── Non-working days ─────────────────────────────────────────────────────

  @Get('non-working-days')
  getNonWorkingDays(@Query('year') year: string) {
    return this.service.getNonWorkingDays(year ? parseInt(year) : new Date().getFullYear());
  }

  @Post('non-working-days')
  markNonWorkingDay(@Body() body: { date: string; reason: string }) {
    return this.service.markNonWorkingDay(body.date, body.reason ?? 'manual');
  }

  @Delete('non-working-days/:date')
  removeNonWorkingDay(@Param('date') date: string) {
    return this.service.removeNonWorkingDay(date);
  }

  // ─── Active situations ────────────────────────────────────────────────────

  @Get('active-situations')
  getActiveSituations(@Query('officeGroup') officeGroup: string) {
    return this.service.getActiveSituationsForOffice(officeGroup);
  }

  @Get('active-situations/user/:username')
  getActiveSituationForUser(@Param('username') username: string) {
    return this.service.getActiveSituationForUser(username);
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  @Get('reports')
  listReports(@Query('officeGroup') officeGroup: string) {
    return this.service.listReports(officeGroup);
  }

  @Get('reports/by-date')
  getReportByDate(
    @Query('officeGroup') officeGroup: string,
    @Query('date') date: string,
  ) {
    return this.service.getReportByDateAndOffice(officeGroup, date);
  }

  @Get('reports/:id')
  getReport(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.service.getReport(id, req.user);
  }

  @Post('reports')
  createReport(@Body() dto: CreateReportDto, @Request() req: any) {
    return this.service.createReport(dto, req.user);
  }

  @Put('reports/:id')
  updateReport(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateReportDto,
    @Request() req: any,
  ) {
    return this.service.updateReport(id, dto, req.user);
  }

  @Patch('reports/:id/lock')
  lockReport(@Param('id', ParseIntPipe) id: number) {
    return this.service.lockReport(id);
  }

  // ─── PERSONAL dashboard ───────────────────────────────────────────────────

  @Get('dashboard')
  getDashboard(
    @Query('officeGroup') officeGroup?: string,
    @Query('situationTypeCode') situationTypeCode?: string,
    @Query('username') username?: string,
    @Query('date') date?: string,
    @Query('rankCategory') rankCategory?: string,
  ) {
    return this.service.getDashboard({ officeGroup, situationTypeCode, username, date, rankCategory });
  }
}
