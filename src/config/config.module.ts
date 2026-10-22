import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app-config.js';

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => AppConfig.fromEnvironment() }],
  exports: [AppConfig],
})
export class ConfigModule {}
