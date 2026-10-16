import { describe, expect, it } from 'vitest';

import {
  CLERK_BOT_PROTECTION_ORIGIN,
  CLERK_IMG_ORIGIN,
  clerkFrontendApiOrigin,
  clerkIsConfigured,
} from './clerk';

/**
 * AUTH-1 1a. The decode is what makes the CSP widening EXACT rather than a wildcard, so it is pinned
 * against vendor-shaped keys: a `@clerk/shared` format change must surface here, not as a silently
 * un-widened `connect-src` on the one screen that needs it.
 *
 * Keys below are synthetic — `btoa('<host>$')` — and carry no instance. They are not credentials:
 * a publishable key is public by design (see `lib/env.ts`), and these name hosts that do not exist.
 */
const keyFor = (prefix: 'pk_test_' | 'pk_live_', host: string) =>
  `${prefix}${Buffer.from(`${host}$`, 'utf8').toString('base64').replace(/=+$/, '')}`;

describe('clerkFrontendApiOrigin', () => {
  it.each([
    ['a development instance', keyFor('pk_test_', 'tidy-lion-42.clerk.accounts.dev')],
    ['a production instance', keyFor('pk_live_', 'clerk.matplan.example')],
  ])('derives the exact origin from %s', (_label, key) => {
    const origin = clerkFrontendApiOrigin(key);
    expect(origin).toBe(
      `https://${Buffer.from(key.split('_')[2]!, 'base64').toString('utf8').slice(0, -1)}`,
    );
    // The property that matters more than the value: an ORIGIN, https, and no wildcard.
    expect(origin).toMatch(/^https:\/\/[a-z0-9.-]+$/);
    expect(origin).not.toContain('*');
  });

  it('is null while 1a is dark, which is what leaves the CSP un-widened', () => {
    expect(clerkFrontendApiOrigin(undefined)).toBeNull();
    expect(clerkIsConfigured()).toBe(false);
  });

  it.each([
    ['an empty string', ''],
    ['a secret key by mistake', 'sk_test_aaaa'],
    ['the wrong prefix', `pub_test_${Buffer.from('a.b$').toString('base64')}`],
    ['the wrong instance word', `pk_prod_${Buffer.from('a.b$').toString('base64')}`],
    ['too few underscore parts', 'pk_test'],
    ['too many underscore parts', 'pk_test_abc_def'],
    ['base64 that is not a key', 'pk_test_###'],
    [
      'a decode with no trailing $',
      `pk_test_${Buffer.from('clerk.example.com').toString('base64')}`,
    ],
    ['a decode with two $', `pk_test_${Buffer.from('a.b$c$').toString('base64')}`],
    ['a decode with no dot', `pk_test_${Buffer.from('localhost$').toString('base64')}`],
    // Anything that could carry a scheme, port, path, credential or space is refused rather than
    // interpolated into a security header.
    ['an embedded scheme', `pk_test_${Buffer.from('https://evil.example$').toString('base64')}`],
    ['a port', `pk_test_${Buffer.from('clerk.example.com:8443$').toString('base64')}`],
    ['a path', `pk_test_${Buffer.from('clerk.example.com/x$').toString('base64')}`],
    ['credentials', `pk_test_${Buffer.from('a@clerk.example.com$').toString('base64')}`],
    ['a space', `pk_test_${Buffer.from('clerk.example.com evil.com$').toString('base64')}`],
    [
      'a CSP delimiter',
      `pk_test_${Buffer.from('clerk.example.com;img-src *$').toString('base64')}`,
    ],
    ['a wildcard', `pk_test_${Buffer.from('*.clerk.example.com$').toString('base64')}`],
  ])('refuses %s', (_label, key) => {
    expect(clerkFrontendApiOrigin(key)).toBeNull();
  });
});

/**
 * The contract test AGENTS.md allows: these two literals are what `proxy.test.ts` proves land in the
 * CSP, and they were read off `@clerk/nextjs@7.9.15`'s own `DEFAULT_DIRECTIVES`. The literal belongs
 * on the assertion side exactly once, and this is that once.
 */
describe('the Clerk CSP origins', () => {
  it('are exact origins, never wildcards', () => {
    expect(CLERK_IMG_ORIGIN).toBe('https://img.clerk.com');
    expect(CLERK_BOT_PROTECTION_ORIGIN).toBe('https://challenges.cloudflare.com');
  });
});
