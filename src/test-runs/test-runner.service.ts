import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ArtifactStorage } from '../artifacts/artifact-storage.service.js';
import type {
  BrowserSession,
  SessionState,
  TestExecution,
} from '../browser/browser-session.js';
import { BrowserService } from '../browser/browser.service.js';
import { formatStepError } from '../browser/step-error.js';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  Prisma,
  TestResult,
  TestRun,
} from '../generated/prisma/client.js';
import type { RunSignIn, TestCaseSnapshot } from './test-runs.schemas.js';

type Outcome = 'passed' | 'failed' | 'skipped';

/** The run's one sign-in: the session it produced, or why there is none. */
type SignInResult =
  | { status: 'PASSED'; sessionState: SessionState }
  | {
      status: 'FAILED' | 'ERROR';
      message: string;
      execution: TestExecution | null;
      screenshotPath: string | null;
    };

/**
 * Executes runs in-process with bounded concurrency. Runs are queued in memory;
 * a run interrupted by a restart is marked ERROR on the next boot. This is the
 * seam where a Redis/BullMQ queue and a separate Playwright worker plug in later.
 */
@Injectable()
export class TestRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TestRunnerService.name);
  private readonly queue: string[] = [];
  private active = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly browser: BrowserService,
    private readonly storage: ArtifactStorage,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.failInterruptedRuns();
  }

  enqueue(runId: string): void {
    this.queue.push(runId);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.config.runner.concurrency) {
      const runId = this.queue.shift();
      if (!runId) return;
      this.active++;
      void this.execute(runId)
        .catch((error: unknown) =>
          this.logger.error(
            `Run ${runId} crashed`,
            error instanceof Error ? error.stack : String(error),
          ),
        )
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }

  private async execute(runId: string): Promise<void> {
    const run = await this.prisma.testRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() },
      include: { results: { orderBy: { position: 'asc' } } },
    });

    let session: BrowserSession;
    try {
      session = await this.browser.openSession();
    } catch (error) {
      await this.failRun(
        runId,
        `Could not start the browser: ${formatStepError(error)}`,
      );
      return;
    }

    const tally: Record<Outcome, number> = { passed: 0, failed: 0, skipped: 0 };
    try {
      const signIn = await this.signInOnce(session, run);
      for (const result of run.results) {
        tally[await this.executeResult(session, run, result, signIn)]++;
        await this.prisma.testRun.update({
          where: { id: runId },
          data: {
            passedTests: tally.passed,
            failedTests: tally.failed,
            skippedTests: tally.skipped,
          },
        });
      }
    } finally {
      await session.close();
    }

    await this.prisma.testRun.update({
      where: { id: runId },
      data: {
        status: tally.failed > 0 ? 'FAILED' : 'PASSED',
        finishedAt: new Date(),
      },
    });
    this.logger.log(
      `Run ${runId} finished: ${tally.passed} passed, ${tally.failed} failed, ${tally.skipped} skipped`,
    );
  }

  /**
   * Performs the environment's sign-in steps once, before any test, when at
   * least one test of the run starts signed in. The session stays in memory.
   */
  private async signInOnce(
    session: BrowserSession,
    run: TestRun & { results: TestResult[] },
  ): Promise<SignInResult | null> {
    const signIn = run.signIn as RunSignIn | null;
    const needed = run.results.some((result) => {
      const snapshot = result.testCaseSnapshot as unknown as TestCaseSnapshot;
      return snapshot.startSignedIn && snapshot.steps.length > 0;
    });
    if (!signIn || !needed) return null;

    const screenshotPath = this.storage.resultFile(
      run.id,
      'sign-in',
      'screenshot.png',
    );
    let outcome: SignInResult;
    let record: RunSignIn;
    try {
      const { execution, sessionState } = await session.signIn({
        baseUrl: run.baseUrl,
        steps: signIn.steps,
        screenshotPath: this.storage.absolute(screenshotPath),
      });
      record = {
        ...signIn,
        status: execution.status,
        durationMs: execution.durationMs,
        errorMessage: execution.errorMessage,
        failedStep: execution.failedStep,
        stepResults: execution.steps,
      };
      outcome = sessionState
        ? { status: 'PASSED', sessionState }
        : {
            status: 'FAILED',
            message: `Sign-in failed at step ${execution.failedStep}: ${execution.errorMessage}`,
            execution,
            screenshotPath: execution.screenshot ? screenshotPath : null,
          };
    } catch (error) {
      // The browser broke while signing in: an engine error, not a website failure.
      const message = `Sign-in could not run: ${formatStepError(error)}`;
      record = { ...signIn, status: 'ERROR', errorMessage: message };
      outcome = {
        status: 'ERROR',
        message,
        execution: null,
        screenshotPath: null,
      };
    }

    await this.prisma.testRun.update({
      where: { id: run.id },
      data: { signIn: record as unknown as Prisma.InputJsonValue },
    });
    return outcome;
  }

  private async executeResult(
    session: BrowserSession,
    run: TestRun,
    result: TestResult,
    signIn: SignInResult | null,
  ): Promise<Outcome> {
    const snapshot = result.testCaseSnapshot as unknown as TestCaseSnapshot;

    if (snapshot.steps.length === 0) {
      await this.prisma.testResult.update({
        where: { id: result.id },
        data: {
          status: 'SKIPPED',
          errorMessage: 'Test case has no steps',
          durationMs: 0,
          finishedAt: new Date(),
        },
      });
      return 'skipped';
    }

    if (snapshot.startSignedIn && signIn?.status !== 'PASSED') {
      return this.failWithoutSession(result, snapshot, signIn);
    }

    const startedAt = new Date();
    await this.prisma.testResult.update({
      where: { id: result.id },
      data: { status: 'RUNNING', startedAt },
    });

    const screenshotPath = this.storage.resultFile(
      run.id,
      result.id,
      'screenshot.png',
    );
    try {
      const execution = await session.execute({
        baseUrl: run.baseUrl,
        steps: snapshot.steps,
        screenshotPath: this.storage.absolute(screenshotPath),
        sessionState:
          snapshot.startSignedIn && signIn?.status === 'PASSED'
            ? signIn.sessionState
            : undefined,
      });

      await this.prisma.testResult.update({
        where: { id: result.id },
        data: {
          status: execution.status,
          durationMs: execution.durationMs,
          errorMessage: execution.errorMessage,
          failedStep: execution.failedStep,
          stepResults: execution.steps as unknown as Prisma.InputJsonValue,
          finalUrl: execution.finalUrl,
          pageTitle: execution.pageTitle,
          finishedAt: new Date(),
          ...(execution.screenshot && {
            artifacts: {
              create: {
                type: 'SCREENSHOT',
                path: screenshotPath,
                mimeType: 'image/png',
                sizeBytes: execution.screenshot.sizeBytes,
                metadata: {
                  url: execution.finalUrl,
                  title: execution.pageTitle,
                },
              },
            },
          }),
        },
      });
      return execution.status === 'PASSED' ? 'passed' : 'failed';
    } catch (error) {
      // The browser itself failed (crash, context creation), not the test's steps.
      await this.prisma.testResult.update({
        where: { id: result.id },
        data: {
          status: 'ERROR',
          errorMessage: formatStepError(error),
          durationMs: Date.now() - startedAt.getTime(),
          finishedAt: new Date(),
        },
      });
      return 'failed';
    }
  }

  /**
   * A test that needs the session can't run without it. It fails (a broken sign-in
   * is a real failure, not a skip) with the sign-in page as evidence; its own steps
   * never ran.
   */
  private async failWithoutSession(
    result: TestResult,
    snapshot: TestCaseSnapshot,
    signIn: Exclude<SignInResult, { status: 'PASSED' }> | null,
  ): Promise<Outcome> {
    const execution = signIn?.execution ?? null;
    await this.prisma.testResult.update({
      where: { id: result.id },
      data: {
        status: signIn?.status === 'ERROR' ? 'ERROR' : 'FAILED',
        errorMessage:
          signIn?.message ??
          'This test starts signed in, but the run has no sign-in steps',
        durationMs: 0,
        stepResults: snapshot.steps.map((step) => ({
          order: step.order,
          status: 'SKIPPED',
          durationMs: 0,
        })),
        finalUrl: execution?.finalUrl ?? null,
        pageTitle: execution?.pageTitle ?? null,
        finishedAt: new Date(),
        ...(signIn?.screenshotPath &&
          execution?.screenshot && {
            artifacts: {
              create: {
                type: 'SCREENSHOT',
                path: signIn.screenshotPath,
                mimeType: 'image/png',
                sizeBytes: execution.screenshot.sizeBytes,
                metadata: {
                  url: execution.finalUrl,
                  title: execution.pageTitle,
                  signIn: true,
                },
              },
            },
          }),
      },
    });
    return 'failed';
  }

  private async failRun(runId: string, message: string): Promise<void> {
    const finishedAt = new Date();
    const unfinished = await this.prisma.testResult.updateMany({
      where: { testRunId: runId, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'ERROR', errorMessage: message, finishedAt },
    });
    await this.prisma.testRun.update({
      where: { id: runId },
      data: {
        status: 'ERROR',
        errorMessage: message,
        failedTests: { increment: unfinished.count },
        finishedAt,
      },
    });
  }

  private async failInterruptedRuns(): Promise<void> {
    const stale = await this.prisma.testRun.findMany({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true },
    });
    for (const { id } of stale) {
      await this.failRun(
        id,
        'Interrupted: the server stopped before this run finished',
      );
    }
    if (stale.length > 0) {
      this.logger.warn(`Marked ${stale.length} interrupted run(s) as ERROR`);
    }
  }
}
