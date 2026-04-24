import { IsOptional, IsString, MinLength } from 'class-validator';

export class GroupMemberActionDto {
  @IsString()
  @MinLength(1)
  groupDn: string;

  @IsString()
  @MinLength(1)
  userDn: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  userName?: string;
}
