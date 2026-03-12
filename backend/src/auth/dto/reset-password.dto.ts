import { IsString, IsNotEmpty, MaxLength, MinLength, Matches, Length } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Usuario inválido' })
  username!: string;

  @IsString()
  @Length(4, 4, { message: 'El OTP debe tener 4 dígitos' })
  @Matches(/^\d{4}$/, { message: 'El OTP debe ser numérico' })
  otp!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(128)
  newPassword!: string;
}
