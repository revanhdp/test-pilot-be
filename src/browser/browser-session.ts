import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { OrderedTestStep } from '../test-steps/test-step.schema.js';
import { resolveNavigationUrl } from './navigation-policy.js';
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

/** Cookies and local storage of a signed-in browser context. Kept in memory, never stored. */
export type SessionState = Awaited<ReturnType<BrowserContext['storageState']>>;

export interface PageInspection {
  url: string;
  status: number | null;
  title: string | null;
  /** Playwright's ARIA snapshot (YAML): roles with their accessible names. */
  accessibilityTree: string;
}

export interface ExecuteTestInput {
  baseUrl: string;
  steps: OrderedTestStep[];
  /** Absolute path where the final-state screenshot is written. Omit for no screenshot. */
  screenshotPath?: string;
  /** Start from this session instead of a signed-out browser. */
  sessionState?: SessionState;
}

const VIEWPORT = { width: 1280, height: 800 };
const MIN_NAVIGATION_TIMEOUT_MS = 30_000;

/**
 * One browser process shared by the tests of a run. Each test gets a fresh,
 * isolated context (cookies, storage), so tests can't leak state into each other.
 * A test that starts signed in gets a fresh context seeded with the run's session.
 */
export class BrowserSession {
  constructor(
    private readonly browser: Browser,
    private readonly options: SessionOptions,
  ) {}

  async execute(input: ExecuteTestInput): Promise<TestExecution> {
    const context = await this.newContext(input.sessionState);
    try {
      return await this.runSteps(context, input);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  /**
   * Runs sign-in steps like a test. When they pass, also returns the session they
   * leave behind, so tests can start from it without signing in again.
   */
  async signIn(
    input: Omit<ExecuteTestInput, 'sessionState'>,
  ): Promise<{ execution: TestExecution; sessionState: SessionState | null }> {
    const context = await this.newContext();
    try {
      const execution = await this.runSteps(context, input);
      const sessionState =
        execution.status === 'PASSED' ? await context.storageState() : null;
      return { execution, sessionState };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  /**
   * Opens one page, signed out, and returns its accessibility tree as text: the
   * roles and accessible names a test can target. Same origin rule as `navigate`.
   */
  async inspect(baseUrl: string, path: string): Promise<PageInspection> {
    const url = resolveNavigationUrl(baseUrl, path);
    const context = await this.newContext();
    try {
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'load' });
      return {
        url: page.url(),
        status: response?.status() ?? null,
        title: (await page.title().catch(() => '')) || null,
        accessibilityTree: await page.locator('body').ariaSnapshot(),
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  /**
   * Runs steps in a throwaway signed-out context and describes the page they
   * leave behind, without a screenshot. Used to see what an action reveals
   * (messages, dialogs) before writing assertions for it.
   */
  async probe(
    baseUrl: string,
    steps: OrderedTestStep[],
  ): Promise<{ execution: TestExecution; page: PageInspection | null }> {
    const context = await this.newContext();
    try {
      const execution = await this.runSteps(context, { baseUrl, steps });
      const page = context.pages()[0];
      if (!page || execution.status !== 'PASSED')
        return { execution, page: null };
      return {
        execution,
        page: {
          url: page.url(),
          status: null,
          title: (await page.title().catch(() => '')) || null,
          accessibilityTree: await page.locator('body').ariaSnapshot(),
        },
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
  }

  private async newContext(
    sessionState?: SessionState,
  ): Promise<BrowserContext> {
    const { stepTimeoutMs } = this.options;
    const context = await this.browser.newContext({
      viewport: VIEWPORT,
      storageState: sessionState,
    });
    context.setDefaultTimeout(stepTimeoutMs);
    context.setDefaultNavigationTimeout(
      Math.max(stepTimeoutMs, MIN_NAVIGATION_TIMEOUT_MS),
    );
    return context;
  }

  private async runSteps(
    context: BrowserContext,
    input: ExecuteTestInput,
  ): Promise<TestExecution> {
    const { stepTimeoutMs, testTimeoutMs } = this.options;
    const startedAt = Date.now();
    const deadline = startedAt + testTimeoutMs;
    const outcomes: StepOutcome[] = [];
    let failure: { order: number; message: string } | null = null;

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

    const evidence = await this.captureEvidence(
      page,
      input.screenshotPath ?? null,
    );
    return {
      status: failure ? 'FAILED' : 'PASSED',
      durationMs: Date.now() - startedAt,
      errorMessage: failure?.message ?? null,
      failedStep: failure?.order ?? null,
      steps: outcomes,
      ...evidence,
    };
  }

  /** Best effort: evidence capture must never turn a result into an error. */
  private async captureEvidence(page: Page, screenshotPath: string | null) {
    let screenshot: TestExecution['screenshot'] = null;
    try {
      if (screenshotPath) {
        await mkdir(dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, type: 'png' });
        screenshot = {
          path: screenshotPath,
          sizeBytes: (await stat(screenshotPath)).size,
        };
      }
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
