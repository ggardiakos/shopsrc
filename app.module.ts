import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard, ThrottlerModuleOptions } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { CacheModule, CacheInterceptor } from '@nestjs/cache-manager';
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { ShopifyFastifyModule } from '@nestjs-shopify/fastify';
import { ApiVersion } from '@shopify/shopify-api';
import { RedisSessionStorage } from '@shopify/shopify-app-session-storage-redis';
import Redis from 'ioredis';
import { ShopifyWebhooksModule } from '@nestjs-shopify/webhooks';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TerminusModule } from '@nestjs/terminus';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import * as Joi from 'joi';
import * as winston from 'winston';
import * as WinstonCloudWatch from 'winston-cloudwatch';
import * as AWSXRay from 'aws-xray-sdk';
import * as Sentry from '@sentry/node';
import * as metrics from 'datadog-metrics';

// Custom Modules
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ShopifyModule } from './shopify/shopify.module';
import { ContentfulModule } from './contentful/contentful.module';
import { ShopifyAuthModule } from './auth/auth.module';
import { QueueModule } from './queue/queue.module';
import { RedisCacheModule } from './redis/redisCache.module';

// Interceptors, Filters, and Guards
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ShopifyExceptionFilter } from './common/filters/shopify-exception.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CsrfGuard } from './guards/csrf.guard';
import { RolesGuard } from './guards/roles.guard';

// Services
import { ShopifyService } from './shopify/services/shopify.service';
import { ContentfulService } from './contentful/contentful.service';
import { QueueProcessor } from './queue/queue.processor';

const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow(''),
  REDIS_DB: Joi.number().default(0),
  SHOPIFY_API_KEY: Joi.string().required(),
  SHOPIFY_API_SECRET_KEY: Joi.string().required(),
  SHOPIFY_API_SCOPES: Joi.string().required(),
  SHOPIFY_HOST_NAME: Joi.string().required(),
  SHOPIFY_API_VERSION: Joi.string().required(),
  SHOPIFY_IS_EMBEDDED_APP: Joi.boolean().required(),
  CONTENTFUL_SPACE_ID: Joi.string().required(),
  CONTENTFUL_ACCESS_TOKEN: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  CACHE_TTL: Joi.number().default(600),
  GRAYLOG_HOST: Joi.string().required(),
  GRAYLOG_PORT: Joi.number().required(),
  AWS_CLOUDWATCH_GROUP_NAME: Joi.string().required(),
  AWS_CLOUDWATCH_STREAM_NAME: Joi.string().required(),
  AWS_REGION: Joi.string().required(),
  DATADOG_API_KEY: Joi.string().required(),
  SENTRY_DSN: Joi.string().required(),
  THROTTLE_TTL: Joi.number().required(),
  THROTTLE_LIMIT: Joi.number().required(),
});

