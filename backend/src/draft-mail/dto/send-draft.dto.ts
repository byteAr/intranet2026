import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendDraftDto {
  @IsString() hash: string;
  @IsString() mailCode: string;
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
}
