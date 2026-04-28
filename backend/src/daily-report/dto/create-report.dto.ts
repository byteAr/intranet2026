import { Type } from 'class-transformer';
import {
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsBoolean,
  IsInt,
  IsDateString,
  Min,
} from 'class-validator';

export class EntryDto {
  @IsString()
  username: string;

  @IsString()
  fullName: string;

  @IsString()
  rank: string;

  @IsString()
  rankCategory: string;

  @IsString()
  situationTypeCode: string;

  @IsOptional()
  @IsDateString()
  situationFromDate?: string;

  @IsOptional()
  @IsDateString()
  situationToDate?: string;

  @IsOptional()
  @IsString()
  authorizedBy?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  authorizedDays?: number;

  @IsOptional()
  @IsBoolean()
  authorizedChargedToLao?: boolean;

  @IsOptional()
  @IsString()
  shiftType?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateReportDto {
  @IsString()
  officeGroup: string;

  @IsDateString()
  reportDate: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryDto)
  entries: EntryDto[];
}
