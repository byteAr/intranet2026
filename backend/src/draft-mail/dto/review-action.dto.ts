import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewActionDto {
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
