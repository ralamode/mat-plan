import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isUngatedPath } from '@/lib/access-gate';
import { isPublicPath } from '@/lib/public-paths';
import {
  code,
  exportedActionNames,
  serverActionModules,
  USE_SERVER_MENTION_RE,
  USE_SERVER_RE,
  WEB_DIR,
} from '@/test/source-scan';

/**
 * SEC-1's invariant as a test, not a sentence (OSS-2). The proxy is NOT the boundary: every page and
 * Route Handler re-checks the gate itself. OSS-2 made the first exception (the public landing), and a
 * prose rule plus a unit test of a string function would not notice a future page that forgets the call —
 * DUALS-1's merge accident (#153) was exactly that kind of silent loss.
 *
 * Source is matched with comments STRIPPED, so a `// TODO: requireGatedPage()` cannot satisfy it.
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url));

/** `app/p/[profileId]/page.tsx` → `/p/[profileId]`; route groups `(x)` add no segment. */
function routeOf(file: string): string {
  const segments = relative(APP_DIR, dirname(file))
    .split('/')
    .filter((s) => s !== '' && !/^\(.*\)$/.test(s));
  return `/${segments.join('/')}`;
}

const app = (pattern: string) =>
  globSync(pattern, { cwd: APP_DIR })
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => join(APP_DIR, f));

const pages = app('**/page.tsx');
const handlers = app('**/route.ts');

describe('every page is gated or deliberately un-gated', () => {
  it('finds the pages (an empty glob would pass everything below)', () => {
    expect(pages.length).toBeGreaterThan(2);
  });

  it.each(pages.map((f) => [routeOf(f), f]))('%s', (route, file) => {
    const gated = /\bawait\s+requireGatedPage\(\)/.test(code(file));
    expect(
      gated || isUngatedPath(route),
      `${route} neither awaits requireGatedPage() nor is an ungated path (PUBLIC_PATHS or the gate)`,
    ).toBe(true);
  });
});

describe('every Route Handler checks the gate itself', () => {
  /**
   * 🔴 AUTH-1 1a. The sibling page suite has had a non-vacuity floor since OSS-2; this one had none,
   * so an empty glob would have passed it silently. 1a is the chunk that leans on it: removing the
   * `api` exclusion from `proxy.ts`'s matcher closes the "/api hole", and `docs/tech-debt.md`'s own
   * prescription for that hole was "do BOTH" — drop the exclusion AND prove a check per handler. A
   * per-handler proof that can go vacuous is not the second half.
   */
  it('finds the handlers (an empty glob would pass everything below)', () => {
    expect(handlers.length).toBeGreaterThan(0);
  });

  it.each(handlers.map((f) => [routeOf(f), f]))('%s', (route, file) => {
    expect(
      /\b(?:isValidGateCookie|hasGateAccess)\(/.test(code(file)),
      `${route}/route.ts never checks the gate cookie`,
    ).toBe(true);
  });
});

/**
 * A `'use server'` function reachable from a PUBLIC page's module graph — root layout, error boundary and
 * every other root-segment file included — would be bundled for that page, and so invokable by an
 * unauthenticated POST to it with only its own gate check in the way. Public pages reach none.
 *
 * Follows local imports only (`@/…` and relative), including `export … from` re-exports and dynamic
 * `import()`; a package cannot contain this app's actions. The directive is matched ANYWHERE (inline
 * `'use server'` inside a function counts too) — over-matching is the safe direction here.
 */
const SPECIFIER_RE =
  /(?:^\s*(?:import|export)\s[^'"]*?from\s*|^\s*import\s*|\bimport\(\s*)['"]([^'"]+)['"]/gm;

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith('@/')
    ? join(WEB_DIR, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  const candidates = /\.tsx?$/.test(base)
    ? [base]
    : ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext);
  return candidates.find((c) => existsSync(c)) ?? null;
}

function localGraph(entries: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of code(file).matchAll(SPECIFIER_RE)) {
      const next = resolveLocal(spec!, file);
      if (next) stack.push(next);
    }
  }
  return [...seen];
}

