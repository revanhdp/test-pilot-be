import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyToken } from '@clerk/backend';
import { AppConfig } from '../config/app-config.js';
import { IS_PUBLIC, type AuthenticatedRequest } from './auth.decorators.js';
import { ClerkUserService } from './clerk-user.service.js';

/** Global guard: every route requires a valid Clerk session token unless marked @Public(). */
@Injectable()
export class ClerkGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
    private readonly users: ClerkUserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedException('Authentication required');

    let clerkId: string;
    try {
      const claims = await verifyToken(token, {
        secretKey: this.config.clerkSecretKey,
        // Only tokens minted for the web app's origin.
        authorizedParties: [new URL(this.config.appUrl).origin],
      });
      clerkId = claims.sub;
    } catch {
      throw new UnauthorizedException('Authentication required');
    }

    request.user = await this.users.resolve(clerkId);
    return true;
  }
}

function bearerToken(request: AuthenticatedRequest): string | null {
  const header = request.get('authorization');
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1] ?? null;
}
