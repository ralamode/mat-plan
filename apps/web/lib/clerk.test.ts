import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CLERK_BOT_PROTECTION_ORIGIN,
  CLERK_CSS_LAYER,
  CLERK_IMG_ORIGIN,
  clerkFrontendApiOrigin,
  clerkIsConfigured,
  SIGN_IN_APPEARANCE,
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
 * CSP, and they were read off `@clerk/nextjs@7.9.22`'s own `DEFAULT_DIRECTIVES`. The literal belongs
 * on the assertion side exactly once, and this is that once.
 */
describe('the Clerk CSP origins', () => {
  it('are exact origins, never wildcards', () => {
    expect(CLERK_IMG_ORIGIN).toBe('https://img.clerk.com');
    expect(CLERK_BOT_PROTECTION_ORIGIN).toBe('https://challenges.cloudflare.com');
  });
});

describe('the sign-in card contract (AUTH-1 1d PR 0)', () => {
  it('passes only class-name STRINGS, never a CSSObject the CSP would drop', () => {
    // A `CSSObject` becomes a runtime-injected style, and `style-src 'self' 'nonce-…'` drops it
    // SILENTLY — no error, no visual clue. A string is the only safe shape here.
    for (const [key, value] of Object.entries(SIGN_IN_APPEARANCE.elements)) {
      expect(typeof value, `elements.${key} must be a class string, not a CSSObject`).toBe(
        'string',
      );
    }
  });

  it("keeps the 44px lever on Clerk's social button", () => {
    // The arithmetic (does `min-h-11` actually clear MIN_TAP_TARGET_PX at this --spacing?) lives in
    // `app/design/tokens/token-sets.test.ts`, derived from the const. This pins only that the lever
    // is still attached — dropping the key currently reds nothing, because no CI run loads the card.
    expect(SIGN_IN_APPEARANCE.elements.socialButtonsBlockButton).toContain('min-h-11');
  });

  it('carries exactly ONE override, and only because Clerk misses an a11y floor', () => {
    // Measured 2026-11-05 with this map emptied: Clerk's social button renders at 32px, under
    // MIN_TAP_TARGET_PX. `elements` is the only lever — `variables` expose no control height. Every
    // other key was removed: the card is left as Clerk designed it (the mark that makes it look
    // foreign is "Secured by Clerk", whose removal is paid), and the page yields its own `<h1>` to
    // the card's rather than hiding Clerk's with three more keys. This exact-set pin is what keeps
    // that a decision — a key added here goes red and has to argue for itself.
    expect(Object.keys(SIGN_IN_APPEARANCE.elements)).toEqual(['socialButtonsBlockButton']);
    expect(SIGN_IN_APPEARANCE.elements.socialButtonsBlockButton).toContain('min-h-11');
  });

  it('orders @layer clerk BETWEEN base and components — wrong either way is invisible in CI', () => {
    // Position matters in BOTH directions, and no CI run renders the lit Clerk card to catch it:
    //  - ABOVE `base`, or Tailwind's preflight (`margin:0; padding:0; border:0` on `*`) outranks every
    //    spacing rule Clerk ships and the card renders stripped — button flush to the card edge,
    //    footer flush to the button. That is what a bare `@layer clerk;` did from 1a to 2026-11-05.
    //  - BELOW `components`/`utilities`, or Clerk's CSS beats the `min-h-11` holding its social
    //    button to MIN_TAP_TARGET_PX.
    // Comments are stripped first: globals.css's opening comment names every one of these layers, so
    // a naive indexOf matches the prose — the trap `app/design/tokens/token-sets.test.ts` documents.
    const css = readFileSync(join(import.meta.dirname, '..', 'app', 'globals.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const decl = /@layer\s+([^;]+);/.exec(css);
    expect(decl, '@layer declaration missing from globals.css').not.toBeNull();

    const order = decl![1]!.split(',').map((n) => n.trim());
    const base = order.indexOf('base');
    const clerk = order.indexOf(CLERK_CSS_LAYER);
    const components = order.indexOf('components');

    expect(base, 'base must be named in the layer order').toBeGreaterThanOrEqual(0);
    expect(clerk, `${CLERK_CSS_LAYER} must be named in the layer order`).toBeGreaterThanOrEqual(0);
    expect(components, 'components must be named in the layer order').toBeGreaterThanOrEqual(0);
    expect(clerk, "Clerk's layer must outrank Tailwind's preflight reset").toBeGreaterThan(base);
    expect(clerk, "Clerk's layer must not outrank Tailwind's utilities").toBeLessThan(components);
  });
});
