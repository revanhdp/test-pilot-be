import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { AiException } from './ai-errors.js';
import {
  LlmProvider,
  type JsonCompletion,
  type JsonCompletionRequest,
} from './llm-provider.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 45_000;

interface GroqResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Groq's OpenAI-compatible chat endpoint, with strict JSON Schema output.
 * On the free tier a used-up limit answers HTTP 429; that stops here as an
 * `AI_QUOTA_EXHAUSTED` error and is never retried or billed elsewhere.
 */
@Injectable()
export class GroqProvider extends LlmProvider {
  readonly name = 'groq';

  constructor(private readonly config: AppConfig) {
    super();
  }

  get enabled(): boolean {
    return this.config.ai.groqApiKey !== null;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletion> {
    const { groqApiKey, groqModel } = this.config.ai;
    if (!groqApiKey) throw AiException.notConfigured();

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${groqApiKey}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          model: groqModel,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          temperature: 0.2,
          max_completion_tokens: request.maxOutputTokens,
          // gpt-oss models reason before answering; low keeps that cheap.
          ...(groqModel.startsWith('openai/gpt-oss') && {
            reasoning_effort: 'low',
          }),
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: request.schema,
            },
          },
        }),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw AiException.providerError(
        timedOut
          ? 'The AI provider took too long to answer.'
          : 'Could not reach the AI provider.',
      );
    }

    const body = (await response.json().catch(() => ({}))) as GroqResponse;

    if (response.status === 429) {
      throw AiException.quotaExhausted(retryAfterSeconds(response, body));
    }
    if (response.status === 401 || response.status === 403) {
      throw AiException.providerError('The AI provider rejected the API key.');
    }
    if (response.status === 413) {
      throw AiException.providerError(
        'The request was too large for the AI provider’s limits.',
      );
    }
    if (!response.ok) {
      throw AiException.providerError(
        `The AI provider answered HTTP ${response.status}${body.error?.message ? `: ${body.error.message}` : ''}.`,
      );
    }

    const choice = body.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw AiException.badOutput(
        'The AI answer was cut off. Try a shorter, more specific goal.',
      );
    }
    const content = choice?.message?.content;
    if (!content)
      throw AiException.badOutput('The AI returned an empty answer.');

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      throw AiException.badOutput('The AI answer was not valid JSON.');
    }
    return {
      data,
      model: body.model ?? groqModel,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/** `retry-after` (seconds), else the "try again in 7.2s / 1m3s" hint in the message. */
export function retryAfterSeconds(
  response: Response,
  body: GroqResponse,
): number | undefined {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);

  const hint =
    /try again in\s+(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?/i.exec(
      body.error?.message ?? '',
    );
  if (!hint) return undefined;
  const seconds =
    Number(hint[1] ?? 0) * 3600 +
    Number(hint[2] ?? 0) * 60 +
    Number(hint[3] ?? 0);
  return seconds > 0 ? Math.ceil(seconds) : undefined;
}
