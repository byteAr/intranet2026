import { IsString, MinLength } from 'class-validator';

export class SetSignerDto {
  @IsString() @MinLength(2) displayName: string;
  @IsString() @MinLength(2) rank: string;
}
