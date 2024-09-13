import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { QueueModule } from '../queue/queue.module';
import { ShopifyWebhooksService } from './webhooks.service';

@Module({
  imports: [QueueModule],
  controllers: [WebhooksController],
  providers: [ShopifyWebhooksService],
  exports: [ShopifyWebhooksService],
})
export class WebhooksModule {}