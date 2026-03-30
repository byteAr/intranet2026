import { IsString } from 'class-validator';

export class AddAuthorizerDto {
  @IsString() userId: string;
  @IsString() username: string;
  @IsString() displayName: string;
}
