import { z } from 'zod';
import { EnvironmentType } from '../generated/prisma/enums.js';
import { testStepSchema } from '../test-steps/test-step.schema.js';

export const MAX_SIGN_IN_STEPS = 30;

export const baseUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .pipe(
    z.url({
      protocol: /^https?$/,
      error: 'Enter a full http:// or https:// URL',
    }),
  );

export const environmentFields = {
  name: z.string().trim().min(1, 'Name is required').max(60),
  baseUrl: baseUrlSchema,
  type: z.enum(EnvironmentType),
  /** Steps that sign in, performed once per run. `null` or `[]` removes them. */
  signInSteps: z
    .array(testStepSchema)
    .max(
      MAX_SIGN_IN_STEPS,
      `Sign-in can have at most ${MAX_SIGN_IN_STEPS} steps`,
    )
    .nullable(),
};

export const environmentInputSchema = z.object({
  ...environmentFields,
  type: environmentFields.type.default('CUSTOM'),
  signInSteps: environmentFields.signInSteps.optional(),
});

export const createEnvironmentSchema = environmentInputSchema.extend({
  projectId: z.uuid(),
});
export type CreateEnvironmentInput = z.output<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = z.object(environmentFields).partial();
export type UpdateEnvironmentInput = z.output<typeof updateEnvironmentSchema>;
