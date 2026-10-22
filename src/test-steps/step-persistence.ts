import { Prisma } from '../generated/prisma/client.js';
import { toStepRows, type TestStep } from './test-step.schema.js';

const asJson = (value: unknown) =>
  value === null || value === undefined
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);

/** Validated steps as `test_steps` create data, numbered from 1. Used by every code path that writes steps. */
export function toStepCreateData(steps: TestStep[]) {
  return toStepRows(steps).map((row) => ({
    order: row.order,
    action: row.action,
    value: row.value,
    target: asJson(row.target),
    options: asJson(row.options),
  }));
}
