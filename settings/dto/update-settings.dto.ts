import { IsString, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SettingValue {
  [key: string]: string | number | boolean | object;
}

export class UpdateSettingsDto {
  @IsString()
  type: string;

  @IsObject()
  @ValidateNested()
  @Type(() => SettingValue)
  settings: SettingValue;
}