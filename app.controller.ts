import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, UsePipes, ValidationPipe, UseInterceptors, Logger } from '@nestjs/common';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { AppService } from './app.service';
import { ContentfulService } from './contentful/contentful.service';
import { ShopifyGraphQLService } from './shopify/shopify-graphql.service';
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

// app.controller.ts
import { Controller, Get, Req, Res } from '@nestjs/common';
import { ShopifyAuth } from '@nestjs-shopify/auth';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ShopifyAuth()
  async getHello(@Req() req, @Res() res) {
    const shop = req.shopify.session.shop;
    const message = await this.appService.getHello(shop);
    res.send(message);
  }
}

// app.service.ts
import { Injectable } from '@nestjs/common';
import { ShopifyConnector } from '@nestjs-shopify/core';

@Injectable()
export class AppService {
  constructor(private readonly shopify: ShopifyConnector) {}

  async getHello(shop: string): Promise<string> {
    const client = await this.shopify.getOfflineClient(shop);
    const shopInfo = await client.shop.get();
    return `Hello ${shopInfo.name}!`;
  }
}


@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly contentfulService: ContentfulService,
    private readonly shopifyService: ShopifyGraphQLService
  ) {}

  @Get()
  getHello(): string {
    this.logger.log('Handling GET request for hello');
    return this.appService.getHello();
  }

  @Get('data')
  @UseInterceptors(CacheInterceptor)
  async getData() {
    this.logger.log('Handling GET request for data');
    return this.appService.getData();
  }

  // Contentful Product Operations
  @Get('contentful/products')
  async getContentfulProducts(): Promise<Product[]> {
    this.logger.log('Fetching all products from Contentful');
    return this.contentfulService.getProducts();
  }

  @Get('contentful/products/:id')
  async getContentfulProductById(@Param('id') id: string): Promise<Product> {
    this.logger.log(`Fetching Contentful product with id: ${id}`);
    return this.contentfulService.getProductById(id);
  }

  @Post('contentful/products')
  @UsePipes(new ValidationPipe())
  async createContentfulProduct(@Body() createProductInput: CreateProductInput): Promise<Product> {
    this.logger.log('Creating new product in Contentful');
    return this.contentfulService.createProduct(createProductInput);
  }

  @Post('contentful/products/:id')
  @UsePipes(new ValidationPipe())
  async updateContentfulProduct(@Param('id') id: string, @Body() updateProductInput: UpdateProductInput): Promise<Product> {
    this.logger.log(`Updating Contentful product with id: ${id}`);
    return this.contentfulService.updateProduct({ ...updateProductInput, id });
  }

  @Delete('contentful/products/:id')
  async deleteContentfulProduct(@Param('id') id: string): Promise<void> {
    this.logger.log(`Deleting Contentful product with id: ${id}`);
    return this.contentfulService.deleteProduct(id);
  }

  @Get('contentful/products/compare')
  async compareContentfulProducts(@Query('ids') ids: string[]): Promise<ProductComparison> {
    this.logger.log(`Comparing Contentful products with ids: ${ids.join(', ')}`);
    return this.contentfulService.compareProducts(ids);
  }

  @Get('contentful/products/:id/customization-options')
  async getContentfulCustomizationOptions(@Param('id') productId: string): Promise<CustomizationOption[]> {
    this.logger.log(`Fetching customization options for Contentful product with id: ${productId}`);
    return this.contentfulService.getCustomizationOptions(productId);
  }

  @Post('contentful/products/:id/customize')
  @UsePipes(new ValidationPipe())
  async customizeContentfulProduct(@Param('id') productId: string, @Body() customizeProductInput: CustomizeProductInput): Promise<CustomizedProduct> {
    this.logger.log(`Customizing Contentful product with id: ${productId}`);
    return this.contentfulService.customizeProduct({ ...customizeProductInput, productId });
  }

  // Contentful Collection Operations
  @Get('contentful/collections/:id')
  async getContentfulCollectionById(@Param('id') id: string): Promise<Collection> {
    this.logger.log(`Fetching Contentful collection with id: ${id}`);
    return this.contentfulService.getCollectionById(id);
  }

  @Post('contentful/collections')
  @UsePipes(new ValidationPipe())
  async createContentfulCollection(@Body() createCollectionInput: CreateCollectionInput): Promise<Collection> {
    this.logger.log('Creating new collection in Contentful');
    return this.contentfulService.createCollection(createCollectionInput);
  }

  // Contentful Order Operations
  @Get('contentful/orders/:id')
  async getContentfulOrderById(@Param('id') id: string): Promise<Order> {
    this.logger.log(`Fetching Contentful order with id: ${id}`);
    return this.contentfulService.getOrderById(id);
  }

  @Post('contentful/orders')
  @UsePipes(new ValidationPipe())
  async createContentfulOrder(@Body() orderItems: OrderItemInput[]): Promise<Order> {
    this.logger.log('Creating new order in Contentful');
    return this.contentfulService.createOrder(orderItems);
  }

  // Shopify Product Operations
  @Get('shopify/products/:id')
  async getShopifyProduct(@Param('id') id: string, @Query('accessToken') accessToken?: string) {
    this.logger.log(`Fetching Shopify product with id: ${id}`);
    const result = await this.shopifyService.getProduct(id, accessToken);
    if (result.isLeft()) {
      throw result.value;
    }
    return result.value;
  }

  @Get('shopify/products')
  async getAllShopifyProducts(@Query('accessToken') accessToken?: string) {
    this.logger.log('Fetching all Shopify products');
    const result = await this.shopifyService.findAll(accessToken);
    if (result.isLeft()) {
      throw result.value;
    }
    return result.value;
  }
}