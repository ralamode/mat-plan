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
 * CSP, and they were read off `@clerk/nextjs@7.9.15`'s own `DEFAULT_DIRECTIVES`. The literal belongs
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

  it('hides the vendor header AND its two children — none is removable alone', () => {
    // `header` removes the empty ~35px container; the child keys keep the page's `<h1>` the only one
    // in the a11y tree even if a vendor restructure moves the title out of `header`.
    expect(SIGN_IN_APPEARANCE.elements.header).toBe('hidden');
    expect(SIGN_IN_APPEARANCE.elements.headerTitle).toBe('hidden');
    expect(SIGN_IN_APPEARANCE.elements.headerSubtitle).toBe('hidden');
  });

  it('makes the card follow the page column instead of its fixed 400px', () => {
    expect(SIGN_IN_APPEARANCE.elements.rootBox).toContain('w-full');
    expect(SIGN_IN_APPEARANCE.elements.cardBox).toContain('w-full');
  });

  it("renders seamlessly — no floating card, and the button matches the app's own", () => {
    // The vendor card ships as a drop-shadowed white box floating on the page. This app puts its own
    // heading and disclosure directly above it, so the box read as a second, competing surface. The
    // chrome comes off `cardBox` (the shadow) and `card` (the white fill and padding), and the Google
    // button takes the app's outline-button treatment so the two controls on the screen match.
    expect(SIGN_IN_APPEARANCE.elements.cardBox).toContain('shadow-none');
    expect(SIGN_IN_APPEARANCE.elements.card).toContain('bg-transparent');
    expect(SIGN_IN_APPEARANCE.elements.card).toContain('shadow-none');
    expect(SIGN_IN_APPEARANCE.elements.socialButtonsBlockButton).toContain('border');
    expect(SIGN_IN_APPEARANCE.elements.socialButtonsBlockButton).toContain('rounded-lg');
    // `border-input`, NOT `border-border`: Clerk redefines `--border` on its own elements, so
    // `border-border` silently resolves the VENDOR's value. `--input` is not shadowed and carries
    // the identical colour. A layer-order fix cannot help — the variable itself is overridden.
    expect(SIGN_IN_APPEARANCE.elements.socialButtonsBlockButton).toContain('border-input');
  });

  it('declares @layer clerk BEFORE Tailwind, or min-h-11 stops applying', () => {
    // Layer priority is DECLARATION ORDER. Unlayered styles beat any layered rule, and a layer
    // declared after Tailwind's would put Clerk's CSS above the utilities — silently losing the 44px
    // bar on the Google button. Nothing tested this file's ordering before.
    //
    // Comments are stripped first: `globals.css`'s opening comment discusses `@layer`, `@import` and
    // `clerk`, so a naive indexOf on raw source can match the prose instead of the declaration —
    // the same trap `app/design/tokens/token-sets.test.ts` documents.
    const css = readFileSync(join(import.meta.dirname, '..', 'app', 'globals.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const layer = css.indexOf(`@layer ${CLERK_CSS_LAYER}`);
    const tailwind = css.indexOf("@import 'tailwindcss'");

    // Asserted POSITIVELY: `indexOf` returns -1 for a missing needle, and `-1 < n` is true — so a
    // bare `layer < tailwind` would pass on the exact regression (the layer deleted) it exists for.
    expect(layer, `@layer ${CLERK_CSS_LAYER} is missing from globals.css`).toBeGreaterThanOrEqual(
      0,
    );
    expect(tailwind, "@import 'tailwindcss' is missing from globals.css").toBeGreaterThanOrEqual(0);
    expect(layer, `@layer ${CLERK_CSS_LAYER} must be declared before Tailwind`).toBeLessThan(
      tailwind,
    );
  });
});
