import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Public, type AuthenticatedRequest } from './auth.decorators.js';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from './auth.schemas.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { SESSION_COOKIE } from './session.guard.js';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.register(input, this.meta(req));
    this.setSessionCookie(res, session);
    return { user: session.user };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(input, this.meta(req));
    this.setSessionCookie(res, session);
    return { user: session.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') await this.auth.logout(token);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  /** Public so signed-out visitors get `{ user: null }` instead of a 401. */
  @Public()
  @SkipThrottle()
  @Get('me')
  async me(@Req() req: AuthenticatedRequest) {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const user =
      typeof token === 'string' ? await this.auth.resolveSession(token) : null;
    return { user };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) input: { email: string },
  ) {
    await this.auth.requestPasswordReset(input.email);
    return {
      message: 'If an account exists for this email, a reset link has been sent.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) input: ResetPasswordInput,
  ) {
    await this.auth.resetPassword(input);
  }

  private meta(req: AuthenticatedRequest) {
    return { userAgent: req.get('user-agent'), ipAddress: req.ip };
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.isProduction,
      path: '/',
    };
  }

  private setSessionCookie(res: Response, session: IssuedSession) {
    res.cookie(SESSION_COOKIE, session.token, {
      ...this.cookieOptions(),
      expires: session.expiresAt,
    });
  }
}
