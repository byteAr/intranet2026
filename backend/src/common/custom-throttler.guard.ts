import { Injectable, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const ms = (throttlerLimitDetail as any).timeToExpire ?? throttlerLimitDetail.ttl;
    const retryAfter = Math.ceil(ms / 1000);
    const response = context.switchToHttp().getResponse();
    response.header('Retry-After', retryAfter);
    throw new HttpException(
      {
        statusCode: 429,
        message: 'Demasiados intentos fallidos.',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
