import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { ShopifyGraphQLService } from '@nestjs-shopify/graphql';
import DataLoader from 'dataloader';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  Product,
  Collection,
  Order,
  ProductComparison,
  CustomizationOption,
  CustomizedProduct,
} from './graphql/schemas';
import {
  CreateProductInput,
  UpdateProductInput,
  CreateCollectionInput,
  OrderItemInput,
  CustomizeProductInput,
} from './graphql/inputs';
import { ShopifyError } from './shopify.error';
import { tracer } from '@sentry/node';

@Injectable()
export class ShopifyService implements OnModuleInit {
  private productLoader: DataLoader<string, Product>;
  private shopAccessTokenMap: Map<string, string> = new Map(); // Store access tokens per shop

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly shopifyGraphQLService: ShopifyGraphQLService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    this.initializeProductLoader();
    this.logger.info('ShopifyService initialized');
  }

  private initializeProductLoader() {
    this.productLoader = new DataLoader(async (ids: string[]) => {
      const query = `
          query($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                title
                description
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { ids };
      try {
        const response = await this.shopifyGraphQLService.query(query, variables);
        return ids.map((id) => response.nodes.find((node) => node.id === id));
      } catch (error) {
        this.logger.error('Failed to load products', {
          error: error.message,
          ids,
        });
        throw error;
      }
    });
  }

  async getProductById(id: string): Promise<Product> {
    const cacheKey = `product:${id}`;
    try {
      const cachedProduct = await this.cacheManager.get<Product>(cacheKey);
      if (cachedProduct) {
        this.logger.debug('Cache hit for product', { productId: id });
        return cachedProduct;
      }

      this.logger.debug('Cache miss for product, fetching from Shopify', {
        productId: id,
      });
      const product = await this.productLoader.load(id);
      await this.cacheManager.set(cacheKey, product, {
        ttl: this.configService.get<number>('PRODUCT_CACHE_TTL', 3600),
      });
      return product;
    } catch (error) {
      this.logger.error('Failed to get product', {
        error: error.message,
        productId: id,
      });
      throw new Error(`Failed to get product: ${error.message}`);
    }
  }

  async createProduct(input: CreateProductInput): Promise<Product> {
    try {
      const mutation = `
          mutation($input: ProductInput!) {
            productCreate(input: $input) {
              product {
                id
                title
                description
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { input };
      this.logger.info('Creating new product', { input });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Product created successfully', {
        productId: response.productCreate.product.id,
      });

      // Invalidate cache after product creation
      await this.cacheManager.del(`product:${response.productCreate.product.id}`); 

      return response.productCreate.product;
    } catch (error) {
      this.logger.error('Failed to create product', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to create product: ${error.message}`);
    }
  }

  async updateProduct(input: UpdateProductInput): Promise<Product> {
    try {
      const mutation = `
          mutation($input: ProductInput!) {
            productUpdate(input: $input) {
              product {
                id
                title
                description
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { input };
      this.logger.info('Updating product', { productId: input.id });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Product updated successfully', {
        productId: response.productUpdate.product.id,
      });

      // Invalidate cache after product update
      await this.cacheManager.del(`product:${response.productUpdate.product.id}`);

      return response.productUpdate.product;
    } catch (error) {
      this.logger.error('Failed to update product', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to update product: ${error.message}`);
    }
  }

  async deleteProduct(id: string): Promise<void> {
    try {
      const mutation = `
          mutation($input: ProductDeleteInput!) {
            productDelete(input: $input) {
              deletedProductId
            }
          }
        `;
      const variables = { input: { id } };
      this.logger.info('Deleting product', { productId: id });
      await this.shopifyGraphQLService.mutate(mutation, variables);
      this.logger.info('Product deleted successfully', { productId: id });

      // Invalidate cache after product deletion
      await this.cacheManager.del(`product:${id}`); 
    } catch (error) {
      this.logger.error('Failed to delete product', {
        error: error.message,
        productId: id,
      });
      throw new Error(`Failed to delete product: ${error.message}`);
    }
  }

  async compareProducts(ids: string[]): Promise<ProductComparison> {
    this.logger.debug('Comparing products', { productIds: ids });
    try {
      const products = await Promise.all(ids.map((id) => this.getProductById(id)));

      const allFeatures = new Set<string>();
      products.forEach((product) => {
        Object.keys(product).forEach((key) => {
          if (key !== 'id' && key !== 'title' && key !== 'description') {
            allFeatures.add(key);
          }
        });
      });

      const commonFeatures = Array.from(allFeatures);

      const comparisonMatrix = products.map((product) =>
        commonFeatures.map((feature) =>
          product[feature] ? product[feature].toString() : 'N/A',
        ),
      );

      this.logger.debug('Product comparison completed', {
        productIds: ids,
        featureCount: commonFeatures.length,
      });

      return {
        products,
        commonFeatures,
        comparisonMatrix,
      };
    } catch (error) {
      this.logger.error('Failed to compare products', {
        error: error.message,
        productIds: ids,
      });
      throw new Error(`Failed to compare products: ${error.message}`);
    }
  }

  async getCustomizationOptions(
    productId: string,
  ): Promise<CustomizationOption[]> {
    this.logger.debug('Fetching customization options', { productId });
    try {
      // In a real implementation, you'd fetch this from Shopify or your database
      // This is a mock implementation
      return [
        {
          id: '1',
          name: 'Engraving',
          type: 'engraving',
          availableChoices: ['Text', 'Logo'],
        },
        {
          id: '2',
          name: 'Cable Color',
          type: 'color',
          availableChoices: ['Black', 'White', 'Red'],
        },
        {
          id: '3',
          name: 'Ear Tip Material',
          type: 'design',
          availableChoices: ['Silicone', 'Foam', 'Hybrid'],
        },
      ];
    } catch (error) {
      this.logger.error('Failed to get customization options', {
        error: error.message,
        productId,
      });
      throw new Error(`Failed to get customization options: ${error.message}`);
    }
  }

  async customizeProduct(input: CustomizeProductInput): Promise<CustomizedProduct> {
    this.logger.debug('Customizing product', {
      productId: input.productId,
      customizations: input.customizations,
    });
    try {
      const product = await this.getProductById(input.productId);
      const customizationOptions = await this.getCustomizationOptions(
        input.productId,
      );

      const customizations = input.customizations.map((customization) => {
        const option = customizationOptions.find(
          (opt) => opt.id === customization.optionId,
        );
        if (!option) {
          throw new Error(`Invalid customization option: ${customization.optionId}`);
        }
        if (!option.availableChoices.includes(customization.chosenValue)) {
          throw new Error(
            `Invalid choice for option ${option.name}: ${customization.chosenValue}`,
          );
        }
        return {
          option,
          chosenValue: customization.chosenValue,
        };
      });

      this.logger.debug('Product customization completed', {
        productId: input.productId,
        customizationCount: customizations.length,
      });

      return {
        ...product,
        customizations,
      };
    } catch (error) {
      this.logger.error('Failed to customize product', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to customize product: ${error.message}`);
    }
  }

  async getCollectionById(id: string): Promise<Collection> {
    const cacheKey = `collection:${id}`;
    try {
      const cachedCollection = await this.cacheManager.get<Collection>(cacheKey);
      if (cachedCollection) {
        this.logger.debug('Cache hit for collection', { collectionId: id });
        return cachedCollection;
      }

      this.logger.debug('Cache miss for collection, fetching from Shopify', {
        collectionId: id,
      });
      const query = `
          query($id: ID!) {
            collection(id: $id) {
              id
              title
              description
              products(first: 10) {
                edges {
                  node {
                    id
                    title
                  }
                }
              }
            }
          }
        `;
      const variables = { id };
      const response = await this.shopifyGraphQLService.query(query, variables);
      await this.cacheManager.set(cacheKey, response.collection, {
        ttl: this.configService.get<number>('COLLECTION_CACHE_TTL', 3600),
      });
      return response.collection;
    } catch (error) {
      this.logger.error('Failed to get collection', {
        error: error.message,
        collectionId: id,
      });
      throw new Error(`Failed to get collection: ${error.message}`);
    }
  }

  async createCollection(input: CreateCollectionInput): Promise<Collection> {
    try {
      const mutation = `
          mutation($input: CollectionInput!) {
            collectionCreate(input: $input) {
              collection {
                id
                title
                description
              }
            }
          }
        `;
      const variables = { input };
      this.logger.info('Creating new collection', { input });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Collection created successfully', {
        collectionId: response.collectionCreate.collection.id,
      });
      return response.collectionCreate.collection;
    } catch (error) {
      this.logger.error('Failed to create collection', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to create collection: ${error.message}`);
    }
  }

  async getOrderById(id: string): Promise<Order> {
    try {
      const query = `
          query($id: ID!) {
            order(id: $id) {
              id
              name
              totalPrice
              createdAt
              fulfillmentStatus
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    variant {
                      id
                      title
                      price
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { id };
      this.logger.debug('Fetching order from Shopify', { orderId: id });
      const response = await this.shopifyGraphQLService.query(query, variables);
      return response.order;
    } catch (error) {
      this.logger.error('Failed to get order', {
        error: error.message,
        orderId: id,
      });
      throw new Error(`Failed to get order: ${error.message}`);
    }
  }

  async createOrder(items: OrderItemInput[]): Promise<Order> {
    try {
      const mutation = `
          mutation($input: OrderInput!) {
            orderCreate(input: $input) {
              order {
                id
                name
                totalPrice
                createdAt
                fulfillmentStatus
              }
            }
          }
        `;
      const variables = { input: { lineItems: items } };
      this.logger.info('Creating new order', { items });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Order created successfully', {
        orderId: response.orderCreate.order.id,
      });
      return response.orderCreate.order;
    } catch (error) {
      this.logger.error('Failed to create order', {
        error: error.message,
        items,
      });
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }

  async setShopAccessToken(shop: string, accessToken: string): Promise<void> {
    const span = tracer.startSpan('shopify.setShopAccessToken');
    try {
      this.shopAccessTokenMap.set(shop, accessToken);
      // In a real application, store this securely (e.g., encrypted in a database)
      this.logger.debug(`Access token set for shop ${shop}`);
    } finally {
      span.finish();
    }
  }

import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { ShopifyGraphQLService } from '@nestjs-shopify/graphql';
import DataLoader from 'dataloader';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  Product,
  Collection,
  Order,
  ProductComparison,
  CustomizationOption,
  CustomizedProduct,
} from './graphql/schemas';
import {
  CreateProductInput,
  UpdateProductInput,
  CreateCollectionInput,
  OrderItemInput,
  CustomizeProductInput,
} from './graphql/inputs';

@Injectable()
export class ShopifyService implements OnModuleInit {
  private productLoader: DataLoader<string, Product>;
  private shopAccessTokenMap: Map<string, string> = new Map(); // Store access tokens per shop

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly shopifyGraphQLService: ShopifyGraphQLService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    this.initializeProductLoader();
    this.logger.info('ShopifyService initialized');
  }

  private initializeProductLoader() {
    this.productLoader = new DataLoader(async (ids: string[]) => {
      const query = `
          query($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                title
                description
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { ids };
      try {
        const response = await this.shopifyGraphQLService.query(query, variables);
        return ids.map((id) => response.nodes.find((node) => node.id === id));
      } catch (error) {
        this.logger.error('Failed to load products', {
          error: error.message,
          ids,
        });
        throw error;
      }
    });
  }

  async getProductById(id: string): Promise<Product> {
    const cacheKey = `product:${id}`;
    try {
      const cachedProduct = await this.cacheManager.get<Product>(cacheKey);
      if (cachedProduct) {
        this.logger.debug('Cache hit for product', { productId: id });
        return cachedProduct;
      }

      this.logger.debug('Cache miss for product, fetching from Shopify', {
        productId: id,
      });
      const product = await this.productLoader.load(id);
      await this.cacheManager.set(cacheKey, product, {
        ttl: this.configService.get<number>('PRODUCT_CACHE_TTL', 3600),
      });
      return product;
    } catch (error) {
      this.logger.error('Failed to get product', {
        error: error.message,
        productId: id,
      });
      throw new Error(`Failed to get product: ${error.message}`);
    }
  }

  async createProduct(input: CreateProductInput): Promise<Product> {
    try {
      const mutation = `
          mutation($input: ProductInput!) {
            productCreate(input: $input) {
              product {
                id
                title
                description
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { input };
      this.logger.info('Creating new product', { input });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Product created successfully', {
        productId: response.productCreate.product.id,
      });

      // Invalidate cache after product creation
      await this.cacheManager.del(`product:${response.productCreate.product.id}`); 

      return response.productCreate.product;
    } catch (error) {
      this.logger.error('Failed to create product', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to create product: ${error.message}`);
    }
  }

  async updateProduct(input: UpdateProductInput): Promise<Product> {
    try {
      const mutation = `
          mutation($input: ProductInput!) {
            productUpdate(input: $input) {
              product {
                id
                title
                description
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { input };
      this.logger.info('Updating product', { productId: input.id });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Product updated successfully', {
        productId: response.productUpdate.product.id,
      });

      // Invalidate cache after product update
      await this.cacheManager.del(`product:${response.productUpdate.product.id}`);

      return response.productUpdate.product;
    } catch (error) {
      this.logger.error('Failed to update product', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to update product: ${error.message}`);
    }
  }

  async deleteProduct(id: string): Promise<void> {
    try {
      const mutation = `
          mutation($input: ProductDeleteInput!) {
            productDelete(input: $input) {
              deletedProductId
            }
          }
        `;
      const variables = { input: { id } };
      this.logger.info('Deleting product', { productId: id });
      await this.shopifyGraphQLService.mutate(mutation, variables);
      this.logger.info('Product deleted successfully', { productId: id });

      // Invalidate cache after product deletion
      await this.cacheManager.del(`product:${id}`); 
    } catch (error) {
      this.logger.error('Failed to delete product', {
        error: error.message,
        productId: id,
      });
      throw new Error(`Failed to delete product: ${error.message}`);
    }
  }

  async compareProducts(ids: string[]): Promise<ProductComparison> {
    this.logger.debug('Comparing products', { productIds: ids });
    try {
      const products = await Promise.all(ids.map((id) => this.getProductById(id)));

      const allFeatures = new Set<string>();
      products.forEach((product) => {
        Object.keys(product).forEach((key) => {
          if (key !== 'id' && key !== 'title' && key !== 'description') {
            allFeatures.add(key);
          }
        });
      });

      const commonFeatures = Array.from(allFeatures);

      const comparisonMatrix = products.map((product) =>
        commonFeatures.map((feature) =>
          product[feature] ? product[feature].toString() : 'N/A',
        ),
      );

      this.logger.debug('Product comparison completed', {
        productIds: ids,
        featureCount: commonFeatures.length,
      });

      return {
        products,
        commonFeatures,
        comparisonMatrix,
      };
    } catch (error) {
      this.logger.error('Failed to compare products', {
        error: error.message,
        productIds: ids,
      });
      throw new Error(`Failed to compare products: ${error.message}`);
    }
  }

  async getCustomizationOptions(
    productId: string,
  ): Promise<CustomizationOption[]> {
    this.logger.debug('Fetching customization options', { productId });
    try {
      // In a real implementation, you'd fetch this from Shopify or your database
      // This is a mock implementation
      return [
        {
          id: '1',
          name: 'Engraving',
          type: 'engraving',
          availableChoices: ['Text', 'Logo'],
        },
        {
          id: '2',
          name: 'Cable Color',
          type: 'color',
          availableChoices: ['Black', 'White', 'Red'],
        },
        {
          id: '3',
          name: 'Ear Tip Material',
          type: 'design',
          availableChoices: ['Silicone', 'Foam', 'Hybrid'],
        },
      ];
    } catch (error) {
      this.logger.error('Failed to get customization options', {
        error: error.message,
        productId,
      });
      throw new Error(`Failed to get customization options: ${error.message}`);
    }
  }

  async customizeProduct(input: CustomizeProductInput): Promise<CustomizedProduct> {
    this.logger.debug('Customizing product', {
      productId: input.productId,
      customizations: input.customizations,
    });
    try {
      const product = await this.getProductById(input.productId);
      const customizationOptions = await this.getCustomizationOptions(
        input.productId,
      );

      const customizations = input.customizations.map((customization) => {
        const option = customizationOptions.find(
          (opt) => opt.id === customization.optionId,
        );
        if (!option) {
          throw new Error(`Invalid customization option: ${customization.optionId}`);
        }
        if (!option.availableChoices.includes(customization.chosenValue)) {
          throw new Error(
            `Invalid choice for option ${option.name}: ${customization.chosenValue}`,
          );
        }
        return {
          option,
          chosenValue: customization.chosenValue,
        };
      });

      this.logger.debug('Product customization completed', {
        productId: input.productId,
        customizationCount: customizations.length,
      });

      return {
        ...product,
        customizations,
      };
    } catch (error) {
      this.logger.error('Failed to customize product', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to customize product: ${error.message}`);
    }
  }

  async getCollectionById(id: string): Promise<Collection> {
    const cacheKey = `collection:${id}`;
    try {
      const cachedCollection = await this.cacheManager.get<Collection>(cacheKey);
      if (cachedCollection) {
        this.logger.debug('Cache hit for collection', { collectionId: id });
        return cachedCollection;
      }

      this.logger.debug('Cache miss for collection, fetching from Shopify', {
        collectionId: id,
      });
      const query = `
          query($id: ID!) {
            collection(id: $id) {
              id
              title
              description
              products(first: 10) {
                edges {
                  node {
                    id
                    title
                  }
                }
              }
            }
          }
        `;
      const variables = { id };
      const response = await this.shopifyGraphQLService.query(query, variables);
      await this.cacheManager.set(cacheKey, response.collection, {
        ttl: this.configService.get<number>('COLLECTION_CACHE_TTL', 3600),
      });
      return response.collection;
    } catch (error) {
      this.logger.error('Failed to get collection', {
        error: error.message,
        collectionId: id,
      });
      throw new Error(`Failed to get collection: ${error.message}`);
    }
  }

  async createCollection(input: CreateCollectionInput): Promise<Collection> {
    try {
      const mutation = `
          mutation($input: CollectionInput!) {
            collectionCreate(input: $input) {
              collection {
                id
                title
                description
              }
            }
          }
        `;
      const variables = { input };
      this.logger.info('Creating new collection', { input });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Collection created successfully', {
        collectionId: response.collectionCreate.collection.id,
      });
      return response.collectionCreate.collection;
    } catch (error) {
      this.logger.error('Failed to create collection', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to create collection: ${error.message}`);
    }
  }

  async getOrderById(id: string): Promise<Order> {
    try {
      const query = `
          query($id: ID!) {
            order(id: $id) {
              id
              name
              totalPrice
              createdAt
              fulfillmentStatus
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    variant {
                      id
                      title
                      price
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { id };
      this.logger.debug('Fetching order from Shopify', { orderId: id });
      const response = await this.shopifyGraphQLService.query(query, variables);
      return response.order;
    } catch (error) {
      this.logger.error('Failed to get order', {
        error: error.message,
        orderId: id,
      });
      throw new Error(`Failed to get order: ${error.message}`);
    }
  }

  async createOrder(items: OrderItemInput[]): Promise<Order> {
    try {
      const mutation = `
          mutation($input: OrderInput!) {
            orderCreate(input: $input) {
              order {
                id
                name
                totalPrice
                createdAt
                fulfillmentStatus
              }
            }
          }
        `;
      const variables = { input: { lineItems: items } };
      this.logger.info('Creating new order', { items });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Order created successfully', {
        orderId: response.orderCreate.order.id,
      });
      return response.orderCreate.order;
    } catch (error) {
      this.logger.error('Failed to create order', {
        error: error.message,
        items,
      });
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }

  async setShopAccessToken(shop: string, accessToken: string): Promise<void> {
    const span = tracer.startSpan('shopify.setShopAccessToken');
    try {
      this.shopAccessTokenMap.set(shop, accessToken);
      // In a real application, store this securely (e.g., encrypted in a database)
      this.logger.debug(`Access token set for shop ${shop}`);
    } finally {
      span.finish();
    }
  }

  async getShopAccessToken(shop: string): Promise<string | undefined> {
    const span = tracer.startSpan('shopify.getShopAccessToken');
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { ShopifyGraphQLService } from '@nestjs-shopify/graphql';
import DataLoader from 'dataloader';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  Product,
  Collection,
  Order,
  ProductComparison,
  CustomizationOption,
  CustomizedProduct,
} from './graphql/schemas';
import {
  CreateProductInput,
  UpdateProductInput,
  CreateCollectionInput,
  OrderItemInput,
  CustomizeProductInput,
} from './graphql/inputs';

@Injectable()
export class ShopifyService implements OnModuleInit {
  private productLoader: DataLoader<string, Product>;
  private shopAccessTokenMap: Map<string, string> = new Map(); // Store access tokens per shop

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly shopifyGraphQLService: ShopifyGraphQLService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    this.initializeProductLoader();
    this.logger.info('ShopifyService initialized');
  }

  private initializeProductLoader() {
    this.productLoader = new DataLoader(async (ids: string[]) => {
      const query = `
          query($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                title
                description
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { ids };
      try {
        const response = await this.shopifyGraphQLService.query(query, variables);
        return ids.map((id) => response.nodes.find((node) => node.id === id));
      } catch (error) {
        this.logger.error('Failed to load products', {
          error: error.message,
          ids,
        });
        throw error;
      }
    });
  }

  async getProductById(id: string): Promise<Product> {
    const cacheKey = `product:${id}`;
    try {
      const cachedProduct = await this.cacheManager.get<Product>(cacheKey);
      if (cachedProduct) {
        this.logger.debug('Cache hit for product', { productId: id });
        return cachedProduct;
      }

      this.logger.debug('Cache miss for product, fetching from Shopify', {
        productId: id,
      });
      const product = await this.productLoader.load(id);
      await this.cacheManager.set(cacheKey, product, {
        ttl: this.configService.get<number>('PRODUCT_CACHE_TTL', 3600),
      });
      return product;
    } catch (error) {
      this.logger.error('Failed to get product', {
        error: error.message,
        productId: id,
      });
      throw new Error(`Failed to get product: ${error.message}`);
    }
  }

  async createProduct(input: CreateProductInput): Promise<Product> {
    try {
      const mutation = `
          mutation($input: ProductInput!) {
            productCreate(input: $input) {
              product {
                id
                title
                description
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { input };
      this.logger.info('Creating new product', { input });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Product created successfully', {
        productId: response.productCreate.product.id,
      });

      // Invalidate cache after product creation
      await this.cacheManager.del(`product:${response.productCreate.product.id}`); 

      return response.productCreate.product;
    } catch (error) {
      this.logger.error('Failed to create product', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to create product: ${error.message}`);
    }
  }

  async updateProduct(input: UpdateProductInput): Promise<Product> {
    try {
      const mutation = `
          mutation($input: ProductInput!) {
            productUpdate(input: $input) {
              product {
                id
                title
                description
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { input };
      this.logger.info('Updating product', { productId: input.id });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Product updated successfully', {
        productId: response.productUpdate.product.id,
      });

      // Invalidate cache after product update
      await this.cacheManager.del(`product:${response.productUpdate.product.id}`);

      return response.productUpdate.product;
    } catch (error) {
      this.logger.error('Failed to update product', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to update product: ${error.message}`);
    }
  }

  async deleteProduct(id: string): Promise<void> {
    try {
      const mutation = `
          mutation($input: ProductDeleteInput!) {
            productDelete(input: $input) {
              deletedProductId
            }
          }
        `;
      const variables = { input: { id } };
      this.logger.info('Deleting product', { productId: id });
      await this.shopifyGraphQLService.mutate(mutation, variables);
      this.logger.info('Product deleted successfully', { productId: id });

      // Invalidate cache after product deletion
      await this.cacheManager.del(`product:${id}`); 
    } catch (error) {
      this.logger.error('Failed to delete product', {
        error: error.message,
        productId: id,
      });
      throw new Error(`Failed to delete product: ${error.message}`);
    }
  }

  async compareProducts(ids: string[]): Promise<ProductComparison> {
    this.logger.debug('Comparing products', { productIds: ids });
    try {
      const products = await Promise.all(ids.map((id) => this.getProductById(id)));

      const allFeatures = new Set<string>();
      products.forEach((product) => {
        Object.keys(product).forEach((key) => {
          if (key !== 'id' && key !== 'title' && key !== 'description') {
            allFeatures.add(key);
          }
        });
      });

      const commonFeatures = Array.from(allFeatures);

      const comparisonMatrix = products.map((product) =>
        commonFeatures.map((feature) =>
          product[feature] ? product[feature].toString() : 'N/A',
        ),
      );

      this.logger.debug('Product comparison completed', {
        productIds: ids,
        featureCount: commonFeatures.length,
      });

      return {
        products,
        commonFeatures,
        comparisonMatrix,
      };
    } catch (error) {
      this.logger.error('Failed to compare products', {
        error: error.message,
        productIds: ids,
      });
      throw new Error(`Failed to compare products: ${error.message}`);
    }
  }

  async getCustomizationOptions(
    productId: string,
  ): Promise<CustomizationOption[]> {
    this.logger.debug('Fetching customization options', { productId });
    try {
      // In a real implementation, you'd fetch this from Shopify or your database
      // This is a mock implementation
      return [
        {
          id: '1',
          name: 'Engraving',
          type: 'engraving',
          availableChoices: ['Text', 'Logo'],
        },
        {
          id: '2',
          name: 'Cable Color',
          type: 'color',
          availableChoices: ['Black', 'White', 'Red'],
        },
        {
          id: '3',
          name: 'Ear Tip Material',
          type: 'design',
          availableChoices: ['Silicone', 'Foam', 'Hybrid'],
        },
      ];
    } catch (error) {
      this.logger.error('Failed to get customization options', {
        error: error.message,
        productId,
      });
      throw new Error(`Failed to get customization options: ${error.message}`);
    }
  }

  async customizeProduct(input: CustomizeProductInput): Promise<CustomizedProduct> {
    this.logger.debug('Customizing product', {
      productId: input.productId,
      customizations: input.customizations,
    });
    try {
      const product = await this.getProductById(input.productId);
      const customizationOptions = await this.getCustomizationOptions(
        input.productId,
      );

      const customizations = input.customizations.map((customization) => {
        const option = customizationOptions.find(
          (opt) => opt.id === customization.optionId,
        );
        if (!option) {
          throw new Error(`Invalid customization option: ${customization.optionId}`);
        }
        if (!option.availableChoices.includes(customization.chosenValue)) {
          throw new Error(
            `Invalid choice for option ${option.name}: ${customization.chosenValue}`,
          );
        }
        return {
          option,
          chosenValue: customization.chosenValue,
        };
      });

      this.logger.debug('Product customization completed', {
        productId: input.productId,
        customizationCount: customizations.length,
      });

      return {
        ...product,
        customizations,
      };
    } catch (error) {
      this.logger.error('Failed to customize product', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to customize product: ${error.message}`);
    }
  }

  async getCollectionById(id: string): Promise<Collection> {
    const cacheKey = `collection:${id}`;
    try {
      const cachedCollection = await this.cacheManager.get<Collection>(cacheKey);
      if (cachedCollection) {
        this.logger.debug('Cache hit for collection', { collectionId: id });
        return cachedCollection;
      }

      this.logger.debug('Cache miss for collection, fetching from Shopify', {
        collectionId: id,
      });
      const query = `
          query($id: ID!) {
            collection(id: $id) {
              id
              title
              description
              products(first: 10) {
                edges {
                  node {
                    id
                    title
                  }
                }
              }
            }
          }
        `;
      const variables = { id };
      const response = await this.shopifyGraphQLService.query(query, variables);
      await this.cacheManager.set(cacheKey, response.collection, {
        ttl: this.configService.get<number>('COLLECTION_CACHE_TTL', 3600),
      });
      return response.collection;
    } catch (error) {
      this.logger.error('Failed to get collection', {
        error: error.message,
        collectionId: id,
      });
      throw new Error(`Failed to get collection: ${error.message}`);
    }
  }

  async createCollection(input: CreateCollectionInput): Promise<Collection> {
    try {
      const mutation = `
          mutation($input: CollectionInput!) {
            collectionCreate(input: $input) {
              collection {
                id
                title
                description
              }
            }
          }
        `;
      const variables = { input };
      this.logger.info('Creating new collection', { input });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Collection created successfully', {
        collectionId: response.collectionCreate.collection.id,
      });
      return response.collectionCreate.collection;
    } catch (error) {
      this.logger.error('Failed to create collection', {
        error: error.message,
        input,
      });
      throw new Error(`Failed to create collection: ${error.message}`);
    }
  }

  async getOrderById(id: string): Promise<Order> {
    try {
      const query = `
          query($id: ID!) {
            order(id: $id) {
              id
              name
              totalPrice
              createdAt
              fulfillmentStatus
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    variant {
                      id
                      title
                      price
                    }
                  }
                }
              }
            }
          }
        `;
      const variables = { id };
      this.logger.debug('Fetching order from Shopify', { orderId: id });
      const response = await this.shopifyGraphQLService.query(query, variables);
      return response.order;
    } catch (error) {
      this.logger.error('Failed to get order', {
        error: error.message,
        orderId: id,
      });
      throw new Error(`Failed to get order: ${error.message}`);
    }
  }

  async createOrder(items: OrderItemInput[]): Promise<Order> {
    try {
      const mutation = `
          mutation($input: OrderInput!) {
            orderCreate(input: $input) {
              order {
                id
                name
                totalPrice
                createdAt
                fulfillmentStatus
              }
            }
          }
        `;
      const variables = { input: { lineItems: items } };
      this.logger.info('Creating new order', { items });
      const response = await this.shopifyGraphQLService.mutate(
        mutation,
        variables,
      );
      this.logger.info('Order created successfully', {
        orderId: response.orderCreate.order.id,
      });
      return response.orderCreate.order;
    } catch (error) {
      this.logger.error('Failed to create order', {
        error: error.message,
        items,
      });
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }

  async setShopAccessToken(shop: string, accessToken: string): Promise<void> {
    const span = tracer.startSpan('shopify.setShopAccessToken');
    try {
      this.shopAccessTokenMap.set(shop, accessToken);
      // In a real application, store this securely (e.g., encrypted in a database)
      this.logger.debug(`Access token set for shop ${shop}`);
    } finally {
      span.finish();
    }
  }

  async getShopAccessToken(shop: string): Promise<string | undefined> {
    const span = tracer.startSpan('shopify.getShopAccessToken');
    try {
      const accessToken = this.shopAccessTokenMap.get(shop);
      if (!accessToken) {
        this.logger.warn(`No access token found for shop ${shop}`);
      }
      return accessToken;
    } finally {
      span.finish();
    }
  }

  async getProductsForShop(shop: string): Promise<Product[]> {
    const span = tracer.startSpan('shopify.getProductsForShop');
    try {
      const accessToken = await this.getShopAccessToken(shop);
      if (!accessToken) {
        throw new ShopifyError(`No access token found for shop ${shop}`);
      }

      this.shopifyGraphQLService.setAccessToken(accessToken);

      const query = `
        query {
          products(first: 10) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      `;
      const response = await retry(() => this.shopifyGraphQLService.query(query), 3);
      return response.products.edges.map((edge) => edge.node);
    } catch (error) {
      this.logger.error('Failed to get products for shop', {
        error: error.message,
        shop,
      });
      throw new ShopifyError(`Failed to get products for shop: ${error.message}`, error);
    } finally {
      span.finish();
    }
  }
}