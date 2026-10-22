import { stripVTControlCharacters } from 'node:util';

/** A step failed for a reason worth showing the user verbatim (assertion, blocked URL…). */
export class StepFailure extends Error {
  override name = 'StepFailure';
}

const MAX_MESSAGE_LENGTH = 2000;

/** Normalizes Playwright and runtime errors into a readable, bounded message. */
export function formatStepError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  // Playwright messages can carry terminal color codes.
  const clean = stripVTControlCharacters(raw).trim();
  return clean.length > MAX_MESSAGE_LENGTH
    ? `${clean.slice(0, MAX_MESSAGE_LENGTH)}…`
    : clean;
}
