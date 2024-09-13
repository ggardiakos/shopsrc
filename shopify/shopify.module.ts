import { Module, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ShopifyAuthModule } from '@nestjs-shopify/auth';
import { WinstonModule, WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { APP_FILTER } from '@nestjs/core';
import { Logger } from 'winston';
import * as Joi from 'joi';
import { ShopifyGraphQLService } from './services/shopify-graphql.service';
import { ShopifyAuthController } from './controllers/shopify-auth.controller';
import { ShopifyAuthService } from './services/shopify-auth.service';
import { ShopifyService } from './services/shopify.service';
import { ShopifyController } from './controllers/shopify.controller';
import { ShopifyWebhookHandler } from '../webhooks/shopify.webhook';
import { ShopifyExceptionFilter } from '../common/filters/shopify-exception.filter';
import { ShopifyWebhooksService } from './services/shopify-webhooks.service';

// Custom Shopify error type (example)
class ShopifyConfigError extends Error {}

@Module({
  imports: [
    ConfigModule.forRoot({
      validationSchema: Joi.object({
        SHOPIFY_API_KEY: Joi.string().required(),
        SHOPIFY_API_SECRET_KEY: Joi.string().required(),
        SHOPIFY_API_SCOPES: Joi.string().required(),
        SHOPIFY_HOST_NAME: Joi.string().required(),
        SHOPIFY_API_VERSION: Joi.string().required(),
        SHOPIFY_IS_EMBEDDED_APP: Joi.boolean().required(),
        SHOPIFY_WEBHOOK_TOPICS: Joi.string().required(),
        SHOPIFY_WEBHOOK_PATH: Joi.string().default('/webhooks'),
      }),
    }),
    WinstonModule,
    ShopifyAuthModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        apiKey: configService.get<string>('SHOPIFY_API_KEY'),
        apiSecretKey: configService.get<string>('SHOPIFY_API_SECRET_KEY'),
        scopes: configService.get<string>('SHOPIFY_API_SCOPES').split(','),
        hostName: configService.get<string>('SHOPIFY_HOST_NAME'),
        apiVersion: configService.get<string>('SHOPIFY_API_VERSION'),
        isEmbeddedApp: configService.get<boolean>('SHOPIFY_IS_EMBEDDED_APP'),
        authPath: '/auth/shopify/login',
        afterAuthPath: '/auth/shopify/callback',
        authStrategy: 'online',
      }),
    }),
  ],
  controllers: [ShopifyAuthController, ShopifyController],
  providers: [
    ShopifyAuthService,
    ShopifyService,
    ShopifyGraphQLService,
    ShopifyWebhookHandler,
    ShopifyWebhooksService,
    {
      provide: APP_FILTER,
      useClass: ShopifyExceptionFilter,
    },
  ],
  exports: [ShopifyService, ShopifyGraphQLService, ShopifyWebhooksService],
})
export class ShopifyModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly shopifyWebhooksService: ShopifyWebhooksService 
  ) {}

  async onModuleInit() {
    try {
      this.logger.info('Initializing Shopify module');

      const apiKey = this.configService.get<string>('SHOPIFY_API_KEY');
      const apiSecretKey = this.configService.get<string>('SHOPIFY_API_SECRET_KEY');
      if (!apiKey || !apiSecretKey) {
        throw new ShopifyConfigError('Shopify API credentials are not properly configured'); 
      }

      await this.shopifyWebhooksService.initializeWebhooks();

      this.logger.info('Shopify module initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Shopify module', { error: error.message });
      throw error; 
    }
  }

  async onModuleDestroy() {
    try {
      this.logger.info('Cleaning up Shopify module resources');

      await this.shopifyWebhooksService.cleanupWebhooks();

      this.logger.info('Shopify module resources cleaned up successfully');
    } catch (error) {
      this.logger.error('Error during Shopify module cleanup', { error: error.message });
      // Handle the error appropriately for your application (e.g., retry, alert, etc.)
    }
  }
}