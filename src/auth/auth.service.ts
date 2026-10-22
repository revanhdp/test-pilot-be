import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import type { AuthUser } from './auth.decorators.js';
import type {
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.schemas.js';
import { generateToken, hashToken } from './tokens.js';

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown, so timing doesn't reveal which accounts exist. */
  private readonly dummyHash = hash('testpilot-timing-equalizer');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly mail: MailService,
  ) {}

  async register(input: RegisterInput, meta: SessionMeta): Promise<IssuedSession> {
    const passwordHash = await hash(input.password);
    try {
      const user = await this.prisma.user.create({
        data: { name: input.name, email: input.email, passwordHash },
        select: { id: true, email: true, name: true },
      });
      return this.createSession(user, meta);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  async login(input: LoginInput, meta: SessionMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    const valid = await verify(
      user?.passwordHash ?? (await this.dummyHash),
      input.password,
    );
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.createSession(
      { id: user.id, email: user.email, name: user.name },
      meta,
    );
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }

  /** Returns the session's user, or null when the token is unknown or expired. */
  async resolveSession(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } });
      return null;
    }
    return session.user;
  }

  /** Always resolves, whether or not the email exists. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const token = generateToken();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      }),
    ]);

    const url = `${this.config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.sendPasswordReset(user.email, url);
  }

  /** Sets the new password and signs the user out everywhere. */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException(
        'This reset link is invalid or has expired. Request a new one.',
      );
    }

    const passwordHash = await hash(input.password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.session.deleteMany({ where: { userId: record.userId } }),
    ]);
  }

  private async createSession(
    user: AuthUser,
    meta: SessionMeta,
  ): Promise<IssuedSession> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMs);
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 500),
        ipAddress: meta.ipAddress,
      },
    });
    return { token, expiresAt, user };
  }
}
