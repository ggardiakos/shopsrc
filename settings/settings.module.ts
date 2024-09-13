import { Module } from '@nestjs/common';
import { ShopifyModule } from '../shopify/shopify.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [ShopifyModule, LoggerModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}