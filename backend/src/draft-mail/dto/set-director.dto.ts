import { IsString } from 'class-validator';

export class SetDirectorDto {
  @IsString() userId: string;
  @IsString() username: string;
  @IsString() displayName: string;
}
