import 'dd-trace/init';
import tracer from 'dd-trace';
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Logger } from '@nestjs/common';
import { ShopifyService } from '../services/shopify.service';
import { ShopifyAuthGuard } from './auth/auth.guard';
import { ProductInput, ProductUpdateInput, CollectionInput, OrderInput } from '@/graphql/types';

@Controller('shopify')
@UseGuards(ShopifyAuthGuard)
export class ShopifyController {
  private readonly logger = new Logger(ShopifyController.name);

  constructor(private readonly shopifyService: ShopifyService) {}

  @Get('products')
  async getProducts(@Query('query') query?: string) {
    const span = tracer.startSpan('shopify.controller.getProducts');
    try {
      this.logger.log('Fetching products');
      return await this.shopifyService.getProducts(query);
    } catch (error) {
      this.logger.error(`Error fetching products: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  @Get('products/:id')
  async getProductById(@Param('id') id: string) {
    const span = tracer.startSpan('shopify.controller.getProductById');
    try {
      this.logger.log(`Fetching product with id: ${id}`);
      return await this.shopifyService.getProductById(id);
    } catch (error) {
      this.logger.error(`Error fetching product ${id}: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  @Post('products')
  async createProduct(@Body() input: ProductInput) {
    const span = tracer.startSpan('shopify.controller.createProduct');
    try {
      this.logger.log('Creating new product');
      return await this.shopifyService.createProduct(input);
    } catch (error) {
      this.logger.error(`Error creating product: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  @Put('products/:id')
  async updateProduct(@Param('id') id: string, @Body() input: ProductUpdateInput) {
    const span = tracer.startSpan('shopify.controller.updateProduct');
    try {
      this.logger.log(`Updating product with id: ${id}`);
      return await this.shopifyService.updateProduct(id, input);
    } catch (error) {
      this.logger.error(`Error updating product ${id}: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  @Delete('products/:id')
  async deleteProduct(@Param('id') id: string) {
    const span = tracer.startSpan('shopify.controller.deleteProduct');
    try {
      this.logger.log(`Deleting product with id: ${id}`);
      return await this.shopifyService.deleteProduct(id);
    } catch (error) {
      this.logger.error(`Error deleting product ${id}: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  @Get('collections')
  async getCollections() {
    const span = tracer.startSpan('shopify.controller.getCollections');
    try {
      this.logger.log('Fetching collections');
      return await this.shopifyService.getCollections();
    } catch (error) {
      this.logger.error(`Error fetching collections: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  @Post('collections')
  async createCollection(@Body() input: CollectionInput) {
    const span = tracer.startSpan('shopify.controller.createCollection');
    try {
      this.logger.log('Creating new collection');
      return await this.shopifyService.createCollection(input);
    } catch (error) {
      this.logger.error(`Error creating collection: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  @Get('orders')
  async getOrders() {
    const span = tracer.startSpan('shopify.controller.getOrders');
    try {
      this.logger.log('Fetching orders');
      return await this.shopifyService.getOrders();
    } catch (error) {
      this.logger.error(`Error fetching orders: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  @Post('orders')
  async createOrder(@Body() input: OrderInput) {
    const span = tracer.startSpan('shopify.controller.createOrder');
    try {
      this.logger.log('Creating new order');
      return await this.shopifyService.createOrder(input);
    } catch (error) {
      this.logger.error(`Error creating order: ${error.message}`, error.stack);
      throw error;
    } finally {
      span.finish();
    }
  }

  // Add more Shopify-related endpoints here as needed
}