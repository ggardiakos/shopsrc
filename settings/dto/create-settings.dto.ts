import { SettingValue } from '../types/setting-value.type';

export class CreateSettingsDto {
  type: string;
  settings: Record<string, SettingValue>;
}