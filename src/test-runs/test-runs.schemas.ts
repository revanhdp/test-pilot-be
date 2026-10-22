import { z } from 'zod';
import type { TestCategory, TestPriority } from '../generated/prisma/enums.js';
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
  steps: OrderedTestStep[];
}
