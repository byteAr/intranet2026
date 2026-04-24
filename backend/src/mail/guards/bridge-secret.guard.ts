import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class BridgeSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const provided = req.headers['authorization'] ?? '';
    const secret = this.configService.get<string>('MAIL_BRIDGE_SECRET') ?? '';
    const expected = `Bearer ${secret}`;

    if (!provided || provided.length !== expected.length) {
      throw new UnauthorizedException();
    }

    const match = timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!match) throw new UnauthorizedException();
    return true;
  }
}
