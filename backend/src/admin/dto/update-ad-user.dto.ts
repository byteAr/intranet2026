import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateAdUserDto {
  @IsOptional()
  @IsString()
  office?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEmail()
  @Matches(/@iugna\.edu\.ar$/i, { message: 'El correo debe ser @iugna.edu.ar' })
  email?: string;
}
