import { Module, DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { CacheModule } from '@nestjs/cache-manager';
import * as winston from 'winston';
import * as Sentry from '@sentry/node';
import { ContentfulService } from './contentful.service';

export interface ContentfulModuleOptions {
  isGlobal?: boolean;
  useFactory?: (...args: any[]) => Promise<ContentfulConfig> | ContentfulConfig;
  inject?: any[];
}

export interface ContentfulConfig {
  spaceId: string;
  accessToken: string;
  environment?: string;
  maxRetryAttempts?: number;
  retryDelay?: number;
  retryFactor?: number;
  cacheTtl?: number;
  cacheMaxItems?: number;
  logLevel?: string;
  sentryDsn?: string;
}

@Module({})
export class ContentfulModule {
  static forRoot(options: ContentfulModuleOptions = {}): DynamicModule {
    return {
      module: ContentfulModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env.local', '.env'],
        }),
        WinstonModule.forRootAsync({
          useFactory: (configService: ConfigService) => ({
            transports: [
              new winston.transports.Console({
                format: winston.format.combine(
                  winston.format.timestamp(),
                  winston.format.json()
                ),
              }),
            ],
            level: configService.get<string>('LOG_LEVEL', 'info'),
          }),
          inject: [ConfigService],
        }),
        CacheModule.registerAsync({
          useFactory: (configService: ConfigService) => ({
            ttl: configService.get<number>('CACHE_TTL', 900),
            max: configService.get<number>('CACHE_MAX_ITEMS', 100),
          }),
          inject: [ConfigService],
        }),
      ],
      providers: [
        {
          provide: 'CONTENTFUL_OPTIONS',
          useFactory: options.useFactory || ((configService: ConfigService) => ({
            spaceId: configService.get<string>('CONTENTFUL_SPACE_ID'),
            accessToken: configService.get<string>('CONTENTFUL_ACCESS_TOKEN'),
            environment: configService.get<string>('CONTENTFUL_ENVIRONMENT', 'master'),
            maxRetryAttempts: configService.get<number>('CONTENTFUL_MAX_RETRY_ATTEMPTS', 3),
            retryDelay: configService.get<number>('CONTENTFUL_RETRY_DELAY', 1000),
            retryFactor: configService.get<number>('CONTENTFUL_RETRY_FACTOR', 2),
            cacheTtl: configService.get<number>('CACHE_TTL', 900),
            cacheMaxItems: configService.get<number>('CACHE_MAX_ITEMS', 100),
            logLevel: configService.get<string>('LOG_LEVEL', 'info'),
            sentryDsn: configService.get<string>('SENTRY_DSN'),
          })),
          inject: options.inject || [ConfigService],
        },
        {
          provide: ContentfulService,
          useFactory: (config: ContentfulConfig, configService: ConfigService, logger: winston.Logger) => {
            return new ContentfulService(config, configService.get(''), logger);
          },
          inject: ['CONTENTFUL_OPTIONS', ConfigService, 'winston'],
        },
        {
          provide: 'SENTRY_INIT',
          useFactory: (config: ContentfulConfig) => {
            if (config.sentryDsn) {
              Sentry.init({
                dsn: config.sentryDsn,
                environment: process.env.NODE_ENV || 'development',
              });
            }
          },
          inject: ['CONTENTFUL_OPTIONS'],
        },
      ],
      exports: [ContentfulService],
      global: options.isGlobal || false,
    };
  }
}