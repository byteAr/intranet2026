import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDraftDto {
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsString() bodyText?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) toAddresses?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) ccAddresses?: string[];
}
