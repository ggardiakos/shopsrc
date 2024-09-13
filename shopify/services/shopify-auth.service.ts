import 'dd-trace/init';
import tracer from 'dd-trace';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import { UseShopifyAuth } from '@nestjs-shopify/auth';
import { FastifyRequest, FastifyReply } from 'fastify';
import { ShopifyService } from './shopify.service';

@Injectable()
export class ShopifyAuthService {
  private readonly logger = new Logger(ShopifyAuthService.name);
  private shopify: ReturnType<typeof shopifyApi>;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly shopifyService: ShopifyService
  ) {
    this.initializeShopify();
  }

  private initializeShopify() {
    const span = tracer.startSpan('shopify.initializeShopify');
    try {
      this.shopify = shopifyApi({
        apiKey: this.configService.get<string>('SHOPIFY_API_KEY'),
        apiSecretKey: this.configService.get<string>('SHOPIFY_API_SECRET_KEY'),
        scopes: this.configService.get<string>('SHOPIFY_API_SCOPES').split(','),
        hostName: this.configService.get<string>('SHOPIFY_HOST_NAME'),
        apiVersion: ApiVersion.April23,
        isEmbeddedApp: true,
      });
      this.logger.log('Shopify API initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Shopify API', error);
      throw error;
    } finally {
      span.finish();
    }
  }

  @UseShopifyAuth()
  async initiateAuth(req: FastifyRequest, res: FastifyReply, shop: string): Promise<void> {
    const span = tracer.startSpan('shopify.initiateAuth');
    try {
      this.logger.log(`Initiating auth for shop: ${shop}`);
      // Any pre-authentication logic you need
      // The actual redirection is handled by @nestjs-shopify/auth
    } catch (error) {
      this.logger.error(`Error initiating auth for shop: ${shop}`, error);
      throw error;
    } finally {
      span.finish();
    }
  }

  @UseShopifyAuth()
  async validateShopifyAuth(req: FastifyRequest, res: FastifyReply): Promise<void> {
    const span = tracer.startSpan('shopify.validateShopifyAuth');
    try {
      this.logger.log('Validating Shopify authentication');
      const shop = req.session.shop;
      const accessToken = req.session.accessToken;

      if (!shop || !accessToken) {
        this.logger.warn('Missing shop or accessToken in session');
        throw new Error('Invalid authentication data');
      }

      await this.shopifyService.setShopAccessToken(shop, accessToken);
      
      const afterAuthPath = this.configService.get('SHOPIFY_AFTER_AUTH_PATH');
      const redirectUrl = `${afterAuthPath}?shop=${encodeURIComponent(shop)}`;
      
      this.logger.log(`Authentication successful. Redirecting to: ${redirectUrl}`);
      res.redirect(redirectUrl);
    } catch (error) {
      this.logger.error('Error validating Shopify authentication', error);
      const authPath = this.configService.get('SHOPIFY_AUTH_PATH');
      res.redirect(authPath);
    } finally {
      span.finish();
    }
  }

  async verifyWebhook(req: FastifyRequest): Promise<boolean> {
    const span = tracer.startSpan('shopify.verifyWebhook');
    try {
      const hmac = req.headers['x-shopify-hmac-sha256'] as string;
      const topic = req.headers['x-shopify-topic'] as string;
      const shop = req.headers['x-shopify-shop-domain'] as string;

      if (!hmac || !topic || !shop) {
        this.logger.warn('Missing required headers for webhook verification');
        return false;
      }

      const rawBody = await req.body as string;
      const verified = await this.shopify.webhooks.validate({
        rawBody,
        hmac,
        topic,
        shop,
      });

      if (!verified) {
        this.logger.warn(`Invalid webhook received from shop: ${shop}, topic: ${topic}`);
      }

      return verified;
    } catch (error) {
      this.logger.error('Error verifying webhook', error);
      return false;
    } finally {
      span.finish();
    }
  }
}