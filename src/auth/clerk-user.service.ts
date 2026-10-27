import { ConflictException, Injectable } from '@nestjs/common';
import { createClerkClient, type User as ClerkUser } from '@clerk/backend';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from './auth.decorators.js';

const SELECT = { id: true, email: true, name: true } as const;
const PENDING_PREFIX = 'pending:';

/**
 * Maps a Clerk user to the local `users` row that owns projects and runs.
 * Clerk is the source of truth for identity; the row is created on first sight.
 */
@Injectable()
export class ClerkUserService {
  private readonly clerk;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfig,
  ) {
    this.clerk = createClerkClient({ secretKey: config.clerkSecretKey });
  }

  async resolve(clerkId: string): Promise<AuthUser> {
    const existing = await this.prisma.user.findUnique({
      where: { clerkId },
      select: SELECT,
    });
    if (existing) return existing;
    return this.provision(clerkId);
  }

  private async provision(clerkId: string): Promise<AuthUser> {
    const clerkUser = await this.clerk.users.getUser(clerkId);
    const primary = clerkUser.emailAddresses.find(
      (address) => address.id === clerkUser.primaryEmailAddressId,
    );
    if (!primary)
      throw new ConflictException('This account has no email address');
    const email = primary.emailAddress.toLowerCase();
    const name = displayName(clerkUser, email);

    try {
      // A seeded or migrated user is linked by email, but only when Clerk has
      // verified that the person owns it.
      if (primary.verification?.status === 'verified') {
        const linked = await this.prisma.user.updateManyAndReturn({
          where: { email, clerkId: { startsWith: PENDING_PREFIX } },
          data: { clerkId },
          select: SELECT,
        });
        if (linked[0]) return linked[0];
      }
      return await this.prisma.user.create({
        data: { clerkId, email, name },
        select: SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Parallel first requests race to create the same row: the loser reads it.
        const raced = await this.prisma.user.findUnique({
          where: { clerkId },
          select: SELECT,
        });
        if (raced) return raced;
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      throw error;
    }
  }
}

function displayName(user: ClerkUser, email: string): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return (full || user.username || email.split('@')[0] || email).slice(0, 100);
}
