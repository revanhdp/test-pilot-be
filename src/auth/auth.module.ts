import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { ClerkGuard } from './clerk.guard.js';
import { ClerkUserService } from './clerk-user.service.js';

@Module({
  controllers: [AuthController],
  providers: [ClerkUserService, { provide: APP_GUARD, useClass: ClerkGuard }],
})
export class AuthModule {}
