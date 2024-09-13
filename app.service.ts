import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import Redis, { RedisOptions } from 'ioredis';
import { RedisSessionStorage } from '@shopify/shopify-app-session-storage-redis';
import type { Logger as WinstonLogger } from 'winston';
import type { RedisCache } from './redis/redis.interface';
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { FastifyInstance } from 'fastify';


@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;
  private shopify: ReturnType<typeof shopifyApi>;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: WinstonLogger,
    @Inject(CACHE_MANAGER) private cacheManager: RedisCache,
    private configService: ConfigService,
    @InjectMetric('api_requests_total') private apiRequestsCounter: Counter<string>,
    @InjectMetric('api_request_duration_seconds') private apiRequestDuration: Histogram<string>,
    @Inject('FASTIFY_INSTANCE') private fastify: FastifyInstance
  ) {
    const redisOptions: RedisOptions = {
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
      password: this.configService.get<string>('REDIS_PASSWORD'),
    };
    this.redisClient = new Redis(redisOptions);
  }

  async onModuleInit() {
    await this.initializeRedisClient();
    this.initializeShopify();
  }

  async onModuleDestroy() {
    await this.redisClient.quit();
  }

  private async initializeRedisClient(): Promise<void> {
    try {
      await this.redisClient.connect();
      this.logger.info('Redis client connected successfully');

      this.redisClient.on('error', (error) => {
        this.logger.error('Redis Client Error', error);
        Sentry.captureException(error);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis client', error);
      Sentry.captureException(error);
    }
  }

  private initializeShopify(): void {
    const redisSessionStorage = new RedisSessionStorage(this.redisClient);

    this.shopify = shopifyApi({
      apiKey: this.configService.get<string>('SHOPIFY_API_KEY'),
      apiSecretKey: this.configService.get<string>('SHOPIFY_API_SECRET'),
      scopes: this.configService.get<string>('SHOPIFY_API_SCOPES').split(','),
      hostName: this.configService.get<string>('SHOPIFY_HOST_NAME'),
      apiVersion: ApiVersion.April23,
      isEmbeddedApp: this.configService.get<boolean>('SHOPIFY_IS_EMBEDDED_APP'),
      sessionStorage: redisSessionStorage,
    });

    this.logger.info('Shopify app initialized');
  }

  async getData(): Promise<string> {
    const end = this.apiRequestDuration.startTimer();
    try {
      const cachedData = await this.cacheManager.get<string>('myKey');
      if (cachedData) {
        this.logger.info('Fetching data from cache...');
        this.apiRequestsCounter.inc({ type: 'cache_hit' });
        return cachedData;
      }

      const data = 'This is some data'; // Replace with actual data fetching logic
      await this.cacheManager.set('myKey', data, 3600);

      this.logger.info('Data set in cache');
      this.apiRequestsCounter.inc({ type: 'cache_miss' });
      return data;
    } catch (error) {
      this.logger.error('Error in getData', error);
      Sentry.captureException(error);
      throw error;
    } finally {
      end();
    }
  }

  async setData(key: string, value: string): Promise<void> {
    const end = this.apiRequestDuration.startTimer();
    try {
      await this.cacheManager.set(key, value, 3600);
      this.logger.info(`Data set for key: ${key}`);
      this.apiRequestsCounter.inc({ type: 'set_data' });
    } catch (error) {
      this.logger.error(`Error setting data for key: ${key}`, error);
      Sentry.captureException(error);
      throw error;
    } finally {
      end();
    }
  }

  async deleteData(key: string): Promise<void> {
    const end = this.apiRequestDuration.startTimer();
    try {
      await this.cacheManager.del(key);
      this.logger.info(`Data deleted for key: ${key}`);
      this.apiRequestsCounter.inc({ type: 'delete_data' });
    } catch (error) {
      this.logger.error(`Error deleting data for key: ${key}`, error);
      Sentry.captureException(error);
      throw error;
    } finally {
      end();
    }
  }

  async someMethod(): Promise<void> {
    const end = this.apiRequestDuration.startTimer();
    this.logger.info('Executing someMethod');
    try {
      const reply = await this.redisClient.hgetall('mykey');
      this.logger.info('Redis hgetall reply:', reply);
      this.apiRequestsCounter.inc({ type: 'some_method' });
    } catch (error) {
      this.logger.error('Error in hgetall:', error);
      Sentry.captureException(error);
    } finally {
      end();
    }
  }

  getHello(): string {
    this.logger.info('Hello World route accessed');
    this.apiRequestsCounter.inc({ type: 'hello' });
    return 'Hello World!';
  }

  async getSpeciesData(req: any, res: any): Promise<void> {
    const end = this.apiRequestDuration.startTimer();
    const species = req.params.species;
    let results;
    let isCached = false;

    try {
      const cacheResults = await this.redisClient.get(species);
      if (cacheResults) {
        isCached = true;
        results = JSON.parse(cacheResults);
        this.apiRequestsCounter.inc({ type: 'species_cache_hit' });
      } else {
        results = await this.fastify.circuitBreaker.fire(async () => this.fetchApiData(species));
        if (!results || results.length === 0) {
          throw new Error('API returned an empty array');
        }
        await this.redisClient.set(species, JSON.stringify(results), 'EX', 3600);
        this.apiRequestsCounter.inc({ type: 'species_cache_miss' });
      }

      res.send({
        fromCache: isCached,
        data: results,
      });
    } catch (error) {
      this.logger.error('Error in getSpeciesData:', error);
      Sentry.captureException(error);
      res.status(404).send('Data unavailable');
    } finally {
      end();
    }
  }

  private async fetchApiData(productId: string): Promise<any[]> {
    const end = this.apiRequestDuration.startTimer();
    try {
      const session = await this.getSession();
      const client = new this.shopify.clients.Graphql({ session });

      const query = `
        query getProduct($id: ID!) {
          product(id: $id) {
            title
            description
            priceRange {
              minVariantPrice {
                amount
              }
            }
            images(first: 5) {
              edges {
                node {
                  src
                  altText
                }
              }
            }
          }
        }
      `;

      const response = await client.query({
        data: {
          query,
          variables: { id: `gid://shopify/Product/${productId}` },
        },
      });

      const product = response.body.data.product;
      this.apiRequestsCounter.inc({ type: 'shopify_api_call' });
      return [{
        title: product.title,
        description: product.description,
        price: product.priceRange.minVariantPrice.amount,
        images: product.images.edges.map(edge => ({
          src: edge.node.src,
          altText: edge.node.altText || '',
        })),
      }];
    } catch (error) {
      this.logger.error(`Failed to fetch product data from Shopify for product ID: ${productId}`, error);
      Sentry.captureException(error);
      throw new Error('Error fetching product data from Shopify');
    } finally {
      end();
    }
  }

  private async getSession(): Promise<Session> {
    // Implement this method to retrieve a valid Shopify session
    // This might involve fetching from your database or session storage
    throw new Error('Method not implemented');
  }
}