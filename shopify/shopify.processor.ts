import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

@Processor('shopify')
export class ShopifyProcessor {
  private readonly logger = new Logger(ShopifyProcessor.name);

  @Process('syncShopData')
  async handleSyncShopData(job: Job) {
    this.logger.debug('Start syncing shop data...');
    const { shop, accessToken } = job.data;
    // Implement shop data synchronization logic here
    this.logger.debug('Finished syncing shop data');
  }
}