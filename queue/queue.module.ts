import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { QueueProcessor } from './queue.processor';
import { QueueService } from './queue.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Joi from 'joi';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        REDIS_HOST: Joi.string().hostname().required(),
        REDIS_PORT: Joi.number().port().required(),
        REDIS_PASSWORD: Joi.string().optional().allow(''),
        QUEUE_RETRY_ATTEMPTS: Joi.number().default(3),
        QUEUE_RETRY_BACKOFF_DELAY: Joi.number().default(1000),
      }),
    }),
    // Configure Bull with Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD', ''),
        },
      }),
      inject: [ConfigService],
    }),
    // Register queue with retry and backoff strategy
    BullModule.registerQueueAsync({
      name: 'my-queue',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        defaultJobOptions: {
          attempts: configService.get<number>('QUEUE_RETRY_ATTEMPTS', 3),
          backoff: {
            type: 'exponential',
            delay: configService.get<number>('QUEUE_RETRY_BACKOFF_DELAY', 1000),
          },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [QueueProcessor, QueueService],
  exports: [QueueService],
})
export class QueueModule {}
