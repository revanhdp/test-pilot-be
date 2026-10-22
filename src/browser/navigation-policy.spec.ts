import { resolveNavigationUrl } from './navigation-policy.js';
import { StepFailure } from './step-error.js';

describe('resolveNavigationUrl', () => {
  const base = 'https://staging.example.com/app/';

  it('resolves absolute paths against the origin', () => {
    expect(resolveNavigationUrl(base, '/login')).toBe('https://staging.example.com/login');
  });

  it('resolves relative paths against the base path', () => {
    expect(resolveNavigationUrl(base, 'login?next=1')).toBe(
      'https://staging.example.com/app/login?next=1',
    );
  });

  it('allows full URLs on the same origin', () => {
    expect(resolveNavigationUrl(base, 'https://staging.example.com/cart')).toBe(
      'https://staging.example.com/cart',
    );
  });

  it('blocks other origins, including other ports and protocols', () => {
    for (const target of [
      'https://evil.example.org/',
      'https://staging.example.com:8443/',
      'http://staging.example.com/',
      '//evil.example.org/path',
    ]) {
      expect(() => resolveNavigationUrl(base, target)).toThrow(StepFailure);
    }
  });

  it('blocks non-http schemes', () => {
    expect(() => resolveNavigationUrl(base, 'javascript:alert(1)')).toThrow(/http and https/);
    expect(() => resolveNavigationUrl(base, 'file:///etc/passwd')).toThrow(StepFailure);
  });
});
