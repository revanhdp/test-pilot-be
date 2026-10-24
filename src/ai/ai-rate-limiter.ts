import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { AiException } from './ai-errors.js';

const WINDOW_MS = 60 * 60 * 1000;

/**
 * Per-user sliding window for AI generations, so one person can't use up the
 * shared free quota. In memory: it resets when the API restarts, which only
 * ever errs on the side of allowing a few extra calls.
 */
@Injectable()
export class AiRateLimiter {
  private readonly calls = new Map<string, number[]>();

  constructor(private readonly config: AppConfig) {}

  /** Records one use, or throws `AI_USER_LIMIT` with the time until a slot frees up. */
  take(userId: string, now = Date.now()): void {
    const recent = (this.calls.get(userId) ?? []).filter(
      (at) => now - at < WINDOW_MS,
    );
    if (recent.length >= this.config.ai.generationsPerHour) {
      throw AiException.userLimit(
        Math.ceil((recent[0]! + WINDOW_MS - now) / 1000),
      );
    }
    this.calls.set(userId, [...recent, now]);
  }

  /** Gives a slot back when the call never reached the provider. */
  refund(userId: string): void {
    this.calls.get(userId)?.pop();
  }
}
