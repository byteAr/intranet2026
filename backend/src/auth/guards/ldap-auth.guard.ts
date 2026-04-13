import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class LdapAuthGuard extends AuthGuard('ldapauth') {
  // Intercept LDAP error 773 (must change password) to show a meaningful message
  handleRequest<T>(err: any, user: T): T {
    const msg: string = err?.message ?? '';
    if (msg.includes('773') || msg.toLowerCase().includes('must change') || msg.toLowerCase().includes('password change')) {
      throw new UnauthorizedException(
        'Debés cambiar tu contraseña en Windows antes de ingresar al sistema. ' +
        'Iniciá sesión en tu PC con la contraseña inicial y Windows te pedirá que la cambies.',
      );
    }
    if (err || !user) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }
    return user;
  }
}
