import { Module, CacheModule, CacheInterceptor } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as redisStore from 'cache-manager-ioredis';
import * as winston from 'winston';
import rateLimit from '@fastify/rate-limit';
import * as WinstonCloudWatch from 'winston-cloudwatch';
import { RedisCacheService } from './redisCache.service';

@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const host = configService.get('REDIS_HOST');
        const port = configService.get('REDIS_PORT');
        const ttl = configService.get('CACHE_TTL');

        if (!host || !port || !ttl) {
          throw new Error('Missing required Redis cache configuration');
        }

        const store = new redisStore({
          host,
          port,
          ttl,
        });

        const logger = winston.createLogger({
          level: 'info',
          format: winston.format.json(),
          transports: [
            new winston.transports.Console(),
            new winstonCloudWatch({
              logGroupName: 'RedisCacheModule',
              logStreamName: 'LogStream',
              awsRegion: 'us-east-1', // Your AWS region
              accessKeyId: 'your_access_key_id', // Your AWS access key ID
              secretAccessKey: 'your_secret_access_key', // Your AWS secret access key
            }),
          ],
        });

        logger.info(`Redis cache configuration: host=${host}, port=${port}, ttl=${ttl}`);

        return {
          store,
          max: 100, // Maximum number of items in the cache
          ttl, // Time-to-live in seconds
          rateLimit: rateLimit({
            windowMs: 60 * 1000, // 1 minute
            max: 100, // Maximum number of requests per minute
          }),
        };
      },
    }),
  ],
  providers: [
    RedisCacheService,
    {
      provide: 'CACHE_INTERCEPTOR',
      useClass: CacheInterceptor,
    },
  ],
  exports: [RedisCacheService, 'CACHE_INTERCEPTOR'],
})
export class RedisCacheModule {}