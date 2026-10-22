import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { BrowserSession } from '../src/browser/browser-session.js';
import { testStepsSchema } from '../src/test-steps/test-step.schema.js';
import { createDemoSite } from './app.js';
import { bugHuntCases, type DemoTestCase } from './demo-tests.js';

/** Where each Bug Hunt test must fail on the site with planted bugs, and why. */
const EXPECTED_FAILURES: Record<string, { step: number; message: RegExp }> = {
  'Deals page opens from the navigation': {
    step: 3,
    message: /Expected heading "Summer Deals" to be visible/,
  },
  'Adding a product updates the cart count': {
    step: 3,
    message: /"#cart-count" to contain "1", but its text was "0"/,
  },
  'Search field accepts a query': {
    step: 2,
    message: /Timeout[\s\S]*#search-box/,
  },
  'Newsletter rejects an invalid email': {
    step: 4,
    message: /"valid email", but its text was "Thanks for subscribing!"/,
  },
  'Order history page loads': {
    step: 1,
    message: /GET \/orders responded with HTTP 500/,
  },
  'Sales report finishes loading': {
    step: 2,
    message: /"Report ready", but its text was "Loading report…"/,
  },
  'Admin panel requires sign-in': {
    step: 2,
    message: /to contain "\/login", but it was ".*\/admin"/,
  },
  'Product images have text alternatives': {
    step: 2,
    message: /Expected img "Trail Backpack" to be visible/,
  },
};

const runnable = bugHuntCases.filter((testCase) => testCase.steps.length > 0);

interface Site {
  server: Server;
  baseUrl: string;
}

async function startSite(fixed: boolean): Promise<Site> {
  const server = createDemoSite({ fixed });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/**
 * The Bug Hunt tests against the demo site: each one must fail where it is
 * supposed to on the site with planted bugs, and pass once the bugs are fixed.
 * That is what shows a failure comes from the bug and not from the test.
 */
describe('Bug Hunt tests (integration)', () => {
  let buggy: Site;
  let fixed: Site;
  let session: BrowserSession;
  let artifactDir: string;

  beforeAll(async () => {
    [buggy, fixed] = await Promise.all([startSite(false), startSite(true)]);
    artifactDir = await mkdtemp(join(tmpdir(), 'testpilot-bughunt-'));
    // A short step timeout keeps the failing tests quick; the slow report takes 12 s either way.
    session = new BrowserSession(await chromium.launch(), {
      stepTimeoutMs: 1_500,
      testTimeoutMs: 30_000,
    });
  }, 60_000);

  afterAll(async () => {
    await session?.close();
    await Promise.all(
      [buggy, fixed].map((site) => new Promise((resolve) => site?.server.close(resolve))),
    );
    await rm(artifactDir, { recursive: true, force: true });
  });

  const execute = (site: Site, testCase: DemoTestCase) =>
    session.execute({
      baseUrl: site.baseUrl,
      steps: testStepsSchema.parse(testCase.steps).map((step, index) => ({ ...step, order: index + 1 })),
      screenshotPath: join(artifactDir, `${testCase.title.replace(/\W+/g, '-')}.png`),
    });

  it('has an expected failure for every test that has steps', () => {
    expect(runnable.map((testCase) => testCase.title).sort()).toEqual(
      Object.keys(EXPECTED_FAILURES).sort(),
    );
  });

  it('leaves exactly one test without steps, which a run reports as skipped', () => {
    expect(bugHuntCases.filter((testCase) => testCase.steps.length === 0)).toHaveLength(1);
  });

  it.each(runnable)(
    'fails on the site with planted bugs: $title',
    async (testCase) => {
      const expected = EXPECTED_FAILURES[testCase.title]!;
      const result = await execute(buggy, testCase);

      expect(result.status).toBe('FAILED');
      expect(result.failedStep).toBe(expected.step);
      expect(result.errorMessage).toMatch(expected.message);
      expect(result.screenshot).not.toBeNull();
    },
    30_000,
  );

  it.each(runnable)(
    'passes once the bugs are fixed: $title',
    async (testCase) => {
      const result = await execute(fixed, testCase);
      expect(result.errorMessage).toBeNull();
      expect(result.status).toBe('PASSED');
    },
    30_000,
  );
});
