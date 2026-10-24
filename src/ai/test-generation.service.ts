import { Injectable, Logger } from '@nestjs/common';
import { BrowserService } from '../browser/browser.service.js';
import { formatStepError } from '../browser/step-error.js';
import { AppConfig } from '../config/app-config.js';
import { EnvironmentsService } from '../environments/environments.service.js';
import { AiException } from './ai-errors.js';
import { AiRateLimiter } from './ai-rate-limiter.js';
import {
  MODEL_OUTPUT_SCHEMA,
  parseModelOutput,
  type GenerateTestInput,
  type GeneratedTest,
} from './ai.schemas.js';
import type { TestStep } from '../test-steps/test-step.schema.js';
import { LlmProvider } from './llm-provider.js';

/**
 * Free tiers cap tokens per minute (Groq: 8,000), so the prompt stays small:
 * the page outline is cut to roughly this many characters (~2,500 tokens).
 */
const MAX_OUTLINE_CHARS = 9_000;
const MAX_OUTPUT_TOKENS = 1_500;
/** The outline after the actions is shorter still: two prompts must fit one minute's tokens. */
const MAX_AFTER_OUTLINE_CHARS = 6_000;

const SYSTEM_PROMPT = `You write browser test steps for TestPilot as JSON. A real Chromium runs the steps in order; pass or fail is decided by the assertions, never by you.

Actions: navigate (value = a path such as /login), click, fill (value = the text to type), select (value = the option), check, uncheck, press (value = a key such as Enter; target optional), wait (value = milliseconds; avoid), assertVisible, assertHidden, assertText (value = text the element should contain), assertUrl (value = text the URL should contain), assertTitle (value = text the title should contain).
Targets: targetType "role" (targetValue = the ARIA role such as button, textbox, link or heading; targetName = its accessible name), "label" (a form field's label), "text", "placeholder", "testId", "css" (last resort), or "none" for steps without a target (navigate, assertUrl, assertTitle, wait, press).

Rules:
- Use only elements that appear in the page outline, and copy names exactly. Never invent labels, names or text.
- Prefer role with its name, then label, then text. Use css only for ids visible in the outline.
- Start with navigate to the starting path. End with at least one assertion that proves the goal's expected outcome.
- For a negative test, assert the message the page should show. If you do not know its exact wording, assert a visible element or a URL condition instead of guessing text.
- At most 12 steps. Use obviously fake values for data; never real credentials.
- title: a short test name. expectedResult: one sentence.
- Assertions must check the outcome the goal describes. Asserting only that the URL is unchanged or that an input is still visible proves nothing.`;

const REFINE_INSTRUCTIONS = `The draft steps above were run up to their first assertion. Below is the outline of the page AFTER those actions. Rewrite the test so its final assertions check what the goal says SHOULD happen, using elements and text from that outline when they are there.
The page may be buggy: it shows what the page does now, not what it should do. If its current behaviour contradicts the goal (for example a success message after invalid input), assert the behaviour the goal expects, so the test fails on the bug. Keep the actions that were run.`;

