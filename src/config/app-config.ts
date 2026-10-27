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
  // Clerk (auth). The secret key verifies session tokens.
  CLERK_SECRET_KEY: z.string().trim().min(1, 'CLERK_SECRET_KEY is required'),
  STORAGE_DIR: z.string().min(1).default('./storage'),
  RUNNER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  BROWSER_HEADLESS: z.stringbool().default(true),
  STEP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  TEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(600_000)
    .default(120_000),
  // AI features. Without a key they are switched off, nothing else changes.
  GROQ_API_KEY: z.string().trim().optional(),
  GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
  AI_GENERATIONS_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .default(10),
});

export interface AiConfig {
  /** Absent when no provider key is configured. */
  groqApiKey: string | null;
  groqModel: string;
  generationsPerHour: number;
}

export interface RunnerConfig {
  concurrency: number;
  headless: boolean;
  stepTimeoutMs: number;
  testTimeoutMs: number;
}

/** Typed, validated configuration. Injected by class token. */
export class AppConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly appUrl: string;
  readonly clerkSecretKey: string;
  /** Absolute path. */
  readonly storageDir: string;
  readonly runner: RunnerConfig;
  readonly ai: AiConfig;

  constructor(env: z.output<typeof envSchema>) {
    this.port = env.PORT;
    this.databaseUrl = env.DATABASE_URL;
    this.appUrl = env.APP_URL.replace(/\/+$/, '');
    this.clerkSecretKey = env.CLERK_SECRET_KEY;
    this.storageDir = resolve(env.STORAGE_DIR);
    this.runner = {
      concurrency: env.RUNNER_CONCURRENCY,
      headless: env.BROWSER_HEADLESS,
      stepTimeoutMs: env.STEP_TIMEOUT_MS,
      testTimeoutMs: env.TEST_TIMEOUT_MS,
    };
    this.ai = {
      groqApiKey: env.GROQ_API_KEY || null,
      groqModel: env.GROQ_MODEL,
      generationsPerHour: env.AI_GENERATIONS_PER_HOUR,
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
