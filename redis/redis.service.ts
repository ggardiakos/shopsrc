import { Injectable, OnModuleDestroy, Inject } from '@nestjs/common';
import * as IORedis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: IORedis.Redis // Injecting ioredis client
  ) {
    this.redis.on('error', (err) => console.error('Redis Service Error', err));
  }

  async ping(): Promise<string> {
    try {
      return await this.redis.ping(); // ioredis supports ping
    } catch (error) {
      console.error('Redis Ping Error', error);
      throw error;
    }
  }

  onModuleDestroy() {
    this.redis.quit(); // Properly disconnect the ioredis client
  }
}
