import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import * as contentful from 'contentful';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { retry } from '@lifeomic/attempt';
import * as Sentry from '@sentry/node';
import {
  Product,
  Collection,
  Order,
  ProductComparison,
  CustomizationOption,
  CustomizedProduct,
} from './interfaces';
import {
  CreateProductInput,
  UpdateProductInput,
  CreateCollectionInput,
  OrderItemInput,
  CustomizeProductInput,
} from './dto';

@Injectable()
export class ContentfulService implements OnModuleInit {
  private client: contentful.ContentfulClientApi<undefined>;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {}

  @Sentry.Transaction()
  async onModuleInit() {
    const span = Sentry.startSpan({ op: 'contentfulInitialize' });
    try {
      this.client = contentful.createClient({
        space: this.configService.get<string>('CONTENTFUL_SPACE_ID'),
        accessToken: this.configService.get<string>('CONTENTFUL_ACCESS_TOKEN'),
        environment: this.configService.get<string>('CONTENTFUL_ENVIRONMENT', 'master'),
      });
      
      this.logger.info('ContentfulService initialized successfully');
      span?.setStatus('ok');
    } catch (error) {
      this.logger.error('Failed to initialize ContentfulService', { error: error.message });
      Sentry.captureException(error);
      span?.setStatus('error');
      throw error;
    } finally {
      span?.finish();
    }
  }

  @Sentry.Transaction()
  async getProducts(): Promise<Product[]> {
    const span = Sentry.startSpan({ op: 'getProducts' });
    const cacheKey = 'contentful_all_products';
    try {
      const cachedProducts = await this.cacheManager.get<Product[]>(cacheKey);
      if (cachedProducts) {
        this.logger.debug('Cache hit for all products');
        return cachedProducts;
      }

      const entries = await this.retryOperation(
        () => this.client.getEntries<Product>({ content_type: 'product' }),
        'getProducts'
      );

      const products = entries.items.map(item => this.mapContentfulProduct(item));
      
      await this.cacheManager.set(cacheKey, products, this.configService.get('CACHE_TTL', 900));
      this.logger.info(`Successfully retrieved ${products.length} products`);
      return products;
    } catch (error) {
      this.logger.error('Failed to get products', { error: error.message });
      Sentry.captureException(error);
      throw new Error(`Failed to get products: ${error.message}`);
    } finally {
      span?.finish();
    }
  }

  @Sentry.Transaction()
  async getProductById(id: string): Promise<Product> {
    const span = Sentry.startSpan({ op: 'getProductById' });
    const cacheKey = `contentful_product:${id}`;
    try {
      const cachedProduct = await this.cacheManager.get<Product>(cacheKey);
      if (cachedProduct) {
        this.logger.debug('Cache hit for product', { productId: id });
        return cachedProduct;
      }

      const entry = await this.retryOperation(
        () => this.client.getEntry<Product>(id),
        'getProductById',
        { productId: id }
      );

      const product = this.mapContentfulProduct(entry);
      
      await this.cacheManager.set(cacheKey, product, this.configService.get('CACHE_TTL', 900));
      this.logger.info('Successfully retrieved product', { productId: id });
      return product;
    } catch (error) {
      this.logger.error('Failed to get product', { productId: id, error: error.message });
      Sentry.captureException(error);
      throw new Error(`Failed to get product: ${error.message}`);
    } finally {
      span?.finish();
    }
  }

  @Sentry.Transaction()
  async createProduct(input: CreateProductInput): Promise<Product> {
    const span = Sentry.startSpan({ op: 'createProduct' });
    try {
      const entry = await this.retryOperation(
        () => this.client.createEntry('product', {
          fields: {
            title: { 'en-US': input.title },
            description: { 'en-US': input.description },
            price: { 'en-US': input.price },
            // Map other fields as necessary
          },
        }),
        'createProduct'
      );

      const product = this.mapContentfulProduct(entry);
      this.logger.info('Product created successfully', { productId: product.id });
      return product;
    } catch (error) {
      this.logger.error('Failed to create product', { error: error.message, input });
      Sentry.captureException(error);
      throw new Error(`Failed to create product: ${error.message}`);
    } finally {
      span?.finish();
    }
  }

  // Implement other methods (updateProduct, deleteProduct, etc.) following similar patterns

  private mapContentfulProduct(entry: contentful.Entry<any>): Product {
    return {
      id: entry.sys.id,
      title: entry.fields.title,
      description: entry.fields.description,
      price: entry.fields.price,
      // Map other fields as necessary
    };
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    additionalContext: Record<string, any> = {}
  ): Promise<T> {
    return retry(
      async () => {
        const response = await operation();
        return response;
      },
      {
        maxAttempts: this.configService.get('CONTENTFUL_MAX_RETRY_ATTEMPTS', 3),
        delay: this.configService.get('CONTENTFUL_RETRY_DELAY', 1000),
        factor: this.configService.get('CONTENTFUL_RETRY_FACTOR', 2),
        handleError: (error, context) => {
          this.logger.warn(`Failed to execute ${operationName}, retrying...`, {
            ...additionalContext,
            attempt: context.attemptNum,
            error: error.message,
          });
        },
      }
    );
  }
}