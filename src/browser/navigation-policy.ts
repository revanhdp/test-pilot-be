import { StepFailure } from './step-error.js';

/**
 * Resolves a navigate step against the environment's base URL and enforces
 * that tests stay on the environment's origin.
 *
 * Resolution follows URL semantics (the same as Playwright's `baseURL`):
 * "/login" is relative to the origin, "login" to the base path.
 */
export function resolveNavigationUrl(baseUrl: string, target: string): string {
  const base = new URL(baseUrl);

  let url: URL;
  try {
    url = new URL(target, base);
  } catch {
    throw new StepFailure(`"${target}" is not a valid URL or path`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new StepFailure(`Only http and https URLs can be opened (got ${url.protocol})`);
  }
  if (url.origin !== base.origin) {
    throw new StepFailure(
      `Navigation to ${url.origin} is blocked: tests can only open pages on the environment origin ${base.origin}`,
    );
  }
  return url.toString();
}