/** The segment's own non-page files (layout, error, not-found, template, loading) render with it. */
const segmentFiles = (dir: string) =>
  globSync('*.tsx', { cwd: dir })
    .filter((f) => f !== 'page.tsx' && !/\.test\.tsx$/.test(f))
    .map((f) => join(dir, f));

describe('public pages pull no Server Action into their module graph', () => {
  const publicPages = pages.filter((f) => isPublicPath(routeOf(f)));

  it('has at least one public page to check', () => {
    expect(publicPages.length).toBeGreaterThan(0);
  });

  it('can see an action module (the detector is not vacuous)', () => {
    expect(USE_SERVER_MENTION_RE.test(code(join(APP_DIR, 'gate', 'actions.ts')))).toBe(true);
  });

  it.each(publicPages.map((f) => [routeOf(f), f]))('%s (with its segment files)', (_r, file) => {
    // The root segment's files render with EVERY page, so they are always in the graph.
    const graph = localGraph([file, ...segmentFiles(APP_DIR), ...segmentFiles(dirname(file))]);
    expect(graph.length).toBeGreaterThan(2);
    const actions = graph.filter((f) => USE_SERVER_MENTION_RE.test(code(f)));
    expect(actions.map((f) => relative(WEB_DIR, f))).toEqual([]);
  });
});

/**
 * 🔴 AUTH-1 1a — the limitation above, answered rather than restated.
 *
 * The suite follows LOCAL imports only, because "a package cannot contain this app's actions". 1a
 * puts `<ClerkProvider>` in the root layout, so `@clerk/nextjs` is now in EVERY public page's module
 * graph and is the first third-party package there — and it does ship `'use server'` modules, which
 * the runbook's grep box predicted and which this pins so a bump cannot add a third unnoticed.
 *
 * Both are benign, and that is the statement the plan asked for in place of extending the crawler:
 *
 *  - `app-router/server-actions.js` → `invalidateCacheAction()` deletes a cookie named
 *    `__clerk_invalidate_cache_cookie_${Date.now()}`, which by construction never exists. It reads
 *    nothing, writes nothing durable and takes no arguments, so an unauthenticated POST to it
 *    accomplishes nothing.
 *  - `app-router/keyless-actions.js` → `deleteKeylessAction()` returns immediately unless
 *    `canUseKeyless`, which `next.config.ts` pins OFF via `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED`. Even
 *    armed it only removes Clerk's own local development key file.
 *
 * ⚠️ **Re-verify on every `@clerk/nextjs` bump.** A red row here means Clerk added or renamed a
 * Server Action reachable from every public page of this app, and that is an auth-path change to be
 * reviewed by hand in its own PR — the treatment `.github/SECURITY.md` already gives
 * `claude-code-action` — not routine Dependabot noise.
 */
describe('@clerk/nextjs is the first package in a public graph, so its Server Actions are pinned', () => {
  const CLERK_ESM = resolve(WEB_DIR, 'node_modules/@clerk/nextjs/dist/esm');

  it('is installed where this suite can read it', () => {
    expect(existsSync(CLERK_ESM)).toBe(true);
  });

  it('ships exactly the two known, benign actions', () => {
    const found = globSync('**/*.js', { cwd: CLERK_ESM })
      .filter((f) => USE_SERVER_MENTION_RE.test(readFileSync(join(CLERK_ESM, f), 'utf8')))
      .sort();
    expect(found).toEqual(['app-router/keyless-actions.js', 'app-router/server-actions.js']);
  });
});

/**
 * AUTH-1 1b-bis — **every Server Action re-checks the boundary itself.**
 *
 * `beta-1.md` § 3 asked for this by "extending the existing export-enumeration test". That test
 * (`p/[profileId]/use-server-exports.test.ts`) is an export-SHAPE guard — it would happily pass
 * `export async function evilAction()` with no auth, no zod and no gate check. The shape guard stays
 * where it is; the auth assertion lands here, in the file whose job already is "every entry point
 * re-checks the boundary itself".
 *
 * ⚠️ **This is a source-text guard.** It proves the call is PRESENT, not that it runs BEFORE the DAL —
 * that is `actions.test.ts`'s `expect(getProfileByPublicId).not.toHaveBeenCalled()`. Both halves
 * together are the claim; neither alone is.
 *
 * **Three things it deliberately does not cover**, named here rather than left to be discovered:
 * an **inline** `'use server'` closure inside a page or component (not an export, so neither half sees
 * it); an **anonymous default export** (no name to enumerate); and Route Handlers, which the second
 * `describe` in this file covers separately. **Re-exports are NOT a gap** — `use-server-exports.test.ts`
 * fails any export that is not `export (default )?async function`, so `export { x } from './y'` is
 * already a red build.
 */
