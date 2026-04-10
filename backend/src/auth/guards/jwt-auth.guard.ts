import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = User>(err: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    const resolved = super.handleRequest<TUser>(err, user, info, context);
    const u = resolved as unknown as User | undefined;
    if (u?.mustChangePassword) {
      const req = context.switchToHttp().getRequest<{ path: string }>();
      if (!req.path.endsWith('/auth/set-initial-password')) {
        throw new ForbiddenException({
          error: 'MUST_CHANGE_PASSWORD',
          message: 'Debe establecer su contraseña antes de continuar',
        });
      }
    }
    return resolved;
  }
}
