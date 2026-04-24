import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDraftDto {
  @IsString() @MaxLength(500) subject: string;
  @IsString() @MinLength(1) bodyText: string;
  @IsArray() @IsString({ each: true }) toAddresses: string[];
  @IsArray() @IsOptional() @IsString({ each: true }) ccAddresses?: string[];
  @IsOptional() @IsString() sendMode?: string;
}
