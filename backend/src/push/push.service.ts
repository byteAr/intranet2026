import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PushSubscription } from './entities/push-subscription.entity';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(PushSubscription)
    private readonly repo: Repository<PushSubscription>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    webpush.setVapidDetails(
      this.config.get<string>('VAPID_MAILTO')!,
      this.config.get<string>('VAPID_PUBLIC_KEY')!,
      this.config.get<string>('VAPID_PRIVATE_KEY')!,
    );
  }

  getVapidPublicKey(): string {
    return this.config.get<string>('VAPID_PUBLIC_KEY')!;
  }

  async subscribe(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
    await this.repo.upsert(
      {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      ['endpoint'],
    );
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.repo.delete({ userId, endpoint });
  }

  async sendToUser(
    recipientId: string,
    payload: { title: string; body: string; icon?: string; data?: Record<string, unknown> },
  ): Promise<void> {
    const subs = await this.repo.find({ where: { userId: recipientId } });
    if (!subs.length) return;

    const notification = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
        icon: payload.icon ?? '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        vibrate: [100, 50, 100],
        data: payload.data ?? {},
      },
    });

    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notification,
        ),
      ),
    );

    // Limpiar suscripciones inválidas (410 Gone)
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        const err = r.reason as { statusCode?: number };
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await this.repo.delete({ id: subs[i].id });
        } else {
          this.logger.warn(`Push failed for user ${recipientId}: ${String(r.reason)}`);
        }
      }
    }
  }
}
