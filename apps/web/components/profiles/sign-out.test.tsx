// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GATE_COOKIE_NAME } from '@/lib/access-gate';
import { SIGN_OUT_COPY } from '@/lib/constants';
import { code, WEB_DIR } from '@/test/source-scan';

import { SIGN_OUT_CONSEQUENCE_ID, SignOutButton, SignOutPlaceholder } from './sign-out';

const signOut = vi.hoisted(() => vi.fn());
const loaded = vi.hoisted(() => ({ value: true }));
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ signOut, loaded: loaded.value }) }));

afterEach(() => {
  cleanup();
  signOut.mockClear();
  loaded.value = true;
});

describe('SignOutButton (AUTH-1 1c-3b)', () => {
  it('🔴 clears the Clerk session and NOTHING else — the gate cookie is not named here', () => {
    // The lockout guard, and the reason it is a test rather than a comment: "sign-out doesn't clear
    // the gate cookie" reads as an oversight to the next author, and the obvious "fix" is the
    // permanent lockout — bounced to /gate, now needing the shared household code to re-enter their
    // OWN household. After 1c-4 that reader is an invited parent who does not have it.
    //
    // Asserted against the SOURCE because the clearing is done by `@clerk/clerk-js`, which is fetched
    // from a CDN at a floating major and is absent from the lockfile — so the only honest claim is
    // about our own code. The runbook carries the manual check.
    // ⚠️ `code()`, not the raw file: the docblock above EXPLAINS the lockout and necessarily names
    // the cookie. Comments stripped, the claim is about what the component does.
    const src = code(join(WEB_DIR, 'components/profiles/sign-out.tsx'));
    expect(src).not.toContain(GATE_COOKIE_NAME);
    expect(src).not.toMatch(/\bcookies?\s*\(/);
    expect(src).not.toMatch(/document\.cookie/);
  });

  it('calls Clerk signOut with no arguments — the redirect lives on the provider', () => {
    render(<SignOutButton />);
    screen.getByRole('button', { name: SIGN_OUT_COPY.action }).click();
    // ⚠️ No `redirectUrl`: `app/layout.tsx` sets `afterSignOutUrl` once, and the first time a
    // redirect target comes from a prop or a query parameter it must go through `safeInternalPath`
    // (SEC-4). A per-call argument here would be a second source for one value.
    expect(signOut).toHaveBeenCalledWith();
  });

  it('is DISABLED until clerk-js has loaded', () => {
    // A dead-but-enabled button is the worst variant on the one screen whose copy prescribes
    // pressing it — and on gym LTE the CDN fetch is not instant.
    loaded.value = false;
    render(<SignOutButton />);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });

  it('describes its consequence, and the description is wired to the control', () => {
    render(<SignOutButton />);
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBe(
      SIGN_OUT_CONSEQUENCE_ID,
    );
  });
});

describe('SignOutPlaceholder — what the keyless harness captures', () => {
  it('renders the same label and description, disabled', () => {
    // Not cosmetic: both harnesses blank the Clerk keys on purpose, so `clerkIsConfigured()` is
    // false, no `<ClerkProvider>` renders, and a `useClerk()` component would THROW. Without this
    // the control would ship with no screenshot, no axe scan and no tap-target measurement.
    render(<SignOutPlaceholder />);
    const button = screen.getByRole('button', { name: SIGN_OUT_COPY.action });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe(SIGN_OUT_CONSEQUENCE_ID);
  });

  it('imports nothing from Clerk — it must render where there is no provider', () => {
    const src = code(join(WEB_DIR, 'components/profiles/sign-out.tsx'));
    const placeholder = src.slice(src.indexOf('export function SignOutPlaceholder'));
    expect(placeholder).not.toMatch(/useClerk|@clerk/);
  });
});
