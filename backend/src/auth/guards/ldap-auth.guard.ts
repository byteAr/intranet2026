import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
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

  /**
   * Opciones de passport.authenticate(): el motivo del rechazo llega a
   * handleRequest como código ("data NNN" del AD) en lugar del texto en inglés
   * de passport-ldapauth.
   */
  override getAuthenticateOptions(): Record<string, string> {
    return {
      invalidCredentials: '52e',
      userNotFound: '525',
      invalidLogonHours: '530',
      invalidWorkstation: '531',
      passwordExpired: '532',
      accountDisabled: '533',
      accountExpired: '701',
      passwordMustChange: '773',
      accountLockedOut: '775',
      constraintViolation: '775',
      noSuchObject: 'base',
      badRequestMessage: 'vacio',
    };
  }

  /**
   * El motivo real del rechazo: el AD lo manda como "data NNN" en el error del
   * bind (52e contraseña incorrecta, 775 bloqueado, 532 vencida…). Hasta el
   * 15/10/2026 todo se registraba y se mostraba como "Credenciales incorrectas",
   * y no se podía saber si era la contraseña, un bloqueo o el servidor.
   */
  handleRequest<T>(err: any, user: T, info?: { message?: string }): T {
    if (!err && user) {
      this.logger.log(`[AUTH_OK] user=${this._username} ip=${this._ip}`);
      return user;
    }
    // Rechazo del AD: passport-ldapauth lo pasa en info.message con los códigos
    // configurados en LdapStrategy (52e, 775, 532…).
    const code = !err ? String(info?.message ?? '') : '';
    const reason = AD_REASONS[code];
    if (reason) {
      this.logger.warn(`[AUTH_FAIL] user=${this._username} ip=${this._ip} reason=${reason.code} ad=${code}`);
      throw new UnauthorizedException(reason.message);
    }
    if (!err) {
      this.logger.warn(`[AUTH_FAIL] user=${this._username} ip=${this._ip} reason=invalid_credentials detail="${code}"`);
      throw new UnauthorizedException(INVALID);
    }
    // Error del servidor del dominio (no responde, rechaza la cuenta de servicio…): no es culpa del usuario.
    const msg: string = err?.message ?? String(err);
    this.logger.error(`[AUTH_FAIL] user=${this._username} ip=${this._ip} reason=ldap_error detail="${err.name ?? ''}: ${msg}"`);
    throw new ServiceUnavailableException(
      'No se pudo verificar tu usuario con el servidor del dominio. Probá de nuevo en unos minutos; si sigue, avisá a TICOM.',
    );
  }
}

const INVALID = 'Usuario o contraseña incorrectos. Verificá tu usuario y contraseña de dominio (los mismos de tu PC).';

/** Códigos "data" del AD en el error de inicio de sesión. */
const AD_REASONS: Record<string, { code: string; message: string }> = {
  '52e': { code: 'invalid_credentials', message: INVALID },
  '525': { code: 'user_not_found', message: INVALID },
  '530': { code: 'time_restriction', message: 'Tu usuario no tiene permitido ingresar en este horario. Comunicate con TICOM.' },
  '531': { code: 'workstation_restriction', message: 'Tu usuario no tiene permitido ingresar desde este equipo. Comunicate con TICOM.' },
  '532': { code: 'password_expired', message: 'Tu contraseña venció. Cambiala desde "¿Olvidaste tu contraseña?" o al iniciar sesión en tu PC.' },
  '533': { code: 'account_disabled', message: 'Tu usuario está deshabilitado. Comunicate con TICOM.' },
  '701': { code: 'account_expired', message: 'Tu usuario está vencido. Comunicate con TICOM.' },
  '773': {
    code: 'password_change_required',
    message:
      'Debés cambiar tu contraseña en Windows antes de ingresar al sistema. ' +
      'Iniciá sesión en tu PC con la contraseña inicial y Windows te pedirá que la cambies.',
  },
  base: { code: 'search_base_error', message: 'No se pudo verificar tu usuario con el servidor del dominio. Avisá a TICOM.' },
  '775': { code: 'account_locked', message: 'Tu usuario quedó bloqueado por varios intentos fallidos. Esperá unos minutos o pedí a TICOM que lo desbloquee.' },
};
