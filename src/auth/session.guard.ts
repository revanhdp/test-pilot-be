import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, type AuthenticatedRequest } from './auth.decorators.js';
import { AuthService } from './auth.service.js';

export const SESSION_COOKIE = 'tp_session';

/** Global guard: every route requires a valid session unless marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = request.cookies?.[SESSION_COOKIE];
    const user =
      typeof token === 'string' ? await this.auth.resolveSession(token) : null;
    if (!user) throw new UnauthorizedException('Authentication required');

    request.user = user;
    return true;
  }
}
