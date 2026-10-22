import { z } from 'zod';

/**
 * Optional free text for create/update payloads.
 * `undefined` (field omitted) stays `undefined` so PATCH leaves it untouched;
 * an empty string or `null` clears it.
 */
export const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined ? undefined : value || null));

export const projectQuerySchema = z.object({ projectId: z.uuid() });
