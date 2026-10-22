import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(AppConfig);

  // Behind Nginx on the same host: trust it for the client IP (used by rate limiting).
  app.set('trust proxy', 'loopback');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.appUrl, credentials: true });
  app.enableShutdownHooks();

  await app.listen(config.port);
}
await bootstrap();
