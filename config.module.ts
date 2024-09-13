import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes the config module globally available
      envFilePath: ['.env'], // Specify your env file path
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class AppConfigModule {}
