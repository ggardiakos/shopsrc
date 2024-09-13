import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { ShopifyService } from '../shopify/services/shopify.service';
import { CreateSettingsDto } from './dto/create-settings.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingValue } from './types/setting-value.type';

@Injectable()
export class SettingsService {
  constructor(private shopifyService: ShopifyService) {}

  async updateSettings(updateSettingsDto: UpdateSettingsDto): Promise<Record<string, SettingValue>>;
  async updateSettings(updateSettingsDto: UpdateSettingsDto): Promise<UpdateSettingsDto>;
  async updateSettings(updateSettingsDto: UpdateSettingsDto): Promise<Record<string, SettingValue> | UpdateSettingsDto> {
    try {
      const result = await this.shopifyService.mutation(
        `
          mutation updateSettings($input: MetafieldInput!) {
            metafieldSet(input: $input) {
              metafield {
                id
                key
                value
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          input: {
            namespace: "custom",
            key: updateSettingsDto.type,
            value: JSON.stringify(updateSettingsDto.settings),
            type: "json"
          }
        }
      );
  
      if (result.metafieldSet.userErrors && result.metafieldSet.userErrors.length > 0) {
        throw new BadRequestException(result.metafieldSet.userErrors[0].message);
      }
  
      return result.metafieldSet.metafield.value as Record<string, SettingValue>;
    } catch (error) {
      console.error('Error in SettingsService.updateSettings:', error);
      throw error;
    }
  }

  async createSettings(createSettingsDto: CreateSettingsDto): Promise<UpdateSettingsDto> {
    try {
      const result = await this.shopifyService.mutation(
        `
          mutation createSettings($input: MetafieldInput!) {
            metafieldSet(input: $input) {
              metafield {
                id
                key
                value
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          input: {
            namespace: "custom",
            key: createSettingsDto.type,
            value: JSON.stringify(createSettingsDto.settings),
            type: "json"
          }
        }
      );

      if (result.metafieldSet.userErrors && result.metafieldSet.userErrors.length > 0) {
        throw new BadRequestException(result.metafieldSet.userErrors[0].message);
      }

      return {
        type: result.metafieldSet.metafield.key,
        settings: JSON.parse(result.metafieldSet.metafield.value) as Record<string, SettingValue>,
      };
    } catch (error) {
      console.error('Error in SettingsService.createSettings:', error);
      throw error;
    }
  }

  async deleteSettings(type: string) {
    try {
      const settings = await this.getSettings(type);

      const result = await this.shopifyService.mutation(
        `
          mutation deleteSettings($input: MetafieldDeleteInput!) {
            metafieldDelete(input: $input) {
              deletedId
              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          input: {
            id: settings.settings.id
          }
        }
      );

      if (result.metafieldDelete.userErrors && result.metafieldDelete.userErrors.length > 0) {
        throw new BadRequestException(result.metafieldDelete.userErrors[0].message);
      }

      return result.metafieldDelete.deletedId;
    } catch (error) {
      console.error('Error in SettingsService.deleteSettings:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to delete settings for type: ${type}`);
    }
  }

  async getSettings(type: string): Promise<any> {
    try {
      console.log(`Attempting to get settings for type: ${type}`);
      const result = await this.shopifyService.query(
        `query getSettings($type: String!) {
          metafield(namespace: "custom", key: $type) {
            id
            value
          }
        }`,
        { type }
      );
      console.log(`Raw result from Shopify:`, result);
      
      if (!result.metafield) {
        throw new NotFoundException(`Settings not found for type: ${type}`);
      }
      
      const parsedValue = JSON.parse(result.metafield.value);
      console.log(`Parsed settings:`, parsedValue);
      return parsedValue;
    } catch (error) {
      console.error(`Error in SettingsService.getSettings for type ${type}:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to get settings for type: ${type}`);
    }
  }
}