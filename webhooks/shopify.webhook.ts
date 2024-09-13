import { Injectable } from '@nestjs/common';
import { WebhookHandler, OnShopifyWebhook } from '@nestjs-shopify/webhooks';
import { ShopifyService } from '../shopify/services/shopify.service';
import { Inject } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import * as Sentry from '@sentry/node';
import * as metrics from 'datadog-metrics';
import { ConfigService } from '@nestjs/config';
import tracer from 'dd-trace';

interface WebhookPayload {
  [key: string]: any;
}

@Injectable()
@OnShopifyWebhook()
export class ShopifyWebhookHandler {
  constructor(
    private readonly shopifyService: ShopifyService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {
    metrics.init({ host: this.configService.get('DATADOG_HOST') });
  }

  private async handleWebhook(
    type: string,
    handler: (payload: WebhookPayload, shopDomain: string) => Promise<void>,
    payload: WebhookPayload,
    shopDomain: string,
    webhookId: string
  ): Promise<void> {
    const span = tracer.startSpan(`shopify.webhook.${type}`);
    const startTime = Date.now();

    try {
      this.logger.info(`Handling ${type} webhook for ${shopDomain}`, { webhookId, payload: JSON.stringify(payload) });
      await handler(payload, shopDomain);
      metrics.increment(`shopify.webhook.${type}`, 1, [`shop:${shopDomain}`]);
    } catch (error) {
      this.logger.error(`Error handling ${type} webhook for ${shopDomain}`, { error: error.message, webhookId, stack: error.stack });
      Sentry.captureException(error, { tags: { webhookType: type, shopDomain } });
      metrics.increment('shopify.webhook.errors', 1, [`shop:${shopDomain}`, `type:${type}`]);
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      metrics.histogram('shopify.webhook.processing_time', duration, [`shop:${shopDomain}`, `type:${type}`]);
      span.finish();
    }
  }

  @WebhookHandler('PRODUCTS/CREATE')
  async handleProductCreate(payload: WebhookPayload, shopDomain: string, webhookId: string): Promise<void> {
    await this.handleWebhook('product_create', this.shopifyService.handleProductCreate.bind(this.shopifyService), payload, shopDomain, webhookId);
  }

  @WebhookHandler('PRODUCTS/UPDATE')
  async handleProductUpdate(payload: WebhookPayload, shopDomain: string, webhookId: string): Promise<void> {
    await this.handleWebhook('product_update', this.shopifyService.handleProductUpdate.bind(this.shopifyService), payload, shopDomain, webhookId);
  }

  // Add more webhook handlers here following the same pattern