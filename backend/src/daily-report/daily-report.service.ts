import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThanOrEqual, Not } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { DailyReport } from './entities/daily-report.entity';
import { DailyReportEntry } from './entities/daily-report-entry.entity';
import { SituationType } from './entities/situation-type.entity';
import { ActiveSituation } from './entities/active-situation.entity';
import { NonWorkingDay } from './entities/non-working-day.entity';
import { CreateReportDto, EntryDto } from './dto/create-report.dto';
import { CreateSituationTypeDto } from './dto/create-situation-type.dto';

// ─── Rank hierarchy ──────────────────────────────────────────────────────────

const RANK_ORDER: Record<string, number> = {
  'CTE GRL': 1, 'CTE MY': 2,
  'CTE PR': 10, 'CTE': 11,
  '2DO CTE': 20, '1ER ALF': 21, 'ALF': 22, 'SUBALF': 23,
  'SMY': 30, 'SPR': 31, 'SAY': 32, 'SRO': 33,
  'SARG': 40, 'CRO': 41, 'CBO': 42,
  'GEND': 50, 'GEND II': 51,
};

const RANK_CATEGORY_MAP: Record<string, string> = {
  'CTE GRL': 'of_sup', 'CTE MY': 'of_sup',
  'CTE PR': 'of_jef', 'CTE': 'of_jef',
  '2DO CTE': 'of_sub', '1ER ALF': 'of_sub', 'ALF': 'of_sub', 'SUBALF': 'of_sub',
  'SMY': 'subof_sup', 'SPR': 'subof_sup', 'SAY': 'subof_sup', 'SRO': 'subof_sup',
  'SARG': 'subof_sub', 'CRO': 'subof_sub', 'CBO': 'subof_sub',
  'GEND': 'tropa', 'GEND II': 'tropa',
};

export function getRankCategory(rank: string): string {
  return RANK_CATEGORY_MAP[rank.toUpperCase()] ?? 'civil';
}

export function getRankSortOrder(rank: string): number {
  return RANK_ORDER[rank.toUpperCase()] ?? 999;
}

// ─── System situation types ───────────────────────────────────────────────────

const SYSTEM_SITUATIONS = [
  { code: 'PRESENTE', label: 'Presente', isSystem: true, requiresDateRange: false, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: false, isEffective: true, sortOrder: 1 },
  { code: 'GUARDIA', label: 'De guardia', isSystem: true, requiresDateRange: false, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: false, isEffective: true, sortOrder: 2 },
  { code: 'TELETRABAJO', label: 'Teletrabajo', isSystem: true, requiresDateRange: false, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: false, isEffective: true, sortOrder: 3 },
  { code: 'TURNO', label: 'De turno', isSystem: true, requiresDateRange: false, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: false, isEffective: true, sortOrder: 4 },
  { code: 'DESCANSO_GUARDIA', label: 'Descanso de guardia', isSystem: true, requiresDateRange: false, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 5 },
  { code: 'DESCANSO_TURNO', label: 'Descanso de turno', isSystem: true, requiresDateRange: false, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 6 },
  { code: 'PARTE_ENFERMO', label: 'Parte de enfermo', isSystem: true, requiresDateRange: false, requiresFromDateOnly: true, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 7 },
  { code: 'LIC_ENFERMEDAD', label: 'Licencia por enfermedad', isSystem: true, requiresDateRange: false, requiresFromDateOnly: true, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 8 },
  { code: 'LAO', label: 'LAO (Licencia anual ordinaria)', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 9 },
  { code: 'LAECO', label: 'LAECO (Licencia anual especial compensatoria)', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 10 },
  { code: 'LEX', label: 'LEX (Licencia extraordinaria)', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 11 },
  { code: 'LIC_EMBARAZO', label: 'Licencia por embarazo', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 12 },
  { code: 'LIC_ADOPCION', label: 'Licencia por adopción', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 13 },
  { code: 'LIC_MATERNIDAD', label: 'Licencia por maternidad', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 14 },
  { code: 'LIC_ATENCION_FAMILIAR', label: 'Licencia por atención familiar', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 15 },
  { code: 'LIC_CAMBIO_DESTINO', label: 'Licencia por cambio de destino', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 16 },
  { code: 'AUTORIZADO', label: 'Autorizado', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: true, isAbsent: true, isEffective: false, sortOrder: 17 },
  { code: 'COMISION', label: 'En comisión', isSystem: true, requiresDateRange: true, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 18 },
  { code: 'DESTINO_DIFERENTE', label: 'Destino diferente', isSystem: true, requiresDateRange: false, requiresFromDateOnly: false, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 19 },
  { code: 'BAJA', label: 'Baja', isSystem: true, requiresDateRange: false, requiresFromDateOnly: true, requiresAuthorizationInfo: false, isAbsent: true, isEffective: false, sortOrder: 20 },
];

