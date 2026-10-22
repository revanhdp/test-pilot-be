import { z } from 'zod';
import { nullableText } from '../common/schemas.js';
import { environmentInputSchema } from '../environments/environments.schemas.js';

const projectFields = {
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: nullableText(1000),
};

export const createProjectSchema = z.object({
  ...projectFields,
  /** Optional first environment, so a project is runnable right after creation. */
  environment: environmentInputSchema.optional(),
});
export type CreateProjectInput = z.output<typeof createProjectSchema>;

export const updateProjectSchema = z.object(projectFields).partial();
export type UpdateProjectInput = z.output<typeof updateProjectSchema>;
