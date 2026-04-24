import { IsString } from 'class-validator';

export class DelegateDto {
  @IsString() userId: string;
  @IsString() username: string;
  @IsString() displayName: string;
}
