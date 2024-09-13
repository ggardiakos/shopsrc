import { IsString, IsNumber, IsBoolean, IsObject } from 'class-validator';

export class SettingValueClass {
  [key: string]: string | number | boolean | object;

  @IsString()
  stringValue?: string;

  @IsNumber()
  numberValue?: number;

  @IsBoolean()
  booleanValue?: boolean;

  @IsObject()
  objectValue?: object;

  // You can add methods here in the future
  // For example:
  // validate(): boolean {
  //   // Custom validation logic
  // }
}

export type SettingValue = {
  // Your type definition here
};