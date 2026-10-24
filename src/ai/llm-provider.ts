/** A JSON Schema object, as accepted by `response_format: json_schema`. */
export type JsonSchema = Record<string, unknown>;

export interface JsonCompletionRequest {
  system: string;
  user: string;
  /** Name of the schema, shown to the model. */
  schemaName: string;
  schema: JsonSchema;
  /** Hard cap on generated tokens (reasoning included). */
  maxOutputTokens: number;
}

export interface JsonCompletion {
  /** Parsed JSON; not yet validated against anything. */
  data: unknown;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * The seam between TestPilot and a model vendor. Implementations throw
 * `AiException` for everything a caller should show to a user, and never
 * retry on a quota error or fall back to another (possibly paid) provider.
 */
export abstract class LlmProvider {
  abstract readonly name: string;
  abstract readonly enabled: boolean;
  abstract completeJson(
    request: JsonCompletionRequest,
  ): Promise<JsonCompletion>;
}
