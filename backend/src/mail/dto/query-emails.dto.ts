import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MailFolder } from '../entities/email.entity';

export class QueryEmailsDto {
  @IsOptional()
  @IsEnum(MailFolder)
  folder?: MailFolder;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;

  /** true = solo emails de años anteriores; false (default) = solo año actual */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  historical?: boolean;

  /** Filtro por año exacto (anula historical y el filtro de año actual) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  /** Fecha desde (YYYY-MM-DD) */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** Fecha hasta (YYYY-MM-DD) */
  @IsOptional()
  @IsString()
  dateTo?: string;

  /** Filtrar por remitente exacto */
  @IsOptional()
  @IsString()
  sender?: string;
}
