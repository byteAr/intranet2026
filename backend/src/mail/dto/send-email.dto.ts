import { Transform } from 'class-transformer';
import { IsArray, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) return [value];
  return [];
}

export class SendEmailDto {
  @Transform(({ value }) => toArray(value))
  @IsArray()
  @IsEmail({}, { each: true })
  to: string[];

  @Transform(({ value }) => (value !== undefined ? toArray(value) : undefined))
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  cc?: string[];

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  bodyText: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;
}
