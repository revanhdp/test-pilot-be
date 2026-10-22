import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, safe for cookies and URLs. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored hashed so a database leak doesn't expose live sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
