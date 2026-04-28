import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';

@Injectable()
export class TokenBlacklistService implements OnModuleDestroy {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(REDIS_URL, { lazyConnect: true });
    this.client.on('error', (err) =>
      this.logger.error('Redis error', err.message),
    );
    this.client.connect().catch((err) =>
      this.logger.error('Redis connect failed', err.message),
    );
  }

  async blacklist(jti: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(`bl:${jti}`, '1', 'EX', ttlSeconds);
    } catch (err) {
      this.logger.error('Failed to blacklist token', (err as Error).message);
    }
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    try {
      const val = await this.client.get(`bl:${jti}`);
      return val !== null;
    } catch (err) {
      this.logger.error('Failed to check blacklist', (err as Error).message);
      return false;
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
