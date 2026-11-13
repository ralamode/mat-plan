import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
 * Route Handler re-checks the session itself. OSS-2 made the first exception (the public landing), and
 * a prose rule plus a unit test of a string function would not notice a future page that forgets the
 * call — DUALS-1's merge accident (#153) was exactly that kind of silent loss.
 *
 * 🔴 **At `1d` this file's subject narrowed from "gated or session'd" to "needs a session", and it is
 * MORE load-bearing than before, not less.** The proxy's gate bounce used to be a second, independent
 * thing standing between a stranger and a page. It is gone, so these per-route assertions are now the
 * only thing that notices a page which forgets to check anything.
 * ✅ **Renamed from `pages-are-gated.test.ts` at `AUTH-1` PR C.** `1d` moved the contents (the
 * subject narrowed from "gated" to "needs a session"); the rename and its citation sweep were held
 * back so that PR's diff stayed about behaviour. ⚠️ `git log --follow` is what shows the history
 * across the move.
 *
 * Source is matched with comments STRIPPED, so a `// TODO: requireSession()` cannot satisfy it.
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

describe('every page requires a session or is deliberately public', () => {
  it('finds the pages (an empty glob would pass everything below)', () => {
    expect(pages.length).toBeGreaterThan(2);
  });

  it.each(pages.map((f) => [routeOf(f), f]))('%s', (route, file) => {
    const src = code(file);
    // 🔴 **ONE conjunct at `1d`, and it must stay a conjunct of one — never an alternation.**
    // `1c-3b` required BOTH `requireGatedPage()` and `requireSession()`; `1d` deletes the former.
    // ⚠️ The standing rule in this file is that a regex accepting EITHER helper proves neither, and
    // that rule is why the gate conjunct was DELETED rather than folded into an `||` with the
    // session one. If a second boundary helper ever arrives, add a second independent check.
    const sessioned = /\bawait\s+requireSession\(\)/.test(src);
    expect(
      sessioned || isPublicPath(route),
      `${route} must await requireSession(), or be a public path (PUBLIC_PATHS / ` +
        `PUBLIC_PATH_TREES). Found session=${sessioned}.`,
    ).toBe(true);
  });
});

describe('every Route Handler checks the session itself', () => {
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
    const src = code(file);
    // ⚠️ **Not an alternation, and never was meant to be.** It once accepted `isValidGateCookie`
    // too, because the export handler hand-rolled the gate predicate's body; that copy went at
    // `1c-3b` and the gate itself at `1d`, leaving one named helper. A handler that reintroduces a
    // raw cookie read fails here rather than quietly passing.
    //
    // 🔴 **A KNOWN SHAPE PROBLEM, recorded so the next author widens it the RIGHT way.** This asks
    // for both calls TEXTUALLY in the handler file, while the action half of this suite was reshaped
    // the opposite way: an action delegates to `enterMutation` and the conjuncts are asserted once
    // in the helper, precisely because seven copies of a predicate is seven places to drop one. The
    // `/api/sync` handler is next — it would be `app/api/sync/route.ts`, and today's only handler is
    // `app/p/[profileId]/export/route.ts` — and if it routes through a shared entry helper
    // — the correct shape by that argument — it contains NEITHER spelling and goes red here. It fails
    // CLOSED, so nothing is silently unprotected. **Then: mirror the action half** (accept delegation
    // plus the returned-refusal backreference), do NOT inline the predicate again and do NOT loosen
    // this to an alternation. With one handler in the tree there is nothing yet to generalise from.
    const sessioned = /\bsessionUserOrNull\s*\(/.test(src);
    expect(
      sessioned,
      `${route}/route.ts must check a session itself. Found session=${sessioned}.`,
    ).toBe(true);
  });
});

