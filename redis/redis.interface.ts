import { Cache, Store } from 'cache-manager';
import * as IORedis from 'ioredis';

export interface RedisCache extends Cache {
  store: RedisStore;
}

export interface RedisStore extends Store {
  name: 'redis';
  getClient: () => IORedis.Redis;
  isCacheableValue: (value: any) => boolean;
}