export interface GeneratedTestResponse extends GeneratedTest {
  page: { url: string; title: string | null; status: number | null };
  /** True when the assertions were rewritten after seeing the page after the actions. */
  refined: boolean;
  /** Things the user should know, e.g. that the free quota ran out before refining. */
  warnings: string[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

@Injectable()
export class TestGenerationService {
  private readonly logger = new Logger(TestGenerationService.name);

  constructor(
    private readonly provider: LlmProvider,
    private readonly environments: EnvironmentsService,
    private readonly browser: BrowserService,
    private readonly limiter: AiRateLimiter,
    private readonly config: AppConfig,
  ) {}

  status() {
    return {
      enabled: this.provider.enabled,
      provider: this.provider.name,
      model: this.config.ai.groqModel,
      generationsPerHour: this.config.ai.generationsPerHour,
    };
  }

  async generate(
    userId: string,
    input: GenerateTestInput,
  ): Promise<GeneratedTestResponse> {
    if (!this.provider.enabled) throw AiException.notConfigured();
    const environment = await this.environments.get(
      userId,
      input.environmentId,
    );

    this.limiter.take(userId);
    try {
      return await this.run(environment.baseUrl, input);
    } catch (error) {
      // Nothing was generated for the user: don't charge the attempt to their hourly allowance.
      if (error instanceof AiException && error.code !== 'AI_BAD_OUTPUT')
        this.limiter.refund(userId);
      throw error;
    }
  }

  private async run(
    baseUrl: string,
    input: GenerateTestInput,
  ): Promise<GeneratedTestResponse> {
    const session = await this.browser.openSession().catch((error: unknown) => {
      throw AiException.pageUnreachable(
        `Could not start the browser: ${formatStepError(error)}`,
      );
    });
    try {
      const page = await session
        .inspect(baseUrl, input.path)
        .catch((error: unknown) => {
          throw AiException.pageUnreachable(
            `Could not open ${input.path}: ${formatStepError(error)}`,
          );
        });
      const prompt = buildUserPrompt(input, page);

      const first = await this.ask(prompt);
      const usage = { ...first.usage };
      let { test, model } = first;
      const warnings: string[] = [];
      let refined = false;

      // Stage 2: see what the actions reveal, then write assertions for the goal.
      const actions = actionsBeforeFirstAssertion(test.steps);
      if (actions.length > 1) {
        const probe = await session
          .probe(
            baseUrl,
            actions.map((step, index) => ({ ...step, order: index + 1 })),
          )
          .catch(() => null);
        if (probe?.page) {
          try {
            const second = await this.ask(
              `${prompt}\n\nDraft steps:\n${JSON.stringify(test.steps)}\n\n${REFINE_INSTRUCTIONS}\n\nPage after the actions (${probe.page.url}):\n${trimOutline(probe.page.accessibilityTree, MAX_AFTER_OUTLINE_CHARS)}`,
            );
            test = second.test;
            model = second.model;
            refined = true;
            usage.inputTokens += second.usage.inputTokens;
            usage.outputTokens += second.usage.outputTokens;
          } catch (error) {
            // The first draft is still usable; say why it wasn't improved. A used-up quota stops here.
            if (!(error instanceof AiException)) throw error;
            warnings.push(
              error.code === 'AI_QUOTA_EXHAUSTED'
                ? 'The free AI quota ran out before the assertions could be improved. Review them carefully.'
                : 'The assertions could not be improved automatically. Review them carefully.',
            );
          }
        } else {
          warnings.push(
            'The steps could not be tried on the page, so the assertions are unchecked. Review them carefully.',
          );
        }
      }

      return {
        ...test,
        page: { url: page.url, title: page.title, status: page.status },
        refined,
        warnings,
        model,
        usage,
      };
    } finally {
      await session.close();
    }
  }

  /** One validated answer from the model, with a single repair attempt. A quota error stops immediately. */
  private async ask(user: string) {
    const request = {
      system: SYSTEM_PROMPT,
      user,
      schemaName: 'test_case',
      schema: MODEL_OUTPUT_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    };
    let completion = await this.provider.completeJson(request);
    let parsed = parseModelOutput(completion.data);
    const usage = { ...completion.usage };

    if (!parsed.ok) {
      this.logger.warn(
        `Generated steps were invalid (${parsed.problem}); retrying once`,
      );
      completion = await this.provider.completeJson({
        ...request,
        user: `${user}\n\nYour previous answer was rejected: ${parsed.problem}. Return a corrected test.`,
      });
      parsed = parseModelOutput(completion.data);
      usage.inputTokens += completion.usage.inputTokens;
      usage.outputTokens += completion.usage.outputTokens;
    }
    if (!parsed.ok) {
      throw AiException.badOutput(
        `The AI could not produce valid steps (${parsed.problem}). Try rewording the goal.`,
      );
    }
    return { test: parsed.test, model: completion.model, usage };
  }
}

/** The steps up to (not including) the first assertion: what a test does before it checks anything. */
export function actionsBeforeFirstAssertion(steps: TestStep[]): TestStep[] {
  const index = steps.findIndex((step) => step.action.startsWith('assert'));
  return index === -1 ? steps : steps.slice(0, index);
}

export function buildUserPrompt(
  input: Pick<GenerateTestInput, 'goal' | 'path'>,
  page: {
    url: string;
    title: string | null;
    status: number | null;
    accessibilityTree: string;
  },
): string {
  return [
    `Goal: ${input.goal}`,
    `Starting path: ${input.path}`,
    `Page: ${page.url} (title: ${page.title ?? 'none'}, HTTP ${page.status ?? 'unknown'})`,
    '',
    'Page outline (roles and accessible names):',
    trimOutline(page.accessibilityTree),
  ].join('\n');
}

/** Drops Playwright's internal refs and cuts the outline at a line boundary. */
export function trimOutline(
  tree: string,
  maxChars = MAX_OUTLINE_CHARS,
): string {
  const lines = tree
    .replace(/\s*\[ref=[^\]]+\]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '');
  const kept: string[] = [];
  let size = 0;
  for (const line of lines) {
    size += line.length + 1;
    if (size > maxChars) {
      kept.push('# (outline truncated)');
      break;
    }
    kept.push(line);
  }
  return kept.join('\n');
}
