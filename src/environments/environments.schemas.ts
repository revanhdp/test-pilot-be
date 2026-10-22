import { z } from 'zod';
import { EnvironmentType } from '../generated/prisma/enums.js';

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
};

export const environmentInputSchema = z.object({
  ...environmentFields,
  type: environmentFields.type.default('CUSTOM'),
});

export const createEnvironmentSchema = environmentInputSchema.extend({
  projectId: z.uuid(),
});
export type CreateEnvironmentInput = z.output<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = z.object(environmentFields).partial();
export type UpdateEnvironmentInput = z.output<typeof updateEnvironmentSchema>;
