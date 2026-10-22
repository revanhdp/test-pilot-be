import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export const IS_PUBLIC = 'auth:isPublic';

/** Skips the global session guard for a route or controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The signed-in user. Only valid on routes protected by the session guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new UnauthorizedException('Authentication required');
    return user;
  },
);
