import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { Request } from 'express';

const ALLOWED_IPS = ['172.21.36.104', '::ffff:172.21.36.104', '::1', '127.0.0.1'];

function readMailBridgeSecret(): string {
  const secretPath = '/run/secrets/mail_bridge_secret';
  try {
    return readFileSync(secretPath, 'utf-8').trim();
  } catch {
    return process.env.MAIL_BRIDGE_SECRET ?? '';
  }
}

const MAIL_BRIDGE_SECRET = readMailBridgeSecret();

@Injectable()
export class BridgeSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    // IP whitelist check
    const clientIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket?.remoteAddress
      ?? '';
    if (!ALLOWED_IPS.includes(clientIp)) {
      throw new UnauthorizedException();
    }

    // Secret check
    const provided = req.headers['authorization'] ?? '';
    const expected = `Bearer ${MAIL_BRIDGE_SECRET}`;

    if (!provided || provided.length !== expected.length) {
      throw new UnauthorizedException();
    }

    const match = timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!match) throw new UnauthorizedException();
    return true;
  }
}
