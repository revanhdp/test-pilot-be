import { mkdtemp, rm, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createDemoSite, DEMO_CREDENTIALS } from '../../demo-site/app.js';
import { testStepsSchema } from '../test-steps/test-step.schema.js';
import { BrowserSession } from './browser-session.js';

/** Runs real Chromium against the local demo site. */
describe('BrowserSession (integration)', () => {
  let server: Server;
  let baseUrl: string;
  let session: BrowserSession;
  let artifactDir: string;

  beforeAll(async () => {
    server = createDemoSite();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    artifactDir = await mkdtemp(join(tmpdir(), 'testpilot-'));
    session = new BrowserSession(await chromium.launch(), {
      stepTimeoutMs: 3_000,
      testTimeoutMs: 30_000,
    });
  }, 60_000);

  afterAll(async () => {
    await session?.close();
    await new Promise((resolve) => server?.close(resolve));
    await rm(artifactDir, { recursive: true, force: true });
  });

  const run = (name: string, steps: unknown[]) =>
    session.execute({
      baseUrl,
      steps: testStepsSchema
        .parse(steps)
        .map((step, i) => ({ ...step, order: i + 1 })),
      screenshotPath: join(artifactDir, `${name}.png`),
    });

  it('passes a valid login flow and captures a screenshot', async () => {
    const result = await run('login', [
      { action: 'navigate', value: '/login' },
      {
        action: 'fill',
        target: { type: 'label', value: 'Email' },
        value: DEMO_CREDENTIALS.email,
      },
      { action: 'fill', target: '#password', value: DEMO_CREDENTIALS.password },
      {
        action: 'click',
        target: { type: 'role', value: 'button', name: 'Sign in' },
      },
      { action: 'assertUrl', value: '/account' },
      { action: 'assertText', target: 'h1', value: 'Welcome back' },
    ]);

    expect(result.status).toBe('PASSED');
    expect(result.steps.map((s) => s.status)).toEqual(Array(6).fill('PASSED'));
    expect(result.finalUrl).toBe(`${baseUrl}/account`);
    expect(result.pageTitle).toBe('Account · Acme Store');
    expect(result.screenshot).not.toBeNull();
    expect((await stat(result.screenshot!.path)).size).toBeGreaterThan(1000);
  }, 30_000);

  it('fails on the assertion that catches the checkout bug and skips the rest', async () => {
    const result = await run('checkout', [
      { action: 'navigate', value: '/checkout' },
      {
        action: 'fill',
        target: { type: 'label', value: 'Card number' },
        value: '4111 1111',
      },
      {
        action: 'click',
        target: { type: 'role', value: 'button', name: 'Pay $49.00' },
      },
      {
        action: 'assertText',
        target: { type: 'role', value: 'alert' },
        value: 'Card number is invalid',
      },
      { action: 'assertUrl', value: '/checkout' },
    ]);

    expect(result.status).toBe('FAILED');
    expect(result.failedStep).toBe(4);
    expect(result.errorMessage).toContain('Something went wrong');
    expect(result.steps.map((s) => s.status)).toEqual([
      'PASSED',
      'PASSED',
      'PASSED',
      'FAILED',
      'SKIPPED',
    ]);
    expect(result.screenshot).not.toBeNull();
  }, 30_000);

  it('fails a step whose element does not exist', async () => {
    const result = await run('missing', [
      { action: 'navigate', value: '/' },
      { action: 'click', target: '#does-not-exist' },
    ]);
    expect(result.status).toBe('FAILED');
    expect(result.failedStep).toBe(2);
    expect(result.errorMessage).toMatch(/Timeout/);
  }, 30_000);

  it('blocks navigation outside the environment origin', async () => {
    const result = await run('offsite', [
      { action: 'navigate', value: 'https://example.com/' },
    ]);
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(/blocked/);
  }, 30_000);

  describe('navigate and HTTP error statuses', () => {
    it('fails when the page answers HTTP 404, but keeps the evidence', async () => {
      const result = await run('status-404', [
        { action: 'navigate', value: '/nothing-here' },
      ]);

      expect(result.status).toBe('FAILED');
      expect(result.failedStep).toBe(1);
      expect(result.errorMessage).toContain(
        'GET /nothing-here responded with HTTP 404',
      );
      expect(result.errorMessage).toContain('Allow error status');
      expect(result.pageTitle).toBe('Not found · Acme Store');
      expect(result.screenshot).not.toBeNull();
    }, 30_000);

    it('fails when the page answers HTTP 500', async () => {
      const result = await run('status-500', [
        { action: 'navigate', value: '/orders' },
      ]);

      expect(result.status).toBe('FAILED');
      expect(result.errorMessage).toContain(
        'GET /orders responded with HTTP 500',
      );
    }, 30_000);

    it('opens the error page when allowErrorStatus is set, so its content can be checked', async () => {
      const result = await run('status-allowed', [
        { action: 'navigate', value: '/nothing-here', allowErrorStatus: true },
        {
          action: 'assertVisible',
          target: { type: 'role', value: 'heading', name: 'Page not found' },
        },
      ]);

      expect(result.status).toBe('PASSED');
    }, 30_000);

    it('judges the page reached after a redirect, not the redirect itself', async () => {
      // /account answers 302 to /login when signed out; the sign-in page itself is a 200.
      const result = await run('status-redirect', [
        { action: 'navigate', value: '/account' },
        { action: 'assertUrl', value: '/login' },
      ]);

      expect(result.status).toBe('PASSED');
    }, 30_000);
  });

  it('isolates browser state between tests', async () => {
    // The previous login test set a session cookie; a fresh context must not have it.
    const result = await run('isolation', [
      { action: 'navigate', value: '/account' },
      { action: 'assertUrl', value: '/login' },
    ]);
    expect(result.status).toBe('PASSED');
  }, 30_000);

  describe('inspecting a page', () => {
    it('returns the roles and accessible names a test can target', async () => {
      const page = await session.inspect(baseUrl, '/login');

      expect(page.status).toBe(200);
      expect(page.title).toBe('Sign in · Acme Store');
      expect(page.accessibilityTree).toContain('textbox "Email"');
      expect(page.accessibilityTree).toContain('button "Sign in"');
    }, 30_000);

    it('keeps to the environment origin', async () => {
      await expect(
        session.inspect(baseUrl, 'https://example.com/'),
      ).rejects.toThrow(/blocked/);
    }, 30_000);
  });

  describe('signing in once and reusing the session', () => {
    const steps = (raw: unknown[]) =>
      testStepsSchema.parse(raw).map((step, i) => ({ ...step, order: i + 1 }));
    const signInSteps = (password: string) =>
      steps([
        { action: 'navigate', value: '/login' },
        {
          action: 'fill',
          target: { type: 'label', value: 'Email' },
          value: DEMO_CREDENTIALS.email,
        },
        {
          action: 'fill',
          target: { type: 'label', value: 'Password' },
          value: password,
        },
        {
          action: 'click',
          target: { type: 'role', value: 'button', name: 'Sign in' },
        },
        { action: 'assertUrl', value: '/account' },
      ]);
    const openAccount = steps([
      { action: 'navigate', value: '/account' },
      { action: 'assertText', target: 'h1', value: 'Welcome back' },
    ]);

    it('returns the signed-in session, and a test started from it skips the sign-in page', async () => {
      const { execution, sessionState } = await session.signIn({
        baseUrl,
        steps: signInSteps(DEMO_CREDENTIALS.password),
        screenshotPath: join(artifactDir, 'sign-in.png'),
      });
      expect(execution.status).toBe('PASSED');
      expect(sessionState?.cookies.map((cookie) => cookie.name)).toContain(
        'acme_session',
      );

      const signedIn = await session.execute({
        baseUrl,
        steps: openAccount,
        screenshotPath: join(artifactDir, 'signed-in.png'),
        sessionState: sessionState!,
      });
      expect(signedIn.status).toBe('PASSED');
      expect(signedIn.finalUrl).toBe(`${baseUrl}/account`);

      // The session was copied, not shared: a test without it is still signed out.
      const signedOut = await session.execute({
        baseUrl,
        steps: openAccount,
        screenshotPath: join(artifactDir, 'signed-out.png'),
      });
      expect(signedOut.status).toBe('FAILED');
      expect(signedOut.finalUrl).toBe(`${baseUrl}/login`);
    }, 60_000);

    it('returns no session when the sign-in steps fail, with the failing step as evidence', async () => {
      const { execution, sessionState } = await session.signIn({
        baseUrl,
        steps: signInSteps('wrong-password'),
        screenshotPath: join(artifactDir, 'sign-in-failed.png'),
      });
      expect(sessionState).toBeNull();
      expect(execution.status).toBe('FAILED');
      expect(execution.failedStep).toBe(5);
      expect(execution.screenshot).not.toBeNull();
    }, 30_000);
  });
});