/**
 * A `'use server'` function reachable from a PUBLIC page's module graph — root layout, error boundary and
 * every other root-segment file included — would be bundled for that page, and so invokable by an
 * unauthenticated POST to it with only its own session check in the way. Public pages reach none.
 * ⚠️ At `1d` this matters more: the gate bounce that used to stop such a POST before it reached Next
 * is gone, and `e2e/landing.spec.ts` lost the runtime arm that proved it (see `tech-debt.md`).
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

  // ⚠️ Repointed at `1d`: this named `app/gate/actions.ts`, which `1d` deletes — so the detector's
  // own non-vacuity check threw ENOENT rather than failing with a useful message. It must name a
  // module that really does carry the directive, which is now the only one left.
  it('can see an action module (the detector is not vacuous)', () => {
    expect(USE_SERVER_MENTION_RE.test(code(join(APP_DIR, 'p', '[profileId]', 'actions.ts')))).toBe(
      true,
    );
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
   * 🔴 **EMPTY at `1d`, and that is the allowlist working as designed.** Its one entry was
   * `app/gate/actions.ts` — the gate action, which issued the gate and so could not require the thing
   * it was about to grant. `1d` deletes that file, and the dead-entry assertion below is what FORCED
   * the entry to go with it: an allowlist that outlives its subject silently excuses a path somebody
   * may later recreate.
   *
   * ⚠️ **`it.each([])` REGISTERS NO TESTS** — probed, Vitest 5.0.5, and it emits no warning — so the
   * dead-entry loop below now proves nothing on its own. `expect(ALLOWLIST).toEqual([])` is what
   * keeps the emptiness ASSERTED rather than merely true, and it is also the thing that goes red if
   * a future author adds an entry without reinstating the `existsSync` loop's coverage.
   */
  const ALLOWLIST: string[] = [];

  /**
   * 🔴 **1c SWITCHES this, it does not WIDEN it.** A regex matching `hasGateAccess|requireSession`
   * passes on either and therefore proves neither — and that is precisely the edit an author reaches
   * for when the suite goes red under time pressure. 1b-bis asserted the gate call directly because
   * that is what shipped then.
   *
   * 🔴 **1c-3b made it three conjuncts, and review on #323 collapsed the seven copies into
   * `enterMutation` _(maintainer, 2026-11-01)_ — so the guard splits in two rather than loosening:**
   *
   *  - **per action**, below: the action must call `enterMutation`, and the module must import it
   *    from the ONE pinned alias — so "calls something named like the helper" is not enough.
   *  - **once, in the helper**: the three conjuncts appear there IN ORDER. The old per-action scan
   *    could not assert order at all (seven slices, three independent presence checks); one
   *    definition can. That is the half that is strictly stronger than what 1c-3b shipped.
   */
  const ENTRY_CALL = /\bawait\s+enterMutation\s*\(/;
  /**
   * 🔴 **ONE literal, and it is the ALIAS — never an alternation (WP-1).** The helper moved up to
   * `app/p/` so every `/p` action module can reach it, and the obvious edit was to accept `'./'` OR
   * `'../'`. **This file's standing rule forbids that** (the one-conjunct notes above;
   * `docs/features/write-path.md` invariant 1): a regex matching either passes on either and proves
   * neither.
   * ⚠️ **The alternation would also open a shadow**, which is the concrete reason rather than the
   * stylistic one: a NEW local `app/p/[profileId]/mutation-entry.ts` — a weaker `enterMutation` that
   * skips the limiter — would satisfy `'./mutation-entry'` from `actions.ts`, while the order `it`
   * below inspects only the canonical file. That is the "local function of the same name" hole this
   * conjunct exists for, returning as a local MODULE.
   * ⚠️ **"Both depths" was never enough anyway:** the CRUD-1 spec puts V1-22's program edit actions
   * under `app/p/[profileId]/program/`, a THIRD depth. The alias is depth-independent.
   */
  const ENTRY_IMPORT = /import\s*\{\s*enterMutation\s*\}\s*from\s*'@\/app\/p\/mutation-entry'/;
  /**
   * 🔴 **The one source-half conjunct the collapse WEAKENED, restored.** Before it, the gate was one
   * inseparable expression — `if (!(await hasGateAccess())) return {…}` — so matching the call and
   * dropping the result was not really expressible. Two statements can come apart: a bare
   * `await enterMutation(NO_PROFILE_LOG);` with no return satisfies `ENTRY_CALL` and checks nothing.
   * Backreferenced, so the binding returned is the one that was tested. Found by the security lens
   * on #323.
   */
  const ENTRY_REFUSAL = /if\s*\(\s*!\s*(\w+)\.ok\s*\)\s*return\s+\1\s*;/;

  /** AUTH-1 1c-3b, and from `1d` the only boundary conjunct before every mutation. */
  const SESSION_CALL = /\bsessionUserOrNull\s*\(/;
  /**
   * 🔴 **The limiter needs a SOURCE guard, because no behavioural test can catch its absence.**
   * `checkMutationLimit` fails open, and under vitest `mutationLimiter` is always `null` — so every
   * call answers `allowed: true`. A call placed after the write, or whose result is ignored, is
   * invisible to the entire suite. `rate-limit.ts`'s own docblock warns about exactly this shape one
   * level up ("a sizing test asserted the new number and passed"). An eighth action that forgets it
   * fails here instead.
   */
  const LIMITER_CALL = /\bcheckMutationLimit\s*\(/;

  /** Every `'use server'` module under `apps/web`, by path relative to it. */
  const modules = serverActionModules().map((f) => relative(WEB_DIR, f));

  /**
   * The discovered set must EQUAL this list, so a Server Action module appearing anywhere in the app
   * is a visible test edit rather than a silent gap. ⚠️ Pre-1b-bis the only enumeration was rooted at
   * `app/`, so a `'use server'` module under `components/` or `lib/` was invisible to everything.
   */
  it('finds exactly the Server Action modules this app is known to have', () => {
    // ⚠️ `app/gate/actions.ts` was the other entry until `1d` deleted it.
    // PROF-1 a-r adds the second LIVE entry — the household-level athlete module WP-1's fixed set
    // reserved. Every assertion in this describe now runs over both, which is the point of the list.
    expect(modules.sort()).toEqual(['app/p/[profileId]/actions.ts', 'app/p/profile-actions.ts']);
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

  // 🔴 The emptiness is asserted, not assumed — see ALLOWLIST's note on `it.each([])`.
  it('the allowlist is empty, so nothing is excused from the boundary', () => {
    expect(ALLOWLIST).toEqual([]);
  });

  // ⚠️ Registers ZERO cases while the allowlist is empty. Kept deliberately: the moment an entry is
  // added it starts proving that entry is not dead, and the assertion above is what covers the gap
  // in the meantime.
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
    // Each of the three must appear INSIDE the action's own slice. Reported separately so a failure
    // names which conjunct went missing rather than just "the boundary".
    const report = (re: RegExp) =>
      starts
        .filter(({ at }, i) => !re.test(src.slice(at, starts[i + 1]?.at ?? src.length)))
        .map(({ name }) => name);

    expect(report(ENTRY_CALL), 'actions missing the awaited enterMutation() call').toEqual([]);
    expect(report(ENTRY_REFUSAL), 'actions that call enterMutation but drop its refusal').toEqual(
      [],
    );
    // A local function of the same name would satisfy the slice scan above and check nothing.
    expect(
      ENTRY_IMPORT.test(src),
      `${rel} must import enterMutation from '@/app/p/mutation-entry' (the ONE pinned specifier — never a relative path, which a local shadow module could satisfy)`,
    ).toBe(true);
  });

  /**
   * 🔴 **The conjuncts themselves, and their ORDER, asserted once where they now live.**
   *
   * `enterMutation` is the whole boundary for seven actions, so a conjunct dropped here is dropped
   * everywhere at once — and the order is load-bearing, not stylistic: the limiter is keyed on the
   * principal, so it MUST come after the session, and both must come before the caller's zod parse
   * and DB read or an unauthenticated flood buys Redis and Postgres work. Nothing behavioural can
   * see any of this: the limiter fails open and is `null` under vitest.
   *
   * ⚠️ **Two conjuncts at `1d`, not three** — the gate's position assertion went with the gate. The
   * surviving ordering claim (session before limiter) is the one that was load-bearing, because it
   * is the one keyed on a value the earlier check produces.
   */
  it('enterMutation holds the session and the limiter — in that order', () => {
    const src = code(join(APP_DIR, 'p', 'mutation-entry.ts')); // WP-1 moved it out of the dynamic
    // segment; this path moves with it or the read throws ENOENT and takes the only
    // order proof with it.;
    const session = src.search(SESSION_CALL);
    const limiter = src.search(LIMITER_CALL);
    expect(session, 'the session check').toBeGreaterThan(-1);
    expect(limiter, 'checkMutationLimit').toBeGreaterThan(-1);
    expect(session, 'the principal must exist before it can key the limiter').toBeLessThan(limiter);
  });
});

/**
 * **UI-5's landmark invariant as a test.** The shell exists so that `<main>` is declared in ONE place
 * instead of nine, and two things depend on that being true and staying true:
 *
 * - `components/ui/sheet.tsx:433` patches `tabIndex` onto `document.querySelector('main')` for its
 *   focus fallback. `querySelector` takes the FIRST match, so a second `<main>` silently decides which
 *   element that fallback lands on.
 * - 🔴 **axe will never say so.** `landmark-no-duplicate-main`, `landmark-one-main` and
 *   `landmark-unique` are all tagged `best-practice`, and `e2e/a11y.spec.ts` scans `wcag2a`/`wcag2aa`
 *   only. A duplicate landmark is invisible to every automated check this repo runs — which is why it
 *   gets a source scan rather than a note in a docblock.
 *
 * The scan is textual on purpose: it is checking what the source DECLARES, not what a render produces,
 * so a page that reintroduces its own `<main>` fails here at `pnpm test` speed.
 */
describe('UI-5 · one <main>, declared in the shell', () => {
  /**
   * The pages that render their own `<main>`, each because it is not an app screen.
   *
   * ⚠️ **A named list, not an exclusion pattern.** A new page that needs its own landmark has to be
   * added here with a reason, which is the point: the failure is the conversation.
   */
  const OWN_MAIN: Record<string, string> = {
    // A full-width token gallery (UI-3), deliberately `max-w-5xl` — wider than the shell's content
    // measure, with no athlete to switch to and no rail to show.
    'design/tokens/page.tsx': 'the UI-3 token gallery is a full-width tool, not an app screen',
  };

  // ⚠️ **One definition each, used by the self-test below AND the per-page assertions.** They were
  // written twice — a literal in the self-test and the same literal in the loop — so a typo in the
  // second was invisible to the first: the self-test proved a COPY worked. A correctness lens
  // caught it, and it is the exact defect this suite's header warns about twice.
  const MAIN_TAG_RE = /<main[\s>]/;
  const SHELL_TAG_RE = /<AppShell[\s>]/;

  const authenticated = pages.filter((f) => !isPublicPath(routeOf(f)));

  it('finds the authenticated pages (an empty glob would pass everything below)', () => {
    expect(authenticated.length).toBeGreaterThan(4);
  });

  // ⚠️ The non-vacuity floor above counts pages; this one proves the MATCHER works. Without it a
  // typo in the regex would pass every page silently — the shape of defect this suite's own header
  // warns about twice.
  it('the matcher catches a bare <main> (a broken regex would pass everything)', () => {
    expect(MAIN_TAG_RE.test('return <main className="x">hi</main>;')).toBe(true);
    expect(MAIN_TAG_RE.test('return <AppShell>hi</AppShell>;')).toBe(false);
    expect(SHELL_TAG_RE.test('return <AppShell busy>hi</AppShell>;')).toBe(true);
    expect(SHELL_TAG_RE.test('return <AppShellSomethingElse />;')).toBe(false);
  });

  it.each(authenticated.map((f) => [relative(APP_DIR, f), f]))('%s', (name, file) => {
    const src = code(file);
    const declaresMain = MAIN_TAG_RE.test(src);
    const usesShell = SHELL_TAG_RE.test(src);

    if (name in OWN_MAIN) {
      expect(declaresMain, `${name} is listed in OWN_MAIN (${OWN_MAIN[name]})`).toBe(true);
      expect(usesShell, `${name} renders its own <main>, so it must not also use AppShell`).toBe(
        false,
      );
      return;
    }

    expect(usesShell, `${name} must render <AppShell> — or join OWN_MAIN with a reason`).toBe(true);
    expect(
      declaresMain,
      `${name} must not declare its own <main>; the shell owns the landmark`,
    ).toBe(false);
    // The constant the shell replaced. A page still spreading it is a page the shell did not reach:
    // it would centre a second column inside the grid cell and ignore the rail entirely.
    expect(src).not.toMatch(/\bPAGE_SHELL_CLASS\b/);
  });

  /**
   * The two `loading.tsx` files by NAME, because the glob above is `**​/page.tsx` and would never see
   * them — and they are the files that matter most here. Each renders a `<main aria-busy>` that sits
   * in the DOM BESIDE the streamed page's for as long as the stream takes: the one moment this app
   * really does have two `<main>` elements. That was the geometry guard's first red, before
   * `networkidle`.
   *
   * ⚠️ **Two of them, and the pairing is the point** (`UI-5`): `/p` renders no rail and a day page
   * renders one, so a single shared fallback had to reserve the wrong frame for one of them and
   * shift the column 32px when the page resolved. `nav` is what each asserts.
   */
  const LOADING = [
    { path: 'p/loading.tsx', nav: false, why: '/p has no rail — the page IS the athlete switcher' },
    { path: 'p/[profileId]/loading.tsx', nav: true, why: 'a day page reserves the rail column' },
  ] as const;

  it.each(LOADING.map((l) => [l.path, l] as const))('%s renders the shell', (name, spec) => {
    const file = join(APP_DIR, spec.path);
    expect(existsSync(file), `${name} exists (a renamed file would pass vacuously)`).toBe(true);
    const src = code(file);
    expect(src).toMatch(SHELL_TAG_RE);
    expect(src).not.toMatch(MAIN_TAG_RE);
    expect(src, 'the busy state is what this file is FOR').toMatch(/\bbusy\b/);
    // `nav={false}` opts out of the reserved rail column; its absence opts in. Asserted per file
    // because getting it backwards is invisible at phone widths and is a layout shift at `lg`.
    expect(src.includes('nav={false}'), spec.why).toBe(!spec.nav);
  });
});
