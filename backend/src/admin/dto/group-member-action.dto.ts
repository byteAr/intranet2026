import { IsString, MinLength } from 'class-validator';

export class GroupMemberActionDto {
  @IsString()
  @MinLength(1)
  groupDn: string;

  @IsString()
  @MinLength(1)
  userDn: string;
}
