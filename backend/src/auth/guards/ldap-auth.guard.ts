import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class LdapAuthGuard extends AuthGuard('ldapauth') {
  private readonly logger = new Logger('AuthAudit');

  override canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request & { body: { username?: string } }>();
    this._username = req.body?.username ?? 'unknown';
    this._ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket?.remoteAddress
      ?? 'unknown';
    return super.canActivate(context);
  }

  private _username = 'unknown';
  private _ip = 'unknown';

  // Intercept LDAP error 773 (must change password) to show a meaningful message
  handleRequest<T>(err: any, user: T): T {
    const msg: string = err?.message ?? '';
    if (msg.includes('773') || msg.toLowerCase().includes('must change') || msg.toLowerCase().includes('password change')) {
      this.logger.warn(`[AUTH_FAIL] user=${this._username} ip=${this._ip} reason=password_change_required`);
      throw new UnauthorizedException(
        'Debés cambiar tu contraseña en Windows antes de ingresar al sistema. ' +
        'Iniciá sesión en tu PC con la contraseña inicial y Windows te pedirá que la cambies.',
      );
    }
    if (err || !user) {
      this.logger.warn(`[AUTH_FAIL] user=${this._username} ip=${this._ip} reason=invalid_credentials`);
      throw new UnauthorizedException('Credenciales incorrectas');
    }
    this.logger.log(`[AUTH_OK] user=${this._username} ip=${this._ip}`);
    return user;
  }
}
