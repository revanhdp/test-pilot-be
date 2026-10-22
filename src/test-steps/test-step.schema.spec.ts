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

  it('accepts allowErrorStatus on navigate only as a boolean', () => {
    expect(
      testStepSchema.parse({ action: 'navigate', value: '/nope', allowErrorStatus: true }),
    ).toEqual({ action: 'navigate', value: '/nope', allowErrorStatus: true });
    expect(
      testStepSchema.safeParse({ action: 'navigate', value: '/nope', allowErrorStatus: 'yes' }).success,
    ).toBe(false);
    // Other actions have no such option: it is dropped, not stored.
    expect(
      testStepSchema.parse({ action: 'click', target: '#a', allowErrorStatus: true }),
    ).toEqual({ action: 'click', target: { type: 'css', value: '#a' } });
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
      { order: 1, action: 'navigate', target: null, value: '/login', options: null },
      { order: 2, action: 'press', target: null, value: 'Enter', options: null },
      {
        order: 3,
        action: 'click',
        target: { type: 'css', value: '#submit' },
        value: null,
        options: null,
      },
    ]);
    expect(rows.map(fromStepRow)).toEqual(
      steps.map((step, index) => ({ ...step, order: index + 1 })),
    );
  });

  it('stores allowErrorStatus in options and restores it', () => {
    const steps = testStepsSchema.parse([
      { action: 'navigate', value: '/missing', allowErrorStatus: true },
      { action: 'navigate', value: '/', allowErrorStatus: false },
    ]);
    const rows = toStepRows(steps);

    expect(rows[0]!.options).toEqual({ allowErrorStatus: true });
    expect(rows[1]!.options).toBeNull(); // false is the default, so nothing is stored
    expect(fromStepRow(rows[0]!)).toEqual({
      action: 'navigate',
      value: '/missing',
      allowErrorStatus: true,
      order: 1,
    });
  });

  it('reads rows saved before options existed', () => {
    expect(
      fromStepRow({ order: 1, action: 'navigate', target: null, value: '/', options: null }),
    ).toEqual({ action: 'navigate', value: '/', order: 1 });
  });
});
