import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { TokenBlacklistService } from '../token-blacklist.service';

export interface JwtPayload {
  sub: string;
  username: string;
  roles: string[];
  jti?: string;
}

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.['pac_token'] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.jti) {
      const blacklisted = await this.tokenBlacklist.isBlacklisted(payload.jti);
      if (blacklisted) {
        throw new UnauthorizedException('Token revoked');
      }
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    return user;
  }
}
