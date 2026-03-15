import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsEmail({}, { message: 'Correo de recuperación inválido' })
  @MaxLength(200)
  recoveryEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5_000_000, { message: 'La imagen es demasiado grande' })
  avatar?: string;
}