@Module({
  imports: [
    // Environment Configuration with Validation
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      envFilePath: ['.env.development', '.env.production'],
    }),

    // Database Configuration
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: configService.get<string>('NODE_ENV') !== 'production',
        // Additional TypeORM options can be added here
      }),
      inject: [ConfigService],
    }),

    // Queue Configuration with Bull
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD', ''),
          db: configService.get<number>('REDIS_DB'),
        },
      }),
      inject: [ConfigService],
    }),

    // Caching Configuration
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        store: 'redis',
        host: configService.get<string>('REDIS_HOST'),
        port: configService.get<number>('REDIS_PORT'),
        password: configService.get<string>('REDIS_PASSWORD'),
        ttl: configService.get<number>('CACHE_TTL'),
        db: configService.get<number>('REDIS_DB'),
      }),
      inject: [ConfigService],
      isGlobal: true,
    }),

    // Throttling (Rate Limiting) Configuration
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService): Promise<ThrottlerModuleOptions> => ({
        ttl: configService.get<number>('THROTTLE_TTL'),
        limit: configService.get<number>('THROTTLE_LIMIT'),
      }),
      inject: [ConfigService],
    }),

    // Scheduling Module for Cron Jobs
    ScheduleModule.forRoot(),

    // Logging Configuration with Winston and CloudWatch
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        level: configService.get<string>('NODE_ENV') === 'production' ? 'info' : 'debug',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
        transports: [
          // Console Transport
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                return `${timestamp} [${level}]: ${message} ${
                  Object.keys(meta).length ? JSON.stringify(meta) : ''
                }`;
              }),
            ),
          }),
          // CloudWatch Transport
          new WinstonCloudWatch({
            logGroupName: configService.get<string>('AWS_CLOUDWATCH_GROUP_NAME'),
            logStreamName: configService.get<string>('AWS_CLOUDWATCH_STREAM_NAME'),
            awsRegion: configService.get<string>('AWS_REGION'),
            jsonMessage: true,
            messageFormatter: ({ level, message, additionalInfo }) =>
              JSON.stringify({ level, message, ...additionalInfo }),
          }),
        ],
      }),
      inject: [ConfigService],
    }),

    // Shopify Integration
    ShopifyFastifyModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisClient = new Redis({
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD'),
          db: configService.get<number>('REDIS_DB'),
        });

        return {
          apiKey: configService.get<string>('SHOPIFY_API_KEY'),
          apiSecretKey: configService.get<string>('SHOPIFY_API_SECRET_KEY'),
          scopes: configService.get<string>('SHOPIFY_API_SCOPES').split(','),
          hostName: configService.get<string>('SHOPIFY_HOST_NAME'),
          apiVersion: ApiVersion[configService.get<string>('SHOPIFY_API_VERSION') as keyof typeof ApiVersion],
          isEmbeddedApp: configService.get<boolean>('SHOPIFY_IS_EMBEDDED_APP'),
          sessionStorage: new RedisSessionStorage(redisClient as any),
        };
      },
      inject: [ConfigService],
    }),

    // Shopify Webhooks Configuration
    ShopifyWebhooksModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        path: '/webhooks',
        secret: configService.get<string>('SHOPIFY_API_SECRET_KEY'),
      }),
      inject: [ConfigService],
    }),

    // JWT Authentication Configuration
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
      inject: [ConfigService],
    }),

    // Passport Module for Authentication
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // Health Checks
    TerminusModule,

    // Sentry Integration for Error Tracking
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
    }),

    // GraphQL Configuration with Apollo
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: async (configService: ConfigService) => ({
        autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
        playground: configService.get<string>('NODE_ENV') !== 'production',
        context: ({ req }) => ({ req }),
        installSubscriptionHandlers: true,
      }),
      inject: [ConfigService],
    }),

    // Custom Application Modules
    ShopifyModule,
    ContentfulModule,
    ShopifyAuthModule,
    QueueModule,
    RedisCacheModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ShopifyService,
    ContentfulService,
    // Global Logging Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global Cache Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
    // Global Exception Filters
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_FILTER,
      useClass: ShopifyExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global Guards
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Queue Processor
    QueueProcessor,
    // Datadog Metrics Provider
    {
      provide: 'DATADOG',
      useFactory: (configService: ConfigService) => {
        metrics.init({
          apiKey: configService.get<string>('DATADOG_API_KEY'),
          prefix: 'shopify_app.',
        });
      },
      inject: [ConfigService],
    },
    // AWS X-Ray Provider
    {
      provide: 'AWS_XRAY',
      useFactory: (configService: ConfigService) => {
        AWSXRay.setContextMissingStrategy(() => { /* Custom strategy if needed */ });
        AWSXRay.middleware.setSamplingRules({
          version: 2,
          rules: [
            {
              description: 'Default',
              host: '*',
              http_method: '*',
              url_path: '*',
              fixed_target: 1,
              rate: 0.05,
            },
          ],
          default: {
            fixed_target: 1,
            rate: 0.1,
          },
        });
      },
      inject: [ConfigService],
    },
  ],
})
export class AppModule implements NestModule {
  constructor(private configService: ConfigService) {}

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AWSXRay.express.openSegment('shopify-app'))
      .forRoutes('*');
  }
}
