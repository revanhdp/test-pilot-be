import { z } from 'zod';
import { nullableText } from '../common/schemas.js';

const suiteFields = {
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: nullableText(1000),
};

export const createTestSuiteSchema = z.object({
  ...suiteFields,
  projectId: z.uuid(),
});
export type CreateTestSuiteInput = z.output<typeof createTestSuiteSchema>;

export const updateTestSuiteSchema = z.object(suiteFields).partial();
export type UpdateTestSuiteInput = z.output<typeof updateTestSuiteSchema>;
