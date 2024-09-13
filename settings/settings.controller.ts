import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseFilters,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { CreateSettingsDto } from './dto/create-settings.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingValue } from './types/setting-value.type';

@Controller('settings')
@UseFilters(HttpExceptionFilter)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get(':type')
  async getSettings(@Param('type') type: string): Promise<UpdateSettingsDto> {
    try {
      return await this.settingsService.getSettings(type);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to get settings for type: ${type}`);
    }
  }

  @Post()
  async createSettings(@Body() createSettingsDto: CreateSettingsDto): Promise<UpdateSettingsDto> {
    try {
      return await this.settingsService.createSettings(createSettingsDto);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to create settings');
    }
  }

  @Put(':type')
  async updateSettings(
    @Param('type') type: string,
    @Body() updateSettingsDto: UpdateSettingsDto,
  ): Promise<Record<string, SettingValue>> {
    try {
      return await this.settingsService.updateSettings({ type, settings: updateSettingsDto.settings });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to update settings for type: ${type}`);
    }
  }

  @Delete(':type')
  async deleteSettings(@Param('type') type: string) {
    try {
      return await this.settingsService.deleteSettings(type);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to delete settings for type: ${type}`);
    }
  }
}