describe('every Server Action re-checks the boundary itself (AUTH-1 1b-bis)', () => {
  /**
   * The gate action issues the gate; it cannot require the thing it is about to grant. ⚠️ The
   * dead-entry assertion below means **1d deleting this file forces the allowlist entry to go with
   * it** — an allowlist that outlives its subject silently excuses a file somebody may recreate.
   */
  const ALLOWLIST = ['app/gate/actions.ts'];

  /**
   * 🔴 **1c SWITCHES this, it does not WIDEN it.** A regex matching `hasGateAccess|requireSession`
   * passes on either and therefore proves neither — and that is precisely the edit an author reaches
   * for when the suite goes red under time pressure. 1b-bis asserts the gate call because that is what
   * ships today, which is what makes this chunk inert and revert-safe.
   */
  const BOUNDARY_CALL = /\bhasGateAccess\s*\(/;

  /** Every `'use server'` module under `apps/web`, by path relative to it. */
  const modules = serverActionModules().map((f) => relative(WEB_DIR, f));

  /**
   * The discovered set must EQUAL this list, so a Server Action module appearing anywhere in the app
   * is a visible test edit rather than a silent gap. ⚠️ Pre-1b-bis the only enumeration was rooted at
   * `app/`, so a `'use server'` module under `components/` or `lib/` was invisible to everything.
   */
  it('finds exactly the Server Action modules this app is known to have', () => {
    expect(modules.sort()).toEqual([
      'app/gate/actions.ts',
      // The picker's "Lock this device" control. It is NOT in the allowlist below: the gate action
      // is excused because it cannot require the thing it is about to grant, and this one can —
      // it re-checks `hasGateAccess()` before clearing the cookie. Deleted at AUTH-1 1d.
      'app/p/[profileId]/actions.ts',
      'app/p/lock-device-action.ts',
    ]);
  });

  it('the scan is not vacuous', () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  it('does not mistake a module that merely mentions the directive for an action module', () => {
    // `action-state.ts` says `'use server'` inside a docblock and exports a type and a const.
    const actionState = join(APP_DIR, 'p', '[profileId]', 'action-state.ts');
    expect(USE_SERVER_MENTION_RE.test(readFileSync(actionState, 'utf8'))).toBe(true);
    expect(USE_SERVER_RE.test(code(actionState))).toBe(false);
  });

  it.each(ALLOWLIST)('%s is allowlisted and still exists (no dead entries)', (rel) => {
    expect(existsSync(join(WEB_DIR, rel))).toBe(true);
  });

  const guarded = modules.filter((rel) => !ALLOWLIST.includes(rel));

  it('something is actually being guarded after the allowlist is subtracted', () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  it.each(guarded)('%s — every exported action checks the boundary', (rel) => {
    const src = code(join(WEB_DIR, rel));
    const names = exportedActionNames(join(WEB_DIR, rel));
    expect(names.length).toBeGreaterThan(0);

    // Slice each exported function from its declaration to the next one (or EOF) and look inside it,
    // so a single check in ONE action cannot satisfy the whole module.
    const starts = names.map((n) => ({
      name: n,
      at: src.search(new RegExp(`^export\\s+async\\s+function\\s+${n}\\b`, 'm')),
    }));
    const missing = starts
      .filter(({ at }, i) => {
        const next = starts[i + 1]?.at ?? src.length;
        return !BOUNDARY_CALL.test(src.slice(at, next));
      })
      .map(({ name }) => name);

    expect(missing).toEqual([]);
  });
});
