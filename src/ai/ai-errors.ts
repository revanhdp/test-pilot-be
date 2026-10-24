import { HttpException, HttpStatus } from '@nestjs/common';

/** Machine-readable `code` values the web app switches on. */
export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_QUOTA_EXHAUSTED'
  | 'AI_USER_LIMIT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_BAD_OUTPUT'
  | 'AI_PAGE_UNREACHABLE';

/**
 * An AI feature could not complete. The response body carries `code` (and
 * `retryAfterSeconds` when waiting helps) next to the usual `message`.
 */
export class AiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: AiErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super({ statusCode: status, code, message, retryAfterSeconds }, status);
  }

  static notConfigured() {
    return new AiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AI_NOT_CONFIGURED',
      'AI features are not set up on this server (no GROQ_API_KEY).',
    );
  }

  /** The provider's own limit is used up. We stop: no retry loop, no paid fallback. */
  static quotaExhausted(retryAfterSeconds?: number) {
    return new AiException(
      HttpStatus.TOO_MANY_REQUESTS,
      'AI_QUOTA_EXHAUSTED',
      'The free AI quota is used up for now.',
      retryAfterSeconds,
    );
  }

  /** The per-user cap that keeps one person from using up everyone's quota. */
  static userLimit(retryAfterSeconds: number) {
    return new AiException(
      HttpStatus.TOO_MANY_REQUESTS,
      'AI_USER_LIMIT',
      'You have reached the hourly limit for AI generations.',
      retryAfterSeconds,
    );
  }

  static providerError(message: string) {
    return new AiException(
      HttpStatus.BAD_GATEWAY,
      'AI_PROVIDER_ERROR',
      message,
    );
  }

  static badOutput(message: string) {
    return new AiException(HttpStatus.BAD_GATEWAY, 'AI_BAD_OUTPUT', message);
  }

  static pageUnreachable(message: string) {
    return new AiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'AI_PAGE_UNREACHABLE',
      message,
    );
  }
}
