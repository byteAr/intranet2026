import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsEmail({}, { message: 'Correo de recuperación inválido' })
  @MaxLength(200)
  recoveryEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5_000_000, { message: 'La imagen es demasiado grande' })
  avatar?: string;

  @IsOptional()
  @IsString()
  @IsIn(['SUBALF','ALF','1ER ALF','2DO CTE','CTE','CTE PR','CTE MY','CTE GRL','GEND','CBO','CRO','SARG','SAY','SPR','SMY','CIVIL'])
  rank?: string;
}
