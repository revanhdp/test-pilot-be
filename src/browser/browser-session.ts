import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { OrderedTestStep } from '../test-steps/test-step.schema.js';
import { formatStepError, StepFailure } from './step-error.js';
import { runStep } from './step-runner.js';

export interface SessionOptions {
  stepTimeoutMs: number;
  testTimeoutMs: number;
}

export interface StepOutcome {
  order: number;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  error?: string;
}

export interface TestExecution {
  status: 'PASSED' | 'FAILED';
  durationMs: number;
  errorMessage: string | null;
  failedStep: number | null;
  steps: StepOutcome[];
  finalUrl: string | null;
  pageTitle: string | null;
  screenshot: { path: string; sizeBytes: number } | null;
}

export interface ExecuteTestInput {
  baseUrl: string;
  steps: OrderedTestStep[];
  /** Absolute path where the final-state screenshot is written. */
  screenshotPath: string;
}

const VIEWPORT = { width: 1280, height: 800 };
const MIN_NAVIGATION_TIMEOUT_MS = 30_000;

/**
 * One browser process shared by the tests of a run. Each test gets a fresh,
 * isolated context (cookies, storage), so tests can't leak state into each other.
 */
export class BrowserSession {
  constructor(
    private readonly browser: Browser,
    private readonly options: SessionOptions,
  ) {}

  async execute(input: ExecuteTestInput): Promise<TestExecution> {
    const { stepTimeoutMs, testTimeoutMs } = this.options;
    const context = await this.browser.newContext({ viewport: VIEWPORT });
    context.setDefaultTimeout(stepTimeoutMs);
    context.setDefaultNavigationTimeout(
      Math.max(stepTimeoutMs, MIN_NAVIGATION_TIMEOUT_MS),
    );

    const startedAt = Date.now();
    const deadline = startedAt + testTimeoutMs;
    const outcomes: StepOutcome[] = [];
    let failure: { order: number; message: string } | null = null;

    try {
      const page = await context.newPage();

      for (const step of input.steps) {
        if (failure) {
          outcomes.push({ order: step.order, status: 'SKIPPED', durationMs: 0 });
          continue;
        }

        const stepStart = Date.now();
        try {
          const remaining = deadline - stepStart;
          if (remaining <= 0) {
            throw new StepFailure(
              `Test exceeded the maximum duration of ${testTimeoutMs} ms`,
            );
          }
          await runStep(step, {
            page,
            baseUrl: input.baseUrl,
            timeoutMs: Math.min(stepTimeoutMs, remaining),
          });
          outcomes.push({
            order: step.order,
            status: 'PASSED',
            durationMs: Date.now() - stepStart,
          });
        } catch (error) {
          const message = formatStepError(error);
          failure = { order: step.order, message };
          outcomes.push({
            order: step.order,
            status: 'FAILED',
            durationMs: Date.now() - stepStart,
            error: message,
          });
        }
      }

      const evidence = await this.captureEvidence(page, input.screenshotPath);
      return {
        status: failure ? 'FAILED' : 'PASSED',
        durationMs: Date.now() - startedAt,
        errorMessage: failure?.message ?? null,
        failedStep: failure?.order ?? null,
        steps: outcomes,
        ...evidence,
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
  }

  /** Best effort: evidence capture must never turn a result into an error. */
  private async captureEvidence(page: Page, screenshotPath: string) {
    let screenshot: TestExecution['screenshot'] = null;
    try {
      await mkdir(dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, type: 'png' });
      screenshot = {
        path: screenshotPath,
        sizeBytes: (await stat(screenshotPath)).size,
      };
    } catch {
      screenshot = null;
    }

    const finalUrl = page.url();
    const pageTitle = await page.title().catch(() => null);
    return {
      screenshot,
      finalUrl: finalUrl === 'about:blank' ? null : finalUrl,
      pageTitle: pageTitle || null,
    };
  }
}
