import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class ForgotPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Usuario inválido' })
  username!: string;
}
