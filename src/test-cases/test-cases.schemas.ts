import { z } from 'zod';
import { nullableText } from '../common/schemas.js';
import {
  TestCaseStatus,
  TestCategory,
  TestPriority,
} from '../generated/prisma/enums.js';
import { testStepsSchema } from '../test-steps/test-step.schema.js';

const testCaseFields = {
  suiteId: z.uuid(),
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: nullableText(5000),
  priority: z.enum(TestPriority),
  category: z.enum(TestCategory),
  expectedResult: nullableText(2000),
  status: z.enum(TestCaseStatus),
  steps: testStepsSchema,
};

export const createTestCaseSchema = z.object({
  ...testCaseFields,
  priority: testCaseFields.priority.default('MEDIUM'),
  category: testCaseFields.category.default('FUNCTIONAL'),
  status: testCaseFields.status.default('ACTIVE'),
  steps: testCaseFields.steps.default([]),
});
export type CreateTestCaseInput = z.output<typeof createTestCaseSchema>;

/** Partial update. When `steps` is present it replaces the whole ordered list. */
export const updateTestCaseSchema = z.object(testCaseFields).partial();
export type UpdateTestCaseInput = z.output<typeof updateTestCaseSchema>;

export const listTestCasesQuerySchema = z.object({
  projectId: z.uuid(),
  suiteId: z.uuid().optional(),
});
export type ListTestCasesQuery = z.output<typeof listTestCasesQuerySchema>;
