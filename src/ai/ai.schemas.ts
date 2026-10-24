import { z } from 'zod';
import {
  LOCATOR_TYPES,
  type TestStep,
} from '../test-steps/test-step.schema.js';
import { testStepsSchema } from '../test-steps/test-step.schema.js';
import type { JsonSchema } from './llm-provider.js';

export const generateTestSchema = z.object({
  environmentId: z.uuid(),
  goal: z.string().trim().min(5, 'Describe what to test').max(500),
  /** Page the test starts on, as a path on the environment. */
  path: z.string().trim().min(1).max(500).default('/'),
});
export type GenerateTestInput = z.output<typeof generateTestSchema>;

const ACTIONS = [
  'navigate',
  'click',
  'fill',
  'select',
  'check',
  'uncheck',
  'press',
  'wait',
  'assertVisible',
  'assertHidden',
  'assertText',
  'assertUrl',
  'assertTitle',
] as const;
const nullableString = { type: ['string', 'null'] } as const;

/**
 * What the model is asked to return. Flat on purpose: strict mode wants every
 * property required and no unions of objects, so optional parts are `null`.
 */
export const MODEL_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'expectedResult', 'steps'],
  properties: {
    title: { type: 'string' },
    expectedResult: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'action',
          'targetType',
          'targetValue',
          'targetName',
          'value',
        ],
        properties: {
          action: { type: 'string', enum: ACTIONS },
          targetType: { type: 'string', enum: [...LOCATOR_TYPES, 'none'] },
          targetValue: nullableString,
          targetName: nullableString,
          value: nullableString,
        },
      },
    },
  },
};

const modelOutputSchema = z.object({
  title: z.string(),
  expectedResult: z.string(),
  steps: z.array(
    z.object({
      action: z.enum(ACTIONS),
      targetType: z.enum([...LOCATOR_TYPES, 'none']),
      targetValue: z.string().nullable(),
      targetName: z.string().nullable(),
      value: z.string().nullable(),
    }),
  ),
});

export interface GeneratedTest {
  title: string;
  expectedResult: string;
  steps: TestStep[];
}

export type ParseResult =
  { ok: true; test: GeneratedTest } | { ok: false; problem: string };

/** Model output → real steps, checked by the same schema as hand-written ones. */
export function parseModelOutput(raw: unknown): ParseResult {
  const shape = modelOutputSchema.safeParse(raw);
  if (!shape.success)
    return { ok: false, problem: z.prettifyError(shape.error) };

  const draft = shape.data.steps.map((step) => ({
    action: step.action,
    ...(step.targetType !== 'none' &&
      step.targetValue && {
        target: {
          type: step.targetType,
          value: step.targetValue,
          ...(step.targetType === 'role' &&
            step.targetName && { name: step.targetName }),
        },
      }),
    ...(step.value !== null && { value: step.value }),
  }));

  const steps = testStepsSchema.safeParse(draft);
  if (!steps.success) {
    const issue = steps.error.issues[0]!;
    const index = typeof issue.path[0] === 'number' ? issue.path[0] : null;
    return {
      ok: false,
      problem: `${index === null ? 'steps' : `step ${index + 1}`}: ${issue.message}`,
    };
  }
  if (steps.data.length === 0)
    return { ok: false, problem: 'no steps were produced' };

  return {
    ok: true,
    test: {
      title: shape.data.title.trim().slice(0, 200) || 'Generated test',
      expectedResult: shape.data.expectedResult.trim().slice(0, 2000),
      steps: steps.data,
    },
  };
}
