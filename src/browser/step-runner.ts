import type { Page, Locator as PwLocator } from 'playwright';
import {
  describeLocator,
  type Locator,
  type TestStep,
} from '../test-steps/test-step.schema.js';
import { resolveNavigationUrl } from './navigation-policy.js';
import { StepFailure } from './step-error.js';

export interface StepContext {
  page: Page;
  baseUrl: string;
  /** Upper bound for waits and assertions in this step. */
  timeoutMs: number;
}

type AriaRole = Parameters<Page['getByRole']>[0];

const POLL_INTERVAL_MS = 100;

/** Translates one structured step into Playwright calls. Throws when the step fails. */
export async function runStep(step: TestStep, ctx: StepContext): Promise<void> {
  const { page, timeoutMs } = ctx;

  switch (step.action) {
    case 'navigate':
      await page.goto(resolveNavigationUrl(ctx.baseUrl, step.value), {
        waitUntil: 'load',
      });
      return;

    case 'click':
      await locate(page, step.target).click({ timeout: timeoutMs });
      return;

    case 'fill':
      await locate(page, step.target).fill(step.value, { timeout: timeoutMs });
      return;

    case 'select':
      // Matches an <option> by value or by visible label.
      await locate(page, step.target).selectOption(step.value, {
        timeout: timeoutMs,
      });
      return;

    case 'check':
      await locate(page, step.target).check({ timeout: timeoutMs });
      return;

    case 'uncheck':
      await locate(page, step.target).uncheck({ timeout: timeoutMs });
      return;

    case 'press':
      if (step.target) {
        await locate(page, step.target).press(step.value, { timeout: timeoutMs });
      } else {
        await page.keyboard.press(step.value);
      }
      return;

    case 'wait':
      await page.waitForTimeout(Number(step.value));
      return;

    case 'assertVisible':
      await waitForState(page, step.target, 'visible', timeoutMs);
      return;

    case 'assertHidden':
      await waitForState(page, step.target, 'hidden', timeoutMs);
      return;

    case 'assertText': {
      const locator = locate(page, step.target);
      const { ok, last } = await pollUntil(
        () => locator.innerText({ timeout: POLL_INTERVAL_MS * 5 }),
        (text) => text.includes(step.value),
        timeoutMs,
      );
      if (!ok) {
        throw new StepFailure(
          last === undefined
            ? `Expected ${describeLocator(step.target)} to contain "${step.value}", but the element was not found`
            : `Expected ${describeLocator(step.target)} to contain "${step.value}", but its text was "${truncate(last)}"`,
        );
      }
      return;
    }

    case 'assertUrl': {
      const { ok, last } = await pollUntil(
        () => Promise.resolve(page.url()),
        (url) => url.includes(step.value),
        timeoutMs,
      );
      if (!ok) {
        throw new StepFailure(
          `Expected the URL to contain "${step.value}", but it was "${last}"`,
        );
      }
      return;
    }

    case 'assertTitle': {
      const { ok, last } = await pollUntil(
        () => page.title(),
        (title) => title.includes(step.value),
        timeoutMs,
      );
      if (!ok) {
        throw new StepFailure(
          `Expected the page title to contain "${step.value}", but it was "${truncate(last ?? '')}"`,
        );
      }
      return;
    }
  }
}

export function locate(page: Page, target: Locator): PwLocator {
  switch (target.type) {
    case 'css':
      return page.locator(target.value);
    case 'text':
      return page.getByText(target.value);
    case 'role':
      return page.getByRole(target.value as AriaRole, {
        ...(target.name && { name: target.name }),
      });
    case 'label':
      return page.getByLabel(target.value);
    case 'placeholder':
      return page.getByPlaceholder(target.value);
    case 'testId':
      return page.getByTestId(target.value);
  }
}

async function waitForState(
  page: Page,
  target: Locator,
  state: 'visible' | 'hidden',
  timeoutMs: number,
): Promise<void> {
  try {
    await locate(page, target).waitFor({ state, timeout: timeoutMs });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new StepFailure(
        `Expected ${describeLocator(target)} to be ${state} within ${timeoutMs} ms`,
      );
    }
    throw error;
  }
}

/** Re-reads a value until it satisfies `ok` or the timeout elapses. Read errors count as "not yet". */
async function pollUntil<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  timeoutMs: number,
): Promise<{ ok: boolean; last: T | undefined }> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    try {
      last = await read();
      if (ok(last)) return { ok: true, last };
    } catch {
      // Element missing or detached mid-navigation: retry until the deadline.
    }
    if (Date.now() >= deadline) return { ok: false, last };
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function truncate(text: string, max = 200): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
}
