import { z } from 'zod';
import type { TestCategory, TestPriority } from '../generated/prisma/enums.js';
import type { StepOutcome } from '../browser/browser-session.js';
import type { OrderedTestStep } from '../test-steps/test-step.schema.js';

/**
 * Scope of a run, from narrowest to widest:
 * - `testCaseIds`: exactly these (drafts included, archived excluded)
 * - `suiteId`: the suite's active test cases
 * - neither: every active test case in the environment's project
 */
export const createTestRunSchema = z
  .object({
    environmentId: z.uuid(),
    testCaseIds: z.array(z.uuid()).min(1).max(500).optional(),
    suiteId: z.uuid().optional(),
  })
  .refine((input) => !(input.testCaseIds && input.suiteId), {
    message: 'Provide either testCaseIds or suiteId, not both',
  });
export type CreateTestRunInput = z.output<typeof createTestRunSchema>;

export const listTestRunsQuerySchema = z.object({
  projectId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListTestRunsQuery = z.output<typeof listTestRunsQuerySchema>;

/** Frozen copy of a test case, stored on each result when the run is created. */
export interface TestCaseSnapshot {
  key: string;
  title: string;
  suiteName: string;
  priority: TestPriority;
  category: TestCategory;
  expectedResult: string | null;
  /** Absent on runs created before sign-in existed. */
  startSignedIn?: boolean;
  steps: OrderedTestStep[];
}

/**
 * The environment's sign-in steps, frozen on the run when it is created, and
 * how they went once the runner performed them.
 */
export interface RunSignIn {
  steps: OrderedTestStep[];
  status?: 'PASSED' | 'FAILED' | 'ERROR';
  durationMs?: number;
  errorMessage?: string | null;
  failedStep?: number | null;
  stepResults?: StepOutcome[];
}
