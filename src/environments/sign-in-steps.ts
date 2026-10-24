import { Prisma } from '../generated/prisma/client.js';
import type { TestStep } from '../test-steps/test-step.schema.js';

/**
 * Sign-in steps as the value of `environments.signInSteps`: `undefined` leaves
 * the column alone, `null` or no steps clears it.
 */
export function signInStepsData(steps: TestStep[] | null | undefined) {
  if (steps === undefined) return undefined;
  return steps === null || steps.length === 0
    ? Prisma.DbNull
    : (steps as Prisma.InputJsonValue);
}
