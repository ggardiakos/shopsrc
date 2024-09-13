import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import {
  AdminApiClient,
  ClientResponse,
  createAdminApiClient,
} from '@shopify/admin-api-client';
import { Either, left, right } from '@/core/either';
import { retry } from '@lifeomic/attempt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as Sentry from '@sentry/node';
import { PrometheusHistogram } from '@willsoto/nestjs-prometheus';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

// Import queries
import { GET_PRODUCT_QUERY } from './queries/get-product';
import { FETCH_PRODUCT_QUERY } from './queries/fetch-all-products';

export interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  price: number;
  variants: any[];
  images: any[];
}

type ShopifyServiceResponse<T> = Either<Error, ClientResponse<T>>;

@Injectable()
export class ShopifyGraphQLService implements OnModuleInit {
  private client: AdminApiClient;
  private readonly shopDomain: string;
  private readonly apiVersion: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectMetric('shopify_request_duration') private requestDuration: PrometheusHistogram
  ) {
    this.shopDomain = `${this.config.get<string>('SHOPIFY_SHOP_NAME')}.myshopify.com`;
    this.apiVersion = this.config.get<string>('SHOPIFY_API_VERSION', '2023-04');
  }

  @Sentry.Transaction()
  async onModuleInit() {
    const span = Sentry.startSpan({ op: 'shopifyInitialize' });
    try {
      const defaultAccessToken = this.config.get<string>('SHOPIFY_ACCESS_TOKEN');
      this.client = createAdminApiClient({
        storeDomain: this.shopDomain,
        apiVersion: this.apiVersion,
        accessToken: defaultAccessToken, 
      });
      this.logger.info('ShopifyGraphQLService initialized successfully', {
        shopDomain: this.shopDomain,
        apiVersion: this.apiVersion,
      });
      span?.setStatus('ok');
    } catch (error) {
      this.logger.error('Failed to initialize ShopifyGraphQLService', { 
        error: error.message,
        shopDomain: this.shopDomain,
        apiVersion: this.apiVersion,
      });
      Sentry.captureException(error);
      span?.setStatus('error');
      throw error;
    } finally {
      span?.finish();
    }
  }

  setAccessToken(accessToken: string): void {
    this.client = createAdminApiClient({
      storeDomain: this.shopDomain,
      apiVersion: this.apiVersion,
      accessToken: accessToken,
    });
    this.logger.debug('Access token updated for Shopify client');
  }

  @Sentry.Transaction()
  async getProduct(id: string, accessToken?: string): Promise<ShopifyServiceResponse<ShopifyProduct>> {
    const span = Sentry.startSpan({ op: 'getProduct' });
    const cacheKey = `shopify_product:${id}`;
    const timer = this.requestDuration.startTimer();
    try {
      const cachedProduct = await this.cacheManager.get<ShopifyServiceResponse<ShopifyProduct>>(cacheKey);
      if (cachedProduct) {
        this.logger.debug('Cache hit for Shopify product', { productId: id });
        return cachedProduct;
      }

      if (accessToken) {
        this.setAccessToken(accessToken);
      }

      const result = await this.retryOperation(() => 
        this.client.request(GET_PRODUCT_QUERY, {
          variables: { id: `gid://shopify/Product/${id}` },
        }),
        'getProduct',
        { productId: id }
      );

      this.logger.info('Successfully retrieved product from Shopify', { productId: id });
      const response = right(result);
      await this.cacheManager.set(cacheKey, response, this.config.get('CACHE_TTL', 900)); // Cache for 15 minutes by default
      return response;
    } catch (error) {
      this.logger.error('Failed to get product from Shopify', { productId: id, error: error.message });
      Sentry.captureException(error);
      return left(new Error(`Failed to get product: ${error.message}`));
    } finally {
      timer({ operation: 'getProduct' });
      span?.finish();
    }
  }

  @Sentry.Transaction()
  async findAll(accessToken?: string): Promise<ShopifyServiceResponse<ShopifyProduct[]>> {
    const span = Sentry.startSpan({ op: 'findAllProducts' });
    const cacheKey = 'shopify_all_products';
    const timer = this.requestDuration.startTimer();
    try {
      const cachedProducts = await this.cacheManager.get<ShopifyServiceResponse<ShopifyProduct[]>>(cacheKey);
      if (cachedProducts) {
        this.logger.debug('Cache hit for all Shopify products');
        return cachedProducts;
      }

      if (accessToken) {
        this.setAccessToken(accessToken);
      }

      const result = await this.retryOperation(() => 
        this.client.request(FETCH_PRODUCT_QUERY),
        'findAllProducts'
      );

      this.logger.info('Successfully retrieved all products from Shopify');
      const response = right(result.data);
      await this.cacheManager.set(cacheKey, response, this.config.get('CACHE_TTL', 900)); // Cache for 15 minutes by default
      return response;
    } catch (error) {
      this.logger.error('Failed to fetch all products from Shopify', { error: error.message });
      Sentry.captureException(error);
      return left(new Error(`Failed to fetch all products: ${error.message}`));
    } finally {
      timer({ operation: 'findAllProducts' });
      span?.finish();
    }
  }

  private async retryOperation<T>(
    operation: () => Promise<ClientResponse<T>>,
    operationName: string,
    additionalContext: Record<string, any> = {}
  ): Promise<ClientResponse<T>> {
    return retry(
      async () => {
        const response = await operation();
        if (response.errors) {
          throw new Error(JSON.stringify(response.errors));
        }
        return response;
      },
      {
        maxAttempts: this.config.get('SHOPIFY_MAX_RETRY_ATTEMPTS', 3),
        delay: this.config.get('SHOPIFY_RETRY_DELAY', 1000),
        factor: this.config.get('SHOPIFY_RETRY_FACTOR', 2),
        handleError: (error, context) => {
          this.logger.warn(`Failed to execute ${operationName}, retrying...`, {
            ...additionalContext,
            attempt: context.attemptNum,
            error: error.message,
          });
          Sentry.addBreadcrumb({
            category: 'retry',
            message: `Retrying ${operationName}`,
            level: Sentry.Severity.Warning,
            data: {
              ...additionalContext,
              attempt: context.attemptNum,
              error: error.message,
            },
          });
        },
      }
    );
  }
}