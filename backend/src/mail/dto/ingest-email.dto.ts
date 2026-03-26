import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class IngestAttachmentDto {
  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsString()
  @IsNotEmpty()
  base64: string;
}

export class IngestEmailDto {
  @IsString()
  @IsNotEmpty()
  internetMessageId: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  fromAddress: string;

  @IsArray()
  @IsString({ each: true })
  toAddresses: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  ccAddresses?: string[];

  @IsString()
  @IsNotEmpty()
  bodyText: string;

  @IsString()
  @IsOptional()
  bodyHtml?: string;

  @IsDateString()
  date: string;

  @IsBoolean()
  isSentFolder: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestAttachmentDto)
  @IsOptional()
  attachments?: IngestAttachmentDto[];
}
