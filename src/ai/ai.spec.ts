import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfig } from '../config/app-config.js';
import { AiException } from './ai-errors.js';
import { AiRateLimiter } from './ai-rate-limiter.js';
import { parseModelOutput } from './ai.schemas.js';
import { GroqProvider, retryAfterSeconds } from './groq.provider.js';
import { trimOutline } from './test-generation.service.js';

const config = (overrides: Partial<AppConfig['ai']> = {}) =>
  ({
    ai: {
      groqApiKey: 'gsk_test',
      groqModel: 'openai/gpt-oss-120b',
      generationsPerHour: 2,
      ...overrides,
    },
  }) as AppConfig;

const request = {
  system: 's',
  user: 'u',
  schemaName: 'x',
  schema: {},
  maxOutputTokens: 100,
};
const reply = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('GroqProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is disabled without a key and refuses to call out', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new GroqProvider(config({ groqApiKey: null }));

    expect(provider.enabled).toBe(false);
    await expect(provider.completeJson(request)).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends a strict JSON schema request and parses the answer', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      reply(200, {
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await new GroqProvider(config()).completeJson(request);

    expect(result).toEqual({
      data: { a: 1 },
      model: 'openai/gpt-oss-120b',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(init.body);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    });
    expect(body.max_completion_tokens).toBe(100);
    expect(body.reasoning_effort).toBe('low');
  });

  it('stops on HTTP 429 with the wait time, and does not retry', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        reply(
          429,
          { error: { message: 'Rate limit reached' } },
          { 'retry-after': '812' },
        ),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const error = await new GroqProvider(config())
      .completeJson(request)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiException);
    expect(error).toMatchObject({
      code: 'AI_QUOTA_EXHAUSTED',
      retryAfterSeconds: 812,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'AI_PROVIDER_ERROR', /rejected the API key/],
    [413, 'AI_PROVIDER_ERROR', /too large/],
    [500, 'AI_PROVIDER_ERROR', /HTTP 500/],
  ])('maps HTTP %i to a provider error', async (status, code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status, {})));
    await expect(
      new GroqProvider(config()).completeJson(request),
    ).rejects.toMatchObject({ code, message: expect.stringMatching(message) });
  });

  it('reports a cut-off answer instead of parsing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reply(200, {
          choices: [{ message: { content: '{"a"' }, finish_reason: 'length' }],
        }),
      ),
    );
    await expect(
      new GroqProvider(config()).completeJson(request),
    ).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' });
  });
});

describe('retryAfterSeconds', () => {
  const none = new Response(null);
  it.each([
    ['Please try again in 7.2s.', 8],
    ['Please try again in 14m22.5s.', 863],
    ['Please try again in 1h2m3s.', 3723],
    ['nothing useful', undefined],
  ])('reads "%s" from the message', (message, expected) => {
    expect(retryAfterSeconds(none, { error: { message } })).toBe(expected);
  });
  it('prefers the retry-after header', () => {
    expect(
      retryAfterSeconds(
        new Response(null, { headers: { 'retry-after': '30' } }),
        { error: { message: 'try again in 5s' } },
      ),
    ).toBe(30);
  });
});

describe('parseModelOutput', () => {
  const step = (over: object) => ({
    action: 'click',
    targetType: 'none',
    targetValue: null,
    targetName: null,
    value: null,
    ...over,
  });
  const output = (steps: object[]) => ({
    title: ' Pay ',
    expectedResult: 'Shows an error',
    steps,
  });

  it('turns the flat model shape into validated steps', () => {
    const result = parseModelOutput(
      output([
        step({ action: 'navigate', value: '/checkout' }),
        step({
          action: 'fill',
          targetType: 'label',
          targetValue: 'Card number',
          value: '4242',
        }),
        step({
          action: 'click',
          targetType: 'role',
          targetValue: 'button',
          targetName: 'Pay',
        }),
        step({
          action: 'assertText',
          targetType: 'css',
          targetValue: '#error',
          value: 'invalid',
        }),
      ]),
    );
    expect(result).toEqual({
      ok: true,
      test: {
        title: 'Pay',
        expectedResult: 'Shows an error',
        steps: [
          { action: 'navigate', value: '/checkout' },
          {
            action: 'fill',
            target: { type: 'label', value: 'Card number' },
            value: '4242',
          },
          {
            action: 'click',
            target: { type: 'role', value: 'button', name: 'Pay' },
          },
          {
            action: 'assertText',
            target: { type: 'css', value: '#error' },
            value: 'invalid',
          },
        ],
      },
    });
  });

  it('names the step that is not valid', () => {
    const result = parseModelOutput(
      output([
        step({ action: 'navigate', value: '/' }),
        step({ action: 'click' }),
      ]),
    );
    expect(result).toMatchObject({
      ok: false,
      problem: expect.stringContaining('step 2'),
    });
  });

  it('rejects an answer without steps and one that does not match the shape', () => {
    expect(parseModelOutput(output([]))).toMatchObject({
      ok: false,
      problem: 'no steps were produced',
    });
    expect(parseModelOutput({ nope: true })).toMatchObject({ ok: false });
  });
});

describe('AiRateLimiter', () => {
  const hour = 3_600_000;

  it('allows the configured number of calls, then says when a slot frees up', () => {
    const limiter = new AiRateLimiter(config({ generationsPerHour: 2 }));
    limiter.take('u1', 0);
    limiter.take('u1', 600_000);

    expect(() => limiter.take('u1', 900_000)).toThrowError(
      expect.objectContaining({
        code: 'AI_USER_LIMIT',
        retryAfterSeconds: 2_700,
      }),
    );
    limiter.take('u2', 900_000);
    limiter.take('u1', hour + 1);
  });

  it('gives a slot back when the call never reached the provider', () => {
    const limiter = new AiRateLimiter(config({ generationsPerHour: 1 }));
    limiter.take('u1', 0);
    limiter.refund('u1');
    expect(() => limiter.take('u1', 1)).not.toThrow();
  });
});

describe('trimOutline', () => {
  it('removes refs and cuts long outlines at a line boundary', () => {
    expect(
      trimOutline('- button "Pay" [ref=e12]\n\n- link "Home" [ref=e3]'),
    ).toBe('- button "Pay"\n- link "Home"');
    const long = Array.from(
      { length: 2_000 },
      (_, i) => `- link "Item number ${i}"`,
    ).join('\n');
    const trimmed = trimOutline(long);
    expect(trimmed.length).toBeLessThan(9_100);
    expect(trimmed.endsWith('# (outline truncated)')).toBe(true);
  });
});