// ─── Timezone helper ──────────────────────────────────────────────────────────

function argentinaDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function argentinaDateTime(date: Date = new Date()): { hours: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hours = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
  return { hours, minutes };
}

function isAfterDeadline(date: Date = new Date()): boolean {
  const { hours, minutes } = argentinaDateTime(date);
  return hours > 7 || (hours === 7 && minutes >= 45);
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class DailyReportService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(DailyReport)
    private readonly reportRepo: Repository<DailyReport>,
    @InjectRepository(DailyReportEntry)
    private readonly entryRepo: Repository<DailyReportEntry>,
    @InjectRepository(SituationType)
    private readonly situationTypeRepo: Repository<SituationType>,
    @InjectRepository(ActiveSituation)
    private readonly activeSituationRepo: Repository<ActiveSituation>,
    @InjectRepository(NonWorkingDay)
    private readonly nonWorkingDayRepo: Repository<NonWorkingDay>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedSituationTypes();
  }

  private async seedSituationTypes() {
    for (const s of SYSTEM_SITUATIONS) {
      const existing = await this.situationTypeRepo.findOne({ where: { code: s.code } });
      if (!existing) {
        await this.situationTypeRepo.save(this.situationTypeRepo.create(s));
      } else {
        // Update system fields but preserve isActive
        await this.situationTypeRepo.update(existing.id, {
          label: s.label,
          isSystem: true,
          requiresDateRange: s.requiresDateRange,
          requiresFromDateOnly: s.requiresFromDateOnly,
          requiresAuthorizationInfo: s.requiresAuthorizationInfo,
          isAbsent: s.isAbsent,
          isEffective: s.isEffective,
          sortOrder: s.sortOrder,
        });
      }
    }
  }

  // ─── Cron: auto-detect non-working days ──────────────────────────────────

  @Cron('0 8 * * 1-5', { timeZone: 'America/Argentina/Buenos_Aires' })
  async detectNonWorkingDay() {
    const today = argentinaDateString();
    const count = await this.reportRepo.count({ where: { reportDate: today } });
    if (count === 0) {
      const exists = await this.nonWorkingDayRepo.findOne({ where: { date: today } });
      if (!exists) {
        await this.nonWorkingDayRepo.save(this.nonWorkingDayRepo.create({ date: today, reason: 'auto' }));
      }
    }
  }

  // ─── Situation types CRUD ─────────────────────────────────────────────────

  getSituationTypes() {
    return this.situationTypeRepo.find({ order: { sortOrder: 'ASC', label: 'ASC' } });
  }

  async createSituationTypeCustom(dto: CreateSituationTypeDto, actor: any) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.situationTypeRepo.findOne({ where: { code } });
    if (existing) throw new BadRequestException(`Ya existe el tipo de situación con código ${code}`);
    const entity = this.situationTypeRepo.create({
      code,
      label: dto.label.trim(),
      isSystem: false,
      requiresDateRange: dto.requiresDateRange ?? false,
      requiresFromDateOnly: dto.requiresFromDateOnly ?? false,
      requiresAuthorizationInfo: dto.requiresAuthorizationInfo ?? false,
      isAbsent: dto.isAbsent ?? false,
      isEffective: dto.isEffective ?? false,
      sortOrder: 100,
    });
    return this.situationTypeRepo.save(entity);
  }

  async deleteSituationTypeCustom(id: number) {
    const st = await this.situationTypeRepo.findOne({ where: { id } });
    if (!st) throw new NotFoundException('Tipo de situación no encontrado');
    if (st.isSystem) throw new ForbiddenException('No se puede eliminar un tipo de situación del sistema');
    await this.situationTypeRepo.delete(id);
    return { deleted: true };
  }

  // ─── Non-working days ─────────────────────────────────────────────────────

  async getNonWorkingDays(year: number) {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    return this.nonWorkingDayRepo
      .createQueryBuilder('n')
      .where('n.date >= :from AND n.date <= :to', { from, to })
      .orderBy('n.date', 'ASC')
      .getMany();
  }

  async markNonWorkingDay(date: string, reason: string) {
    const existing = await this.nonWorkingDayRepo.findOne({ where: { date } });
    if (existing) {
      existing.reason = reason;
      return this.nonWorkingDayRepo.save(existing);
    }
    return this.nonWorkingDayRepo.save(this.nonWorkingDayRepo.create({ date, reason }));
  }

  async removeNonWorkingDay(date: string) {
    await this.nonWorkingDayRepo.delete({ date });
    return { deleted: true };
  }

  // ─── Active situations ────────────────────────────────────────────────────

  async getActiveSituationsForOffice(officeGroup: string) {
    return this.activeSituationRepo.find({ where: { officeGroup } });
  }

  async getActiveSituationForUser(username: string) {
    return this.activeSituationRepo.findOne({ where: { username } });
  }

  private async upsertActiveSituation(entry: EntryDto, officeGroup: string) {
    const isTransient = ['PRESENTE', 'GUARDIA', 'TELETRABAJO', 'TURNO', 'DESCANSO_GUARDIA', 'DESCANSO_TURNO'].includes(entry.situationTypeCode);
    if (isTransient) {
      // Remove active situation if exists (person is back to daily rotation)
      await this.activeSituationRepo.delete({ username: entry.username });
      return;
    }

    const existing = await this.activeSituationRepo.findOne({ where: { username: entry.username } });
    const data: Partial<ActiveSituation> = {
      username: entry.username,
      officeGroup,
      situationTypeCode: entry.situationTypeCode,
      fromDate: entry.situationFromDate ?? argentinaDateString(),
      toDate: entry.situationToDate ?? null,
      authorizedBy: entry.authorizedBy ?? null,
      authorizedDays: entry.authorizedDays ?? null,
      authorizedChargedToLao: entry.authorizedChargedToLao ?? false,
      shiftType: entry.shiftType ?? null,
      notes: entry.notes ?? null,
    };

    if (existing) {
      await this.activeSituationRepo.update(existing.id, data);
    } else {
      await this.activeSituationRepo.save(this.activeSituationRepo.create(data));
    }
  }

  // ─── Daily report CRUD ────────────────────────────────────────────────────

  async listReports(officeGroup: string) {
    return this.reportRepo.find({
      where: { officeGroup },
      order: { reportDate: 'DESC' },
      select: ['id', 'officeGroup', 'reportDate', 'createdBy', 'isLocked', 'createdAt', 'updatedAt'],
    });
  }

  async getReport(id: number, user: any): Promise<DailyReport> {
    const report = await this.reportRepo.findOne({ where: { id }, relations: ['entries'] });
    if (!report) throw new NotFoundException('Parte diario no encontrado');
    this.checkReadAccess(user, report.officeGroup);
    return report;
  }

  async getReportByDateAndOffice(officeGroup: string, date: string): Promise<DailyReport | null> {
    return this.reportRepo.findOne({ where: { officeGroup, reportDate: date }, relations: ['entries'] });
  }

  async createReport(dto: CreateReportDto, user: any): Promise<DailyReport> {
    const userOfficeGroup = this.getUserOfficeGroup(user);
    if (!userOfficeGroup) throw new ForbiddenException('No pertenece a ninguna oficina');

    const isPersonal = user.roles?.includes('PERSONAL');
    const officeGroup = isPersonal ? dto.officeGroup : userOfficeGroup;

    if (!isPersonal && officeGroup !== userOfficeGroup) {
      throw new ForbiddenException('Solo puede confeccionar el parte de su propia oficina');
    }

    const today = argentinaDateString();
    if (dto.reportDate !== today && !isPersonal) {
      throw new BadRequestException('Solo puede crear el parte del día de hoy');
    }

    if (isAfterDeadline() && dto.reportDate === today) {
      const existing = await this.reportRepo.findOne({ where: { officeGroup, reportDate: today } });
      if (existing) throw new BadRequestException('El plazo para enviar el parte ha vencido (07:45)');
    }

    const existing = await this.reportRepo.findOne({ where: { officeGroup, reportDate: dto.reportDate } });
    if (existing) throw new BadRequestException('Ya existe un parte para esa fecha y oficina');

    const entries = dto.entries.map((e, i) => {
      const entry = new DailyReportEntry();
      entry.username = e.username;
      entry.fullName = e.fullName;
      entry.rank = e.rank;
      entry.rankCategory = (e.rankCategory as any) ?? getRankCategory(e.rank);
      entry.situationTypeCode = e.situationTypeCode;
      entry.situationFromDate = e.situationFromDate ?? null;
      entry.situationToDate = e.situationToDate ?? null;
      entry.authorizedBy = e.authorizedBy ?? null;
      entry.authorizedDays = e.authorizedDays ?? null;
      entry.authorizedChargedToLao = e.authorizedChargedToLao ?? false;
      entry.shiftType = e.shiftType ?? null;
      entry.notes = e.notes ?? null;
      entry.sortOrder = getRankSortOrder(e.rank);
      return entry;
    });

    const report = this.reportRepo.create({
      officeGroup,
      reportDate: dto.reportDate,
      createdBy: user.username,
      isLocked: false,
      entries,
    });

    const saved = await this.reportRepo.save(report);

    // Update active situations
    for (const e of dto.entries) {
      await this.upsertActiveSituation(e, officeGroup);
    }

    return saved;
  }

  async updateReport(id: number, dto: CreateReportDto, user: any): Promise<DailyReport> {
    const report = await this.reportRepo.findOne({ where: { id }, relations: ['entries'] });
    if (!report) throw new NotFoundException('Parte diario no encontrado');

    const isPersonal = user.roles?.includes('PERSONAL');
    if (!isPersonal) {
      const userOfficeGroup = this.getUserOfficeGroup(user);
      if (report.officeGroup !== userOfficeGroup) throw new ForbiddenException('No puede editar el parte de otra oficina');
    }

    const today = argentinaDateString();
    if (report.reportDate !== today && !isPersonal) {
      throw new ForbiddenException('Solo puede editar el parte del día de hoy');
    }

    if (report.isLocked && !isPersonal) {
      throw new ForbiddenException('El parte está bloqueado (pasó el horario de envío)');
    }

    if (isAfterDeadline() && report.reportDate === today && !isPersonal) {
      throw new ForbiddenException('El plazo para editar el parte ha vencido (07:45)');
    }

    // Replace entries
    await this.entryRepo.delete({ dailyReportId: id });

    const entries = dto.entries.map((e) => {
      const entry = new DailyReportEntry();
      entry.dailyReportId = id;
      entry.username = e.username;
      entry.fullName = e.fullName;
      entry.rank = e.rank;
      entry.rankCategory = (e.rankCategory as any) ?? getRankCategory(e.rank);
      entry.situationTypeCode = e.situationTypeCode;
      entry.situationFromDate = e.situationFromDate ?? null;
      entry.situationToDate = e.situationToDate ?? null;
      entry.authorizedBy = e.authorizedBy ?? null;
      entry.authorizedDays = e.authorizedDays ?? null;
      entry.authorizedChargedToLao = e.authorizedChargedToLao ?? false;
      entry.shiftType = e.shiftType ?? null;
      entry.notes = e.notes ?? null;
      entry.sortOrder = getRankSortOrder(e.rank);
      return entry;
    });

    await this.entryRepo.save(entries);

    // Update active situations
    for (const e of dto.entries) {
      await this.upsertActiveSituation(e, report.officeGroup);
    }

    return this.reportRepo.findOne({ where: { id }, relations: ['entries'] }) as Promise<DailyReport>;
  }

  async lockReport(id: number) {
    await this.reportRepo.update(id, { isLocked: true });
    return { locked: true };
  }

  // ─── PERSONAL dashboard ───────────────────────────────────────────────────

  async getDashboard(filters: {
    officeGroup?: string;
    situationTypeCode?: string;
    username?: string;
    date?: string;
    rankCategory?: string;
  }) {
    const date = filters.date ?? argentinaDateString();

    const qb = this.reportRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.entries', 'e')
      .where('r.reportDate = :date', { date });

    if (filters.officeGroup) {
      qb.andWhere('r.officeGroup = :officeGroup', { officeGroup: filters.officeGroup });
    }

    const reports = await qb.getMany();

    // Gather all entries across reports
    const allEntries: Array<{ entry: DailyReportEntry; officeGroup: string; activeSit?: ActiveSituation }> = [];

    for (const report of reports) {
      for (const entry of report.entries) {
        allEntries.push({ entry, officeGroup: report.officeGroup });
      }
    }

    // Enrich with active situation days count
    const activeSituations = await this.activeSituationRepo.find();
    const activeSitMap = new Map(activeSituations.map(a => [a.username, a]));

    let enriched = allEntries.map(({ entry, officeGroup }) => {
      const activeSit = activeSitMap.get(entry.username);
      const daysInSituation = activeSit ? this.calcDays(activeSit.fromDate, date) : null;
      return { ...entry, officeGroup, daysInSituation };
    });

    // Apply filters
    if (filters.situationTypeCode) {
      enriched = enriched.filter(e => e.situationTypeCode === filters.situationTypeCode);
    }
    if (filters.username) {
      const q = filters.username.toLowerCase();
      enriched = enriched.filter(e =>
        e.username.toLowerCase().includes(q) || e.fullName.toLowerCase().includes(q),
      );
    }
    if (filters.rankCategory) {
      enriched = enriched.filter(e => e.rankCategory === filters.rankCategory);
    }

    // Totals per office
    const byOffice: Record<string, { total: number; present: number; absent: number; effective: number }> = {};
    const situationTypes = await this.situationTypeRepo.find();
    const stMap = new Map(situationTypes.map(s => [s.code, s]));

    for (const e of enriched) {
      if (!byOffice[e.officeGroup]) {
        byOffice[e.officeGroup] = { total: 0, present: 0, absent: 0, effective: 0 };
      }
      const st = stMap.get(e.situationTypeCode);
      byOffice[e.officeGroup].total++;
      if (st?.isAbsent) byOffice[e.officeGroup].absent++;
      else byOffice[e.officeGroup].present++;
      if (st?.isEffective) byOffice[e.officeGroup].effective++;
    }

    const grandTotal = {
      total: enriched.length,
      present: enriched.filter(e => !stMap.get(e.situationTypeCode)?.isAbsent).length,
      absent: enriched.filter(e => stMap.get(e.situationTypeCode)?.isAbsent).length,
      effective: enriched.filter(e => stMap.get(e.situationTypeCode)?.isEffective).length,
    };

    return {
      date,
      entries: enriched.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)),
      byOffice,
      grandTotal,
      offices: reports.map(r => ({ officeGroup: r.officeGroup, hasReport: true, reportId: r.id, isLocked: r.isLocked })),
    };
  }

  private calcDays(fromDate: string, toDate: string): number {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const ms = to.getTime() - from.getTime();
    return Math.max(0, Math.floor(ms / 86400000) + 1);
  }

  // ─── Access control helpers ───────────────────────────────────────────────

  private getUserOfficeGroup(user: any): string | null {
    const OFFICE_GROUPS = [
      'TICOM', 'CENEDIS', 'LEGAL Y TÉCNICA', 'AYUDANTIADIREDTOS',
      'AYUDANTIARECTORADO', 'DOCENTES', 'CURSOS', 'PERSONAL',
      'SAF', 'LOGISTICA', 'CAMAREROS', 'DESARROLLO',
    ];
    if (!user.roles) return null;
    return user.roles.find((r: string) => OFFICE_GROUPS.includes(r.toUpperCase())) ?? null;
  }

  private checkReadAccess(user: any, officeGroup: string) {
    if (user.roles?.includes('PERSONAL')) return;
    const READ_ONLY_GROUPS = ['DIRECTORES', 'RECTOR'];
    if (user.roles?.some((r: string) => READ_ONLY_GROUPS.includes(r.toUpperCase()))) return;
    const userOffice = this.getUserOfficeGroup(user);
    if (userOffice?.toUpperCase() === officeGroup.toUpperCase()) return;
    throw new ForbiddenException('Sin acceso a este parte diario');
  }

  // ─── Countdown info ───────────────────────────────────────────────────────

  async getCountdownInfo() {
    const today = argentinaDateString();
    const isNonWorking = await this.nonWorkingDayRepo.findOne({ where: { date: today } });
    const { hours, minutes } = argentinaDateTime();
    const deadlineMinutes = 7 * 60 + 45;
    const currentMinutes = hours * 60 + minutes;
    const remainingMinutes = deadlineMinutes - currentMinutes;

    return {
      today,
      isNonWorkingDay: !!isNonWorking,
      isAfterDeadline: isAfterDeadline(),
      remainingMinutes: Math.max(0, remainingMinutes),
    };
  }
}
