import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_URL: z.url().default('http://localhost:4000'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  STORAGE_DIR: z.string().min(1).default('./storage'),
  RUNNER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  BROWSER_HEADLESS: z.stringbool().default(true),
  STEP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  TEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(600_000)
    .default(120_000),
});

export interface RunnerConfig {
  concurrency: number;
  headless: boolean;
  stepTimeoutMs: number;
  testTimeoutMs: number;
}

/** Typed, validated configuration. Injected by class token. */
export class AppConfig {
  readonly isProduction: boolean;
  readonly port: number;
  readonly databaseUrl: string;
  readonly appUrl: string;
  readonly sessionTtlMs: number;
  /** Absolute path. */
  readonly storageDir: string;
  readonly runner: RunnerConfig;

  constructor(env: z.output<typeof envSchema>) {
    this.isProduction = env.NODE_ENV === 'production';
    this.port = env.PORT;
    this.databaseUrl = env.DATABASE_URL;
    this.appUrl = env.APP_URL.replace(/\/+$/, '');
    this.sessionTtlMs = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
    this.storageDir = resolve(env.STORAGE_DIR);
    this.runner = {
      concurrency: env.RUNNER_CONCURRENCY,
      headless: env.BROWSER_HEADLESS,
      stepTimeoutMs: env.STEP_TIMEOUT_MS,
      testTimeoutMs: env.TEST_TIMEOUT_MS,
    };
  }

  static fromEnvironment(): AppConfig {
    // Real environment variables win over .env (loadEnvFile never overrides).
    if (existsSync('.env')) process.loadEnvFile('.env');
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment configuration:\n${z.prettifyError(parsed.error)}`,
      );
    }
    return new AppConfig(parsed.data);
  }
}
