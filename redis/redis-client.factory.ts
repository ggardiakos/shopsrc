import { FactoryProvider } from '@nestjs/common';
import * as IORedis from 'ioredis';

export const redisClientFactory: FactoryProvider = {
  provide: 'REDIS_CLIENT',
  useFactory: async () => {
    const client = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times: number) => Math.min(times * 50, 2000), // Retry strategy
      maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST, 10) || 20,
      keepAlive: process.env.REDIS_KEEP_ALIVE === 'true', // Keep alive setting
    });

    client.on('connect', () => {
      console.log('Connected to Redis with ioredis');
    });

    client.on('error', (err) => {
      console.error('ioredis Client Error', err);
    });

    return client;
  },
};
