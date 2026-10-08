import { globSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { householdScopeForRequest } from './scope';
import { householdScopeForScript } from './writers/household-scope-script';

/**
 * TEN-1's structural claims about the household scope, as tests rather than sentences.
 *
 * The plan's **primary** safety mechanism is the compiler: `isLiveProfile`'s required positional
 * `HouseholdScope` makes an unconverted call site a build failure. This file guards the four things
 * the compiler **cannot** see, each of which silently removes that mechanism or the containment
 * around it:
 *
 * 1. a `packages/db` helper that **DEFAULTS** the `scope` parameter (the compile error disappears
 *    and every unconverted caller starts type-checking again);
 * 2. an **aliased re-export** or `export *` that republishes the script constructor on the
 *    specifier `apps/web` already imports;
 * 3. **`apps/web` naming `householdScopeForScript`** at all;
 * 4. a call site **reading `scope.householdId`** — turning the capability back into a tenant id,
 *    which is exactly what ADR 0006's forward-compatibility requirement 1 forbids.
 *
 * Source is matched with comments STRIPPED (the `pages-are-gated.test.ts` idiom), so a docblock that
 * *describes* the hazard — this one included — cannot trip the guard, and a `// TODO: scope` cannot
 * satisfy one.
 *
 * ⚠️ This is **not** 1d's `apps/web/lib/dal/scoped.test.ts`, which asserts that every `lib/dal` read
 * reaching `db` carries a scope. That one can only be absolute once chunk 1c leaves no hand-written
 * predicates, and an allowlist that shrinks is one nobody audits.
 */

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** Comments out, strings kept — matching identifiers and calls in this repo's source. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const sources = (pattern: string) =>
  globSync(pattern, { cwd: REPO })
    .filter((f) => !f.includes('node_modules'))
    .filter((f) => !f.endsWith('scope.test.ts'));

const DB_SOURCES = [
  ...sources('packages/db/src/**/*.ts'),
  ...sources('packages/db/scripts/**/*.ts'),
];
const WEB_SOURCES = sources('apps/web/**/*.{ts,tsx}');

/** The ONE module allowed to unwrap the capability — the household conjunct lives there. */
const UNWRAPS_SCOPE = 'packages/db/src/writers/ownership.ts';

/** The ONE module allowed to derive a scope from a request. */
const DERIVES_SCOPE = 'apps/web/lib/dal/household.ts';

/**
 * The ONE fixture script allowed to derive one, recorded here with its reason (TEN-1 1c).
 *
 * `screenshot-ephemeral.ts` writes fixtures into a throwaway embedded Postgres it created seconds
 * earlier, through `packages/db`'s write cores — which since 1c require a scope. It is the
 * *db:verify / db:correct* case (a database, no request), but `householdScopeForScript` lives in a
 * module `packages/db`'s `exports` map makes unreachable from `apps/web` **by module resolution**,
 * deliberately, so a script in `apps/web` has to derive instead.
 *
 * **Deriving is the stronger half of the rule**: it never names a household id, it asks the database
 * which household is live through the resolver's own single-sourced probe. The exception is lexical
 * (one file, under `scripts/`), and the request-serving tree is asserted absolutely clean below —
 * which is a check this file did not have before.
 */
const FIXTURE_DERIVES_SCOPE = 'apps/web/scripts/screenshot-ephemeral.ts';

/** The request-serving tree: routes, DAL, components. No fixture script lives here. */
const WEB_REQUEST_TREE = /^apps\/web\/(app|lib|components)\//;

describe('the scope seam is structurally contained (TEN-1 1b)', () => {
  it('finds the sources (an empty glob would pass everything below)', () => {
    expect(DB_SOURCES.length).toBeGreaterThan(10);
    expect(WEB_SOURCES.length).toBeGreaterThan(50);
  });

  it('no packages/db function DEFAULTS its scope parameter', () => {
    // `scope = …` / `scope?: …` in a parameter list silently removes the required-parameter compile
    // error, which is this whole sweep's safety net. A local `const scope = …` is the legitimate
    // shape (a script resolving its own), so those lines come out first — otherwise the guard would
    // fire on the correct code and get relaxed, which is how a guard dies.
    const offenders = DB_SOURCES.filter((f) =>
      /\bscope\s*[?=][^=]/.test(
        code(join(REPO, f)).replace(/^.*\b(?:const|let|var)\s+scope\b.*$/gm, ''),
      ),
    );
    expect(
      offenders,
      'a defaulted/optional `scope` parameter makes a missed call site invisible — the one change the plan rejects (Alternative 5)',
    ).toEqual([]);
  });

  it('the script constructor is never re-exported, aliased or star-exported out of its module', () => {
    const offenders = DB_SOURCES.filter((f) => {
      if (f === 'packages/db/src/writers/household-scope-script.ts') return false;
      const src = code(join(REPO, f));
      return (
        /export\s*\{[^}]*householdScopeForScript/.test(src) ||
        /export\s+\*\s+from\s+['"][^'"]*household-scope-script/.test(src) ||
        /export\s*\{[^}]*\bas\s+householdScopeForScript/.test(src)
      );
    });
    expect(
      offenders,
      'householdScopeForScript must stay unreachable by bare specifier — a re-export defeats the module boundary',
    ).toEqual([]);
  });

  it('apps/web never names the script constructor', () => {
    const offenders = WEB_SOURCES.filter((f) =>
      /\bhouseholdScopeForScript\b/.test(code(join(REPO, f))),
    );
    expect(
      offenders.map((f) => relative('', f)),
      'apps/web must obtain a scope by DERIVING it, never by naming a household id',
    ).toEqual([]);
  });

  it('exactly one module reads `scope.householdId` (the scope stays a capability)', () => {
    // Any `<something>scope.householdId` — a call site that unwraps the capability to build its own
    // predicate. `schema.profiles.householdId` (a column) deliberately does not match.
    const readers = [...DB_SOURCES, ...WEB_SOURCES].filter((f) =>
      /\b[\w$]*[Ss]cope\.householdId\b/.test(code(join(REPO, f))),
    );
    expect(
      readers.map((f) => relative('', f)).sort(),
      'ADR 0006 fwd-1: unwrapping the capability must happen in ONE place, or COACH-1 has to widen every site',
    ).toEqual([UNWRAPS_SCOPE]);
  });

  it('exactly one module derives a scope from a request (plus the one named fixture script)', () => {
    const derivers = WEB_SOURCES.filter((f) =>
      /\bhouseholdScopeForRequest\b/.test(code(join(REPO, f))),
    );
    expect(
      derivers.map((f) => relative('', f)).sort(),
      'getHouseholdScope() is the ONE place that decides which household a request belongs to; the only other namer is the screenshot fixture script, which has a database and no request',
    ).toEqual([DERIVES_SCOPE, FIXTURE_DERIVES_SCOPE].sort());
  });

  it('nothing in the REQUEST-SERVING tree mints a scope except getHouseholdScope()', () => {
    // The assertion above allows a second file by name; this one says where a second file may NOT
    // live. A fixture script under `scripts/` runs against a throwaway database; a constructor named
    // in `app/`, `lib/` or `components/` is on a request path, which is the thing being contained.
    const offenders = WEB_SOURCES.filter(
      (f) =>
        WEB_REQUEST_TREE.test(f) &&
        relative('', f) !== DERIVES_SCOPE &&
        /\bhouseholdScopeFor(?:Request|Script)\b|\bmakeHouseholdScope\b/.test(code(join(REPO, f))),
    );
    expect(
      offenders.map((f) => relative('', f)).sort(),
      'a scope constructor on a request path bypasses getHouseholdScope() — the one place allowed to decide whose request this is',
    ).toEqual([]);
  });

  it('db:verify mints exactly two named scopes (the plan’s R5(1))', () => {
    // With ~22 mechanical call-site edits, a scope minted AT a call site makes an assertion pass for
    // the wrong reason, invisibly. Two named constants mean a wrong scope is a wrong NAME.
    const verify = code(join(REPO, 'packages/db/scripts/verify.ts'));
    const mints = verify.match(/householdScopeForScript\(/g) ?? [];
    expect(
      mints.length,
      'verify.ts must use A_SCOPE / B_SCOPE, never an ad-hoc scope at a call site',
    ).toBeLessThanOrEqual(2);
  });
});

describe('the scope constructors refuse an unresolved id', () => {
  // drizzle's `eq(col, undefined)` does NOT fail loudly — it widens the predicate. So an unresolved
  // household id has to throw at construction rather than at query time.
  const bad: unknown[] = [undefined, null, Number.NaN, 1.5, '3', Infinity];

  it.each(bad.map((v) => [String(v), v]))('householdScopeForScript rejects %s', (_label, value) => {
    expect(() => householdScopeForScript(value as number)).toThrow(/safe integer/);
  });

  it.each(bad.map((v) => [String(v), v]))(
    'householdScopeForRequest rejects %s',
    (_label, value) => {
      expect(() => householdScopeForRequest(value as number)).toThrow(/safe integer/);
    },
  );

  it('a valid id round-trips as a scope carrying only the household id', () => {
    expect(householdScopeForScript(7)).toEqual({ householdId: 7 });
  });
});
