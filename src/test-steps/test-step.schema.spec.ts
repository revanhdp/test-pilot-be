import {
  fromStepRow,
  MAX_STEPS_PER_TEST,
  testStepSchema,
  testStepsSchema,
  toStepRows,
} from './test-step.schema.js';

describe('testStepSchema', () => {
  it('accepts a structured locator target', () => {
    const step = testStepSchema.parse({
      action: 'click',
      target: { type: 'role', value: 'button', name: 'Sign in' },
    });
    expect(step).toEqual({
      action: 'click',
      target: { type: 'role', value: 'button', name: 'Sign in' },
    });
  });

  it('treats a bare string target as a CSS selector', () => {
    const step = testStepSchema.parse({
      action: 'fill',
      target: '#email',
      value: 'test@example.com',
    });
    expect(step).toEqual({
      action: 'fill',
      target: { type: 'css', value: '#email' },
      value: 'test@example.com',
    });
  });

  it('accepts navigate with the URL in `target`', () => {
    expect(testStepSchema.parse({ action: 'navigate', target: '/login' })).toEqual({
      action: 'navigate',
      value: '/login',
    });
  });

  it('strips unknown keys such as a client-supplied order', () => {
    expect(
      testStepSchema.parse({ order: 7, action: 'assertUrl', value: '/home', extra: true }),
    ).toEqual({ action: 'assertUrl', value: '/home' });
  });

  it('coerces and bounds wait durations', () => {
    expect(testStepSchema.parse({ action: 'wait', value: 500 })).toEqual({
      action: 'wait',
      value: '500',
    });
    expect(testStepSchema.safeParse({ action: 'wait', value: 60_000 }).success).toBe(false);
  });

  it('rejects unknown actions and missing fields', () => {
    expect(testStepSchema.safeParse({ action: 'eval', value: 'alert(1)' }).success).toBe(false);
    expect(testStepSchema.safeParse({ action: 'click' }).success).toBe(false);
    expect(
      testStepSchema.safeParse({ action: 'click', target: { type: 'xpath', value: '//a' } })
        .success,
    ).toBe(false);
    expect(testStepSchema.safeParse({ action: 'assertText', target: 'h1' }).success).toBe(false);
  });

  it('allows filling an empty value to clear a field', () => {
    expect(testStepSchema.safeParse({ action: 'fill', target: '#q', value: '' }).success).toBe(
      true,
    );
  });

  it('limits the number of steps', () => {
    const steps = Array.from({ length: MAX_STEPS_PER_TEST + 1 }, () => ({
      action: 'navigate',
      value: '/',
    }));
    expect(testStepsSchema.safeParse(steps).success).toBe(false);
  });
});

describe('step rows', () => {
  it('round-trips through the storage shape with 1-based order', () => {
    const steps = testStepsSchema.parse([
      { action: 'navigate', value: '/login' },
      { action: 'press', value: 'Enter' },
      { action: 'click', target: '#submit' },
    ]);
    const rows = toStepRows(steps);

    expect(rows).toEqual([
      { order: 1, action: 'navigate', target: null, value: '/login' },
      { order: 2, action: 'press', target: null, value: 'Enter' },
      { order: 3, action: 'click', target: { type: 'css', value: '#submit' }, value: null },
    ]);
    expect(rows.map(fromStepRow)).toEqual(
      steps.map((step, index) => ({ ...step, order: index + 1 })),
    );
  });
});
