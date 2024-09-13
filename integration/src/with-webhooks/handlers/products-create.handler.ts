import {
  ShopifyWebhookHandler,
  WebhookHandler,
} from '@nestjs-shopify/webhooks';

@WebhookHandler('PRODUCTS_CREATE')
export class ProductsCreateHandler extends ShopifyWebhookHandler {
  async handle(_shop: string, _data: unknown): Promise<void> {
    // process the data
  }
}
