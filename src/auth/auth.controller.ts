import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthUser } from './auth.decorators.js';

@Controller('auth')
export class AuthController {
  /** Sign-in, sign-up and password flows live in Clerk. This returns the local user. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
