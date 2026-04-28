import { Body, Controller, Post, Request, Response, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Response as ExpressResponse } from 'express';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { LdapAuthGuard } from './guards/ldap-auth.guard';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Throttle } from '@nestjs/throttler';

const COOKIE_NAME = 'pac_token';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 8 * 60 * 60 * 1000, // 8h in ms
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @UseGuards(LdapAuthGuard)
  @Post('login')
  async login(
    @Body() _loginDto: LoginDto,
    @Request() req: { user: Record<string, unknown> },
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.authService.login(req.user);
    res.cookie(COOKIE_NAME, result.access_token, COOKIE_OPTS);
    return { user: result.user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Request() req: { cookies?: Record<string, string> },
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      await this.authService.logout(token);
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const { email } = await this.passwordResetService.sendOtp(dto.username);
    return { message: `Código enviado a ${email}`, email };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('verify-otp')
  async verifyOtp(@Body() dto: { username: string; otp: string }) {
    await this.passwordResetService.verifyOtp(dto.username, dto.otp);
    return { message: 'Código verificado' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordResetService.resetPassword(dto.username, dto.otp, dto.newPassword);
    return { message: 'Contraseña restablecida exitosamente' };
  }

  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Request() req: { user: { id: string } },
  ) {
    await this.passwordResetService.changePassword(req.user.id, dto.currentPassword, dto.newPassword);
    return { message: 'Contraseña actualizada exitosamente' };
  }

}
