import { z } from 'zod';

/**
 * The test step contract. Every step a user writes (and, later, every step an
 * LLM proposes) is validated against this schema before it is stored or
 * executed. The browser engine only ever interprets these structured actions;
 * nothing here is evaluated as code.
 */

export const MAX_STEPS_PER_TEST = 100;
export const MAX_WAIT_MS = 30_000;

export const LOCATOR_TYPES = [
  'css',
  'text',
  'role',
  'label',
  'placeholder',
  'testId',
] as const;

const locatorObjectSchema = z.object({
  type: z.enum(LOCATOR_TYPES),
  value: z.string().trim().min(1, 'Target is required').max(500),
  /** Accessible name; only used by `role` locators, e.g. role=button name="Sign in". */
  name: z.string().trim().min(1).max(200).optional(),
});

/** A bare string is shorthand for a CSS selector: "#login" → { type: "css", value: "#login" }. */
export const locatorSchema = z.preprocess(
  (raw) => (typeof raw === 'string' ? { type: 'css', value: raw } : raw),
  locatorObjectSchema,
);
export type Locator = z.output<typeof locatorObjectSchema>;

const nonEmpty = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max);

const stepVariants = z.discriminatedUnion('action', [
  // Navigation
  z.object({
    action: z.literal('navigate'),
    value: nonEmpty('URL or path', 2000),
    /**
     * By default the step fails when the page answers HTTP 4xx/5xx. Turn this on
     * for tests that deliberately open an error page (for example a custom 404).
     */
    allowErrorStatus: z.boolean().optional(),
  }),

  // Interaction
  z.object({ action: z.literal('click'), target: locatorSchema }),
  z.object({
    action: z.literal('fill'),
    target: locatorSchema,
    // Empty is allowed: filling "" clears a field.
    value: z.string().max(5000),
  }),
  z.object({
    action: z.literal('select'),
    target: locatorSchema,
    value: nonEmpty('Option', 500),
  }),
  z.object({ action: z.literal('check'), target: locatorSchema }),
  z.object({ action: z.literal('uncheck'), target: locatorSchema }),
  z.object({
    action: z.literal('press'),
    target: locatorSchema.optional(),
    value: nonEmpty('Key', 50),
  }),
  z.object({
    action: z.literal('wait'),
    value: z.coerce
      .number()
      .int()
      .min(50, 'Wait at least 50 ms')
      .max(MAX_WAIT_MS, `Wait at most ${MAX_WAIT_MS} ms`)
      .transform(String),
  }),

  // Assertions
  z.object({ action: z.literal('assertVisible'), target: locatorSchema }),
  z.object({ action: z.literal('assertHidden'), target: locatorSchema }),
  z.object({
    action: z.literal('assertText'),
    target: locatorSchema,
    value: nonEmpty('Expected text', 2000),
  }),
  z.object({ action: z.literal('assertUrl'), value: nonEmpty('Expected URL', 2000) }),
  z.object({ action: z.literal('assertTitle'), value: nonEmpty('Expected title', 500) }),
]);

/**
 * Accepts `{ action: "navigate", target: "/login" }` (the target-as-URL form)
 * by moving the URL into `value`.
 */
export const testStepSchema = z.preprocess((raw) => {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'action' in raw &&
    raw.action === 'navigate' &&
    'target' in raw &&
    typeof raw.target === 'string' &&
    !('value' in raw && raw.value != null)
  ) {
    const { target, ...rest } = raw;
    return { ...rest, value: target };
  }
  return raw;
}, stepVariants);

export type TestStep = z.output<typeof stepVariants>;
export type StepAction = TestStep['action'];
export type OrderedTestStep = TestStep & { order: number };

export const testStepsSchema = z
  .array(testStepSchema)
  .max(MAX_STEPS_PER_TEST, `A test can have at most ${MAX_STEPS_PER_TEST} steps`);

/** Storage shape of a step (columns of `test_steps`). */
export interface TestStepRow {
  order: number;
  action: string;
  target: unknown;
  value: string | null;
  /** Per-action flags such as `{ allowErrorStatus: true }`; null when none are set. */
  options: unknown;
}

export function toStepRows(steps: TestStep[]): TestStepRow[] {
  return steps.map((step, index) => ({
    order: index + 1,
    action: step.action,
    target: 'target' in step && step.target ? step.target : null,
    value: 'value' in step ? step.value : null,
    options:
      step.action === 'navigate' && step.allowErrorStatus
        ? { allowErrorStatus: true }
        : null,
  }));
}

/** Rehydrates a stored step. Throws if the row no longer satisfies the schema. */
export function fromStepRow(row: TestStepRow): OrderedTestStep {
  const step = testStepSchema.parse({
    ...(typeof row.options === 'object' && row.options !== null ? row.options : {}),
    action: row.action,
    ...(row.target != null && { target: row.target }),
    ...(row.value != null && { value: row.value }),
  });
  return { ...step, order: row.order };
}

export function describeLocator(locator: Locator): string {
  switch (locator.type) {
    case 'css':
      return `element "${locator.value}"`;
    case 'text':
      return `text "${locator.value}"`;
    case 'role':
      return locator.name
        ? `${locator.value} "${locator.name}"`
        : `${locator.value} role`;
    case 'label':
      return `field labelled "${locator.value}"`;
    case 'placeholder':
      return `field with placeholder "${locator.value}"`;
    case 'testId':
      return `test id "${locator.value}"`;
  }
}
