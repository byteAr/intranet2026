import { IsString, IsBoolean, IsOptional, MinLength } from 'class-validator';

export class CreateSituationTypeDto {
  @IsString()
  @MinLength(2)
  code: string;

  @IsString()
  @MinLength(2)
  label: string;

  @IsOptional()
  @IsBoolean()
  requiresDateRange?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresFromDateOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresAuthorizationInfo?: boolean;

  @IsOptional()
  @IsBoolean()
  isAbsent?: boolean;

  @IsOptional()
  @IsBoolean()
  isEffective?: boolean;
}
