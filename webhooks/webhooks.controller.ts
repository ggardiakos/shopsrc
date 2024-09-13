import {
  BadRequestException,
  Controller,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Post,
  RawBodyRequest,
  Req,
  ForbiddenException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectShopify } from '@nestjs-shopify/core';
import { SHOPIFY_WEBHOOKS_DEFAULT_PATH } from './webhooks.constants';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import * as CircuitBreaker from 'opossum';
import * as SlackWebhook from 'slack-webhook';
import * as Joi from 'joi';
import DOMPurify from 'dompurify';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Throttle } from '@nestjs/throttler';
import * as Sentry from '@sentry/node';
import * as metrics from 'datadog-metrics';
import { CloudWatchLogsClient, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { createHmac } from 'crypto';
import axios from 'axios';
import axiosRetry from 'axios-retry';

// Shopify Webhook Request Interface
interface ShopifyWebhookRequest {
  rawBody: Buffer;
  headers: {
    [key: string]: string | string[];
    'x-shopify-topic': string;
    'x-shopify-shop-domain': string;
    'x-shopify-webhook-id': string;
    'x-shopify-hmac-sha256': string;
    'x-shopify-nonce'?: string;
    'x-shopify-timestamp'?: string;
  };
}

// Interface for webhook handler with callback
interface HttpWebhookHandlerWithCallback {
  topic: string;
  callback: (
    topic: string,
    domain: string,
    rawBody: string,
    webhookId: string,
  ) => Promise<void>;
}

// Joi schema for webhook payload validation
const webhookSchema = Joi.object({
  rawBody: Joi.any().required(),
  headers: Joi.object({
    'x-shopify-topic': Joi.string().required(),
    'x-shopify-shop-domain': Joi.string().required(),
    'x-shopify-webhook-id': Joi.string().required(),
  }).unknown(true),
});

@Controller(SHOPIFY_WEBHOOKS_DEFAULT_PATH)
export class ShopifyWebhooksController {
  private readonly SHOPIFY_IPS: string[];
  private usedNonces: Set<string> = new Set();
  private breaker: CircuitBreaker;
  private webhookHandlers: HttpWebhookHandlerWithCallback[] = [];
  private slack: SlackWebhook;
  private cloudWatchLogsClient: CloudWatchLogsClient;

  constructor(
    @InjectShopify() private readonly shopifyApi: Shopify,
    @InjectRedis() private readonly redis: Redis,
    @InjectQueue('webhook-queue') private readonly webhookQueue: Queue,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private configService: ConfigService,
  ) {
    this.SHOPIFY_IPS = this.configService.get<string>('SHOPIFY_IPS').split(',');
    this.slack = new SlackWebhook(this.configService.get<string>('SLACK_WEBHOOK_URL'));

    // Initialize Datadog metrics
    metrics.init({ apiKey: this.configService.get<string>('DATADOG_API_KEY'), prefix: 'shopify_webhooks.' });

    // Initialize CloudWatch logs client
    this.cloudWatchLogsClient = new CloudWatchLogsClient({ region: this.configService.get<string>('AWS_REGION') });

    // Circuit breaker configuration for external failures
    this.breaker = new CircuitBreaker(
      async (webhookEntry, graphqlTopic, domain, rawBody, webhookId) => {
        await webhookEntry.callback(graphqlTopic, domain, rawBody, webhookId);
      },
      {
        timeout: this.configService.get<number>('CB_TIMEOUT', 5000),
        errorThresholdPercentage: this.configService.get<number>('CB_ERROR_THRESHOLD', 50),
        resetTimeout: this.configService.get<number>('CB_RESET_TIMEOUT', 30000),
      },
    );

    // Register all webhook handlers
    this.registerWebhookHandlers();

    // Configure axios retry
    axiosRetry(axios, { retries: 3 });
  }

  // Register webhook handlers
  public registerWebhookHandlers() {
    this.registerWebhookHandler({
      topic: 'orders/create',
      callback: this.handleOrderCreateWebhook.bind(this),
    });

    this.registerWebhookHandler({
      topic: 'products/update',
      callback: this.handleProductUpdateWebhook.bind(this),
    });

    // Add more handlers here as needed
  }

  // Method to register webhook handler
  public registerWebhookHandler(handler: HttpWebhookHandlerWithCallback) {
    this.webhookHandlers.push(handler);
  }

  // Example handler for "orders/create"
  private async handleOrderCreateWebhook(
    topic: string,
    domain: string,
    rawBody: string,
    webhookId: string,
  ): Promise<void> {
    this.logger.info('Handling order create webhook', { topic, domain, webhookId });
    // Your order creation logic here
  }

  // Example handler for "products/update"
  private async handleProductUpdateWebhook(
    topic: string,
    domain: string,
    rawBody: string,
    webhookId: string,
  ): Promise<void> {
    this.logger.info('Handling product update webhook', { topic, domain, webhookId });
    // Your product update logic here
  }

  @Post()
  @HttpCode(200)
  @Throttle(10, 60) // Rate limiting to 10 requests per minute
  async handleWebhook(@Req() req: RawBodyRequest<ShopifyWebhookRequest>) {
    const startTime = Date.now(); // Track start time for metrics
    const { rawBody, headers } = req;
    const { topic, domain, webhookId } = this.extractHeaders(req);
    const cacheKey = `${webhookId}`;
    const rawBodyStr = rawBody.toString();

    try {
      // Validate and sanitize payload
      const sanitizedPayload = DOMPurify.sanitize(rawBodyStr);
      const validation = webhookSchema.validate({
        rawBody: sanitizedPayload,
        headers,
      });

      if (validation.error) {
        this.logger.warn('Invalid webhook payload', { error: validation.error.message });
        throw new BadRequestException('Invalid webhook payload');
      }

      this.logger.info('Received webhook request', { topic });
      metrics.increment('webhook_received', 1, [`topic:${topic}`]);

      // Security validations
      this.validateIp(req);
      this.validateAuth(req);
      this.validateWebhookSignature(rawBodyStr, headers);
      this.validateTimestampAndNonce(headers);

      // Check Redis cache for previously processed webhook
      const isProcessed = await this.getCachedData(cacheKey, async () => {
        return null; // If not in cache, return null
      });

      if (isProcessed) {
        this.logger.info('Webhook already processed, skipping.', { webhookId });
        return { success: true, message: 'Webhook already processed' };
      }

      // Find matching webhook handlers
      const matchingHandlers = this.webhookHandlers.filter(
        (handler) => handler.topic === topic,
      );

      if (matchingHandlers.length === 0) {
        this.logger.warn('No handler found for topic', { topic });
        return; // No handler for this topic
      }

      // Add webhook processing to the queue
      await this.webhookQueue.add('processWebhook', {
        handler: matchingHandlers[0], // Assuming only one handler per topic
        topic,
        domain,
        payload: sanitizedPayload,
        webhookId,
      });

      // Mark webhook as processed in Redis
      await this.redis.set(cacheKey, 'processed', 'EX', 3600); // Set expiry for 1 hour

      // Log webhook queuing duration
      const endTime = Date.now();
      const duration = endTime - startTime;
      this.logger.info('Webhook added to queue', {
        metricName: 'WebhookQueuingDuration',
        metricValue: duration,
        topic,
        domain,
        webhookId,
      });
      metrics.histogram('webhook_processing_time', duration, [`topic:${topic}`]);

      await this.logToCloudWatch('Webhook processed successfully', { topic, domain, webhookId });

      return { success: true, message: 'Webhook added to processing queue' };
    } catch (error) {
      Sentry.captureException(error);
      metrics.increment('webhook_errors', 1, [`topic:${topic}`]);
      await this.notifyFailure(error, rawBodyStr);
      await this.logToCloudWatch('Webhook processing failed', { topic, domain, webhookId, error: error.message });
      this.handleError(error);
    }
  }

  // Validate Shopify token
  private validateAuth(req: RawBodyRequest<ShopifyWebhookRequest>): void {
    const authToken = req.headers['x-shopify-token'];
    if (!authToken || authToken !== this.configService.get<string>('SHOPIFY_AUTH_TOKEN')) {
      this.logger.warn('Invalid authentication token');
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  // Validate HMAC signature
  private validateWebhookSignature(rawBody: string, headers: Record<string, string | string[]>): void {
    const expectedSignature = headers['x-shopify-hmac-sha256'];
    const computedSignature = this.computeHmacSignature(rawBody);
    if (expectedSignature !== computedSignature) {
      this.logger.warn('Invalid HMAC signature');
      throw new BadRequestException('Invalid HMAC signature');
    }
  }

  // Compute HMAC signature
  private computeHmacSignature(rawBody: string): string {
    const secret = this.configService.get<string>('SHOPIFY_WEBHOOK_SECRET');
    return createHmac('sha256', secret).update(rawBody).digest('base64');
  }

  // Validate IP address
  private validateIp(req: RawBodyRequest<ShopifyWebhookRequest>): void {
    const incomingIp = req.ip;
    if (!this.SHOPIFY_IPS.includes(incomingIp)) {
      this.logger.error('Unauthorized IP address', { ip: incomingIp });
      throw new ForbiddenException('Unauthorized IP address');
    }
  }

  // Extract headers from the request
  private extractHeaders(req: RawBodyRequest<ShopifyWebhookRequest>) {
    const { headers } = req;
    const topic = headers['x-shopify-topic'] as string;
    const domain = headers['x-shopify-shop-domain'] as string;
    const webhookId = headers['x-shopify-webhook-id'] as string;

    const missingHeaders = [];
    if (!topic) missingHeaders.push('Topic');
    if (!domain) missingHeaders.push('Domain');
    if (!webhookId) missingHeaders.push('WebhookId');

    if (missingHeaders.length) {
      this.logger.error('Missing headers', { missingHeaders: missingHeaders.join(', ') });
      throw new BadRequestException(`Missing required HTTP headers: ${missingHeaders.join(', ')}`);
    }

    return { topic, domain, webhookId };
  }

  // Validate timestamp and nonce
  private validateTimestampAndNonce(headers: Record<string, string | string[]>): void {
    const nonce = headers['x-shopify-nonce'] as string;
    const timestamp = Number(headers['x-shopify-timestamp']);

    if (nonce) {
      if (this.usedNonces.has(nonce)) {
        this.logger.warn('Duplicate nonce detected');
        throw new BadRequestException('Nonce has already been used');
      }

      const currentTime = Date.now();
      if (currentTime - timestamp > 5 * 60 * 1000) { // 5 minutes window
        this.logger.warn('Timestamp too old');
        throw new BadRequestException('Timestamp too old');
      }

      this.usedNonces.add(nonce);
    }
  }

  // Notify via Slack on failure
  private async notifyFailure(error: Error, payload: string) {
    await this.slack.send({
      text: `Webhook processing failed: ${error.message}`,
      attachments: [{ text: `Payload: ${payload}` }],
    });
  }

  // Error handling helper
  private handleError(exception: Error) {
    if (exception instanceof BadRequestException) {
      this.logger.error('Bad Request error processing webhook', { error: exception.message });
      throw exception;
    } else if (exception instanceof NotFoundException) {
      this.logger.error('Not Found error processing webhook', { error: exception.message });
      throw exception;
    } else {
      this.logger.error('Internal Server error processing webhook', { error: exception.message });
      throw new InternalServerErrorException('An error occurred while processing the webhook');
    }
  }

  // Cache helper function
  private async getCachedData(key: string, fetchData: () => Promise<any>) {
    const cachedData = await this.redis.get(key);
    if (cachedData) {
      return JSON.parse(cachedData);
    }
    const data = await fetchData();
    if (data !== null) {
      await this.redis.set(key, JSON.stringify(data), 'EX', 3600); // Cache for 1 hour
    }
    return data;
  }

  // CloudWatch logging helper
  private async logToCloudWatch(message: string, context: any) {
    try {
      const logGroupName = this.configService.get<string>('AWS_CLOUDWATCH_GROUP_NAME');
      const logStreamName = this.configService.get<string>('AWS_CLOUDWATCH_STREAM_NAME');
      const command = new PutLogEventsCommand({
        logGroupName,
        logStreamName,
        logEvents: [{ timestamp: Date.now(), message: JSON.stringify({ message, ...context }) }],
      });
      await this.cloudWatchLogsClient.send(command);
    } catch (error) {
      this.logger.error('Failed to log to CloudWatch', { error: error.message });
    }
  }
}