import 'dd-trace/init';
import tracer from 'dd-trace';
import { Controller, Get, Req, Res, Logger, UseGuards } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { ShopifyAuthAfterHandler, ShopifyAuth, UseShopifyAuth } from '@nestjs-shopify/auth';
import { ShopifyAuthService } from '../services/shopify-auth.service';
import { ShopifyAuthGuard } from '@nestjs-shopify/auth';



@Controller('auth/shopify')
export class ShopifyAuthController implements ShopifyAuthAfterHandler {
  private readonly logger = new Logger(ShopifyAuthController.name);

  constructor(
    private readonly shopifyAuthService: ShopifyAuthService,
    private readonly shopifyAuth: ShopifyAuth
  ) {}

  @Get('login')
  async login(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    const span = tracer.startSpan('shopify.auth.login');
    try {
      const shop = (req.query as { shop?: string }).shop;
      if (!shop) {
        this.logger.warn('Login attempt without shop parameter');
        return res.status(400).send({ error: 'Missing shop parameter' });
      }
      this.logger.log(`Initiating auth for shop: ${shop}`);
      await this.shopifyAuthService.initiateAuth(req, res, shop);
      // The redirection is handled by @nestjs-shopify/auth
    } catch (error) {
      this.logger.error(`Error during login: ${error.message}`, error.stack);
      res.status(500).send({ error: 'Internal server error' });
    } finally {
      span.finish();
    }
  }

  @Get('callback')
  @UseShopifyAuth()
  async callback(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    const span = tracer.startSpan('shopify.auth.callback');
    try {
      this.logger.log('Processing auth callback');
      await this.shopifyAuthService.validateShopifyAuth(req, res);
    } catch (error) {
      this.logger.error(`Authentication failed: ${error.message}`, error.stack);
      res.status(400).send({ error: 'Authentication failed' });
    } finally {
      span.finish();
    }
  }

  @UseGuards(ShopifyAuthGuard)
  async afterAuth(req: FastifyRequest, res: FastifyReply, session: any) {
    const span = tracer.startSpan('shopify.auth.afterAuth');
    try {
      this.logger.log('Executing post-authentication logic');
      // Your post-authentication logic here
      // For example, you might want to store the session, update user data, etc.
      
      const shop = session.shop;
      const accessToken = session.accessToken;
      
      if (shop && accessToken) {
        await this.shopifyAuthService.setShopAccessToken(shop, accessToken);
        this.logger.log(`Access token set for shop: ${shop}`);
      }

      // Redirect to dashboard or appropriate page
      const redirectUrl = '/dashboard';
      this.logger.log(`Redirecting to: ${redirectUrl}`);
      res.redirect(302, redirectUrl);
    } catch (error) {
      this.logger.error(`Error in afterAuth: ${error.message}`, error.stack);
      res.status(500).send({ error: 'Internal server error' });
    } finally {
      span.finish();
    }
  }

  @Get('logout')
  @UseGuards(ShopifyAuthGuard)
  async logout(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    const span = tracer.startSpan('shopify.auth.logout');
    try {
      this.logger.log('Processing logout request');
      await this.shopifyAuth.logout(req, res);
      res.redirect(302, '/');
    } catch (error) {
      this.logger.error(`Error during logout: ${error.message}`, error.stack);
      res.status(500).send({ error: 'Internal server error' });
    } finally {
      span.finish();
    }
  }
}