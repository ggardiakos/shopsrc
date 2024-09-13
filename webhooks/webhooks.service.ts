import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { InjectShopify } from '@nestjs-shopify/core';
import { Session, Shopify } from '@shopify/shopify-api';
import { retry } from '@lifeomic/attempt';
import * as Sentry from '@sentry/node';
import * as metrics from 'datadog-metrics';
import { WebhookRegistrationError, WebhookUnregistrationError } from './webhooks.errors';

@Injectable()
export class ShopifyWebhooksService implements OnModuleInit {
  private webhookTopics: string[];

  constructor(
    @InjectShopify() private readonly shopifyApi: Shopify,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly configService: ConfigService
  ) {}

  async onModuleInit() {
    this.webhookTopics = this.configService.get<string>('SHOPIFY_WEBHOOK_TOPICS', '').split(',');
    this.logger.info('ShopifyWebhooksService initialized', { webhookTopics: this.webhookTopics });
  }

  async registerWebhooks(session: Session): Promise<void> {
    this.logger.info('Starting webhook registration', { shop: session.shop });

    for (const topic of this.webhookTopics) {
      await this.registerWebhook(session, topic);
    }

    this.logger.info('Webhook registration completed', { shop: session.shop });
  }

  private async registerWebhook(session: Session, topic: string): Promise<void> {
    try {
      await retry(
        async () => {
          const response = await this.shopifyApi.webhooks.register({
            session,
            topic,
            path: this.configService.get<string>('SHOPIFY_WEBHOOK_PATH', '/webhooks'),
          });

          if (response.success) {
            this.logger.info('Webhook registered successfully', { topic, shop: session.shop });
            metrics.increment('shopify.webhook.registration_success', 1, [`shop:${session.shop}`, `topic:${topic}`]);
          } else {
            throw new Error(JSON.stringify(response.result));
          }
        },
        {
          maxAttempts: 3,
          delay: 1000,
          factor: 2,
          handleError: (error, context) => {
            this.logger.warn('Failed to register webhook, retrying...', {
              topic,
              shop: session.shop,
              attempt: context.attemptNum,
              error: error.message,
            });
            metrics.increment('shopify.webhook.registration_retry', 1, [`shop:${session.shop}`, `topic:${topic}`]);
          },
        }
      );
    } catch (error) {
      this.logger.error('Failed to register webhook after retries', {
        topic,
        shop: session.shop,
        error: error.message,
      });
      metrics.increment('shopify.webhook.registration_failure', 1, [`shop:${session.shop}`, `topic:${topic}`]);
      Sentry.captureException(error);
      throw new WebhookRegistrationError(topic, session.shop, error.message);
    }
  }

  async unregisterWebhooks(session: Session): Promise<void> {
    this.logger.info('Starting webhook unregistration', { shop: session.shop });

    try {
      await this.shopifyApi.webhooks.deleteAll({
        session,
      });
      this.logger.info('All webhooks unregistered successfully', { shop: session.shop });
      metrics.increment('shopify.webhook.unregistration_success', 1, [`shop:${session.shop}`]);
    } catch (error) {
      this.logger.error('Failed to unregister webhooks', {
        shop: session.shop,
        error: error.message,
      });
      metrics.increment('shopify.webhook.unregistration_failure', 1, [`shop:${session.shop}`]);
      Sentry.captureException(error);
      throw new WebhookUnregistrationError(session.shop, error.message);
    }
  }
}