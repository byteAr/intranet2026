import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateAdUserDto {
  @IsString()
  @MinLength(1)
  firstName: string;

  @IsOptional()
  @IsString()
  secondName?: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsString()
  @MinLength(1)
  office: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsEmail()
  @Matches(/@iugna\.edu\.ar$/i, { message: 'El correo debe ser @iugna.edu.ar' })
  email: string;

  @IsEmail()
  recoveryEmail: string;

  @IsOptional()
  @IsString()
  recoveryPhone?: string;
}
