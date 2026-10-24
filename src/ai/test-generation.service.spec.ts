import { describe, expect, it, vi } from 'vitest';
import type { BrowserService } from '../browser/browser.service.js';
import type { AppConfig } from '../config/app-config.js';
import type { EnvironmentsService } from '../environments/environments.service.js';
import type { TestStep } from '../test-steps/test-step.schema.js';
import { AiException } from './ai-errors.js';
import { AiRateLimiter } from './ai-rate-limiter.js';
import { LlmProvider, type JsonCompletion } from './llm-provider.js';
import {
  actionsBeforeFirstAssertion,
  TestGenerationService,
} from './test-generation.service.js';

const config = {
  ai: { groqApiKey: 'k', groqModel: 'm', generationsPerHour: 3 },
} as AppConfig;

const answer = (steps: object[]): JsonCompletion => ({
  data: { title: 'T', expectedResult: 'E', steps },
  model: 'm',
  usage: { inputTokens: 100, outputTokens: 50 },
});
const s = (action: string, extra: object = {}) => ({
  action,
  targetType: 'none',
  targetValue: null,
  targetName: null,
  value: null,
  ...extra,
});
const draft = answer([
  s('navigate', { value: '/newsletter' }),
  s('fill', { targetType: 'label', targetValue: 'Email', value: 'nope' }),
  s('click', {
    targetType: 'role',
    targetValue: 'button',
    targetName: 'Subscribe',
  }),
  s('assertVisible', {
    targetType: 'role',
    targetValue: 'textbox',
    targetName: 'Email',
  }),
]);
const better = answer([
  s('navigate', { value: '/newsletter' }),
  s('assertText', {
    targetType: 'css',
    targetValue: '#msg',
    value: 'valid email',
  }),
]);

function setup(
  provider: Partial<LlmProvider>,
  probe: unknown = {
    execution: { status: 'PASSED' },
    page: {
      url: 'u',
      title: null,
      status: null,
      accessibilityTree: '- status: Thanks',
    },
  },
) {
  const session = {
    inspect: vi
      .fn()
      .mockResolvedValue({
        url: 'http://x/newsletter',
        status: 200,
        title: 'N',
        accessibilityTree: '- textbox "Email"',
      }),
    probe: vi.fn().mockResolvedValue(probe),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const limiter = new AiRateLimiter(config);
  const service = new TestGenerationService(
    { enabled: true, name: 'fake', ...provider } as LlmProvider,
    {
      get: vi.fn().mockResolvedValue({ baseUrl: 'http://x' }),
    } as unknown as EnvironmentsService,
    {
      openSession: vi.fn().mockResolvedValue(session),
    } as unknown as BrowserService,
    limiter,
    config,
  );
  return { service, session, limiter };
}
const input = {
  environmentId: 'e',
  goal: 'newsletter rejects invalid email',
  path: '/newsletter',
};

describe('TestGenerationService', () => {
  it('rewrites the assertions after seeing the page the actions lead to', async () => {
    const completeJson = vi
      .fn()
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(better);
    const { service, session } = setup({ completeJson });

    const result = await service.generate('u1', input);

    expect(result.refined).toBe(true);
    expect(result.steps.at(-1)).toMatchObject({
      action: 'assertText',
      value: 'valid email',
    });
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 100 });
    // Only the actions before the first assertion were tried on the page.
    expect(
      session.probe.mock.calls[0]![1].map((step: TestStep) => step.action),
    ).toEqual(['navigate', 'fill', 'click']);
    expect(completeJson.mock.calls[1]![0].user).toContain(
      'Page after the actions',
    );
    expect(session.close).toHaveBeenCalled();
  });

  it('keeps the first draft and warns when the quota runs out before refining', async () => {
    const completeJson = vi
      .fn()
      .mockResolvedValueOnce(draft)
      .mockRejectedValueOnce(AiException.quotaExhausted(60));
    const { service } = setup({ completeJson });

    const result = await service.generate('u1', input);

    expect(result.refined).toBe(false);
    expect(result.steps).toHaveLength(4);
    expect(result.warnings[0]).toMatch(/quota ran out/);
  });

  it('warns when the actions cannot be tried, and makes no second call', async () => {
    const completeJson = vi.fn().mockResolvedValueOnce(draft);
    const { service } = setup(
      { completeJson },
      { execution: { status: 'FAILED' }, page: null },
    );

    const result = await service.generate('u1', input);

    expect(result.refined).toBe(false);
    expect(result.warnings[0]).toMatch(/could not be tried/);
    expect(completeJson).toHaveBeenCalledTimes(1);
  });

  it('stops with the quota error when the first call is refused, and gives the slot back', async () => {
    const completeJson = vi
      .fn()
      .mockRejectedValue(AiException.quotaExhausted(90));
    const { service, limiter } = setup({ completeJson });

    await expect(service.generate('u1', input)).rejects.toMatchObject({
      code: 'AI_QUOTA_EXHAUSTED',
      retryAfterSeconds: 90,
    });
    expect(completeJson).toHaveBeenCalledTimes(1);
    // Three allowed per hour: the refused attempt did not use one up.
    limiter.take('u1');
    limiter.take('u1');
    expect(() => limiter.take('u1')).not.toThrow();
  });

  it('repairs an invalid answer once, then gives up with a clear error', async () => {
    const invalid = answer([s('click')]);
    const completeJson = vi.fn().mockResolvedValue(invalid);
    const { service } = setup({ completeJson });

    await expect(service.generate('u1', input)).rejects.toMatchObject({
      code: 'AI_BAD_OUTPUT',
    });
    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(completeJson.mock.calls[1]![0].user).toContain(
      'previous answer was rejected',
    );
  });

  it('does nothing without a provider key', async () => {
    const { service } = setup({ enabled: false, completeJson: vi.fn() });
    await expect(service.generate('u1', input)).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
  });
});

describe('actionsBeforeFirstAssertion', () => {
  it('stops at the first assertion, or keeps everything when there is none', () => {
    const steps = [
      { action: 'navigate', value: '/' },
      { action: 'assertUrl', value: '/' },
      { action: 'click', target: { type: 'css', value: 'a' } },
    ] as TestStep[];
    expect(actionsBeforeFirstAssertion(steps)).toEqual([steps[0]]);
    expect(actionsBeforeFirstAssertion([steps[0]!])).toEqual([steps[0]]);
  });
});
