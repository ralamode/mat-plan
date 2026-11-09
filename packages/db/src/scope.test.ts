import { globSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HOUSEHOLD_ROLE, HOUSEHOLD_ROLES } from '@mat-plan/shared';

import {
  householdScopeForRequest,
  ownerScope,
  type HouseholdScope,
  type OwnerScope,
} from './scope';
import { householdScopeForScript } from './writers/household-scope-script';

/**
 * TEN-1's structural claims about the household scope, as tests rather than sentences.
 *
 * The plan's **primary** safety mechanism is the compiler: `isLiveProfile`'s required positional
 * `HouseholdScope` makes an unconverted call site a build failure. This file guards the five things
 * the compiler **cannot** see, each of which silently removes that mechanism or the containment
 * around it:
 *
 * 1. a `packages/db` helper that **DEFAULTS** the `scope` parameter (the compile error disappears
 *    and every unconverted caller starts type-checking again);
 * 2. an **aliased re-export** or `export *` that republishes the script constructor on the
 *    specifier `apps/web` already imports;
 * 3. **`apps/web` naming `householdScopeForScript`** at all;
 * 4. a call site **reading `scope.householdId`** — turning the capability back into a tenant id,
 *    which is exactly what ADR 0006's forward-compatibility requirement 1 forbids;
 * 5. **anything above `lib/dal` CALLING `getHouseholdScope()`** (AUTH-1 1c-2) — nothing is minted
 *    and nothing is unwrapped, so guards 1-4 all stay green while a `HouseholdScope` lands in a
 *    page, a component or a `'use server'` module under `lib/`.
 *
 * Source is matched with comments STRIPPED (the `pages-need-a-session.test.ts` idiom), so a docblock that
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
 * **The modules allowed to name `scope.role`, with the reason each is here** (`PROF-1 b-s`).
 *
 * 🔴 **Two, not one, and the split is the design rather than a concession.** `scope.ts` *narrows the
 * type* (`ownerScope`); `writers/ownership.ts` *turns the role into SQL*. That mirrors `householdId`
 * exactly, where `scope.ts` constructs the capability and `ownership.ts` is the only place that
 * unwraps it into an `eq()`.
 *
 * A `Record<path, reason>` rather than a bare count, the `scoped.test.ts` → `ALLOWED_UNSCOPED`
 * idiom: a third namer is then a visible edit that has to be justified in words, not a number
 * quietly going from 2 to 3. The dead-entry assertion below keeps it from outliving its subject.
 */
const NAMES_ROLE: Readonly<Record<string, string>> = {
  'packages/db/src/scope.ts':
    '`ownerScope()` narrows a HouseholdScope to an OwnerScope. The brand lives here with the type ' +
    'it brands, beside `makeHouseholdScope` — the same reason the household constructors do.',
  'packages/db/src/writers/ownership.ts':
    'THE owner predicate, which turns the role into a conjunct. Already the one module allowed to ' +
    'unwrap `scope.householdId`, so the authority and the tenancy seam stay in one place.',
};

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

/**
 * An OPTIONAL (`role?: T`) or DEFAULTED (`role: T = v`) **role parameter** — the shape that turns a
 * missed call site into a silent owner.
 *
 * ⚠️ Deliberately NOT the `/\brole\s*[?=][^=]/` shape its `scope` sibling uses. Tried first, it
 * matched JSX `role="status"` in sixteen `apps/web` files and matched the real
 * `role: HouseholdRole = HOUSEHOLD_ROLE.owner` in **none** of them — a guard that fired everywhere
 * except on its target, which is how a guard gets relaxed into uselessness.
 *
 * The second alternative catches a **destructured** default — `({ householdId, role = 'owner' })` —
 * which the first misses and which a signature rewrite could reach for. Both constructors are
 * positional today, so this one is a tripwire rather than a live concern.
 */
const ROLE_PARAM_DEFAULTED = /\brole\s*(?:\?\s*:|:[^,;)=]*=[^=])|\{[^}\n]*\brole\s*=[^=]/;

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

  it('no REQUEST-side or shared constructor DEFAULTS its role parameter (PROF-1 b-s)', () => {
    // 🔴 **The dangerous direction is the silent UPGRADE.** `role: HouseholdRole = 'owner'` pasted
    // onto `householdScopeForRequest` or `makeHouseholdScope` compiles every unconverted call site
    // as an OWNER — the opposite of the `member` downgrade the plan worried about, and strictly
    // worse. Guard 1 above only inspects the `scope` parameter, so `role` was prose with nothing
    // behind it. `writers/household-scope-script.ts` is exempt BY NAME with its reason: a script
    // that resolves its own household is the one legitimate owner-by-default, and it is lexically
    // unreachable from `apps/web` (proved by the two guards below it).
    const ALLOWED_ROLE_DEFAULT: Readonly<Record<string, string>> = {
      'packages/db/src/writers/household-scope-script.ts':
        'the SCRIPT constructor: seeds, db:verify and corrections act as the operator, who is the ' +
        'owner; never reachable from apps/web (module boundary, guards below)',
    };
    const offenders = [...DB_SOURCES, ...WEB_SOURCES].filter(
      (f) => !(f in ALLOWED_ROLE_DEFAULT) && ROLE_PARAM_DEFAULTED.test(code(join(REPO, f))),
    );
    expect(
      offenders,
      'a defaulted `role` makes every unconverted call site an OWNER, silently — add the file to ' +
        'ALLOWED_ROLE_DEFAULT with a reason only if that is genuinely what it means',
    ).toEqual([]);
  });

  it('ALLOWED_ROLE_DEFAULT carries no dead entry', () => {
    // The allowlist above is only honest while each entry still names a file that defaults a role.
    // A stale entry is a standing permission for a file that no longer needs it.
    expect(
      ROLE_PARAM_DEFAULTED.test(
        code(join(REPO, 'packages/db/src/writers/household-scope-script.ts')),
      ),
      'household-scope-script.ts no longer defaults its role — drop it from ALLOWED_ROLE_DEFAULT',
    ).toBe(true);
  });

  it('🔴 no module NAMES OwnerScope in a type assertion (the brand is not cast on by name)', () => {
    // ⚠️ **`as OwnerScope` compiles with ONE word, not three.** `OwnerScope` is a SUBTYPE of
    // `HouseholdScope`, and TS allows `x as T` whenever either side is assignable to the other — so
    // `archiveProfile(db, scope as OwnerScope, id)` in the DAL typechecks. It fails CLOSED (the
    // owner conjunct binds `'member' = 'owner'` → 0 rows) but it fails INVISIBLY: 0 rows maps to
    // `null` maps to the 404-shaped refusal, so every member's archive would silently return "no
    // athlete found" and the owner-only refusal would never fire. `verify.ts`'s one named forgery is
    // exempt — proving the cast is possible is its job.
    const ALLOWED_CAST: Readonly<Record<string, string>> = {
      'packages/db/src/scope.ts':
        'ownerScope() itself — the ONE narrowing, which is what every other site must route through',
      'packages/db/scripts/verify.ts':
        'the ONE named forgery: proves a cast-past-the-narrowing writes 0 rows (PROF-1 b-s block)',
    };
    const offenders = [...DB_SOURCES, ...WEB_SOURCES].filter(
      // Both assertion syntaxes. `<OwnerScope>scope` is legal in a `.ts` file and no ESLint rule in
      // this repo forbids it (`consistent-type-assertions` is not configured), so a guard that only
      // knew `as` would be titled "the only way in" while leaving a second door.
      (f) => !(f in ALLOWED_CAST) && /\bas\s+OwnerScope\b|<OwnerScope>/.test(code(join(REPO, f))),
    );
    expect(
      offenders,
      'cast past ownerScope() and the refusal becomes a 404 nobody can explain — call ownerScope() ' +
        'and branch on null instead',
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
    //
    // 🔴 **CASE-INSENSITIVE since PROF-1 a-r, and the `i` is load-bearing.** The pattern was
    // `[Ss]cope`, which matches `scope` and `aScope` and **misses `A_SCOPE`** — and this file's two
    // canonical fixtures are named `A_SCOPE` and `B_SCOPE`, so the most likely unwrap in the repo
    // was the one shape the guard could not see. `db:verify`'s first PROF-1 a-r draft wrote
    // `householdId: A_SCOPE.householdId` four times and all 24 assertions here stayed GREEN
    // (probed). Found by a review lens on #350, not by the guard. ⚠️ `i` also widens the prefix
    // class to `SCOPE`/`Scope`; that is the point, and nothing legitimate is caught by it — the
    // assertion below still resolves to exactly `UNWRAPS_SCOPE`.
    const readers = [...DB_SOURCES, ...WEB_SOURCES].filter((f) =>
      /\b[\w$]*scope\.householdId\b/i.test(code(join(REPO, f))),
    );
    expect(
      readers.map((f) => relative('', f)).sort(),
      'ADR 0006 fwd-1: unwrapping the capability must happen in ONE place, or COACH-1 has to widen every site',
    ).toEqual([UNWRAPS_SCOPE]);
  });

  it('🔴 exactly one module names the MEMBERSHIP query — it returns raw household ids', () => {
    // `AUTH-1` 1c-4 barrel-exported `membershipHousehold` because the DAL had no other way to reach
    // it (`packages/db`'s `exports` map publishes only `"."`). That traded a module-resolution
    // boundary for an honour one: the module's own docblock says its ids are *"the one thing a
    // caller may not freely hold"*, and every guard in this file would stay green while a page under
    // `app/` held a raw `household_id` for the signed-in user — none of them names this function,
    // reads `scope.householdId`, or calls `getHouseholdScope`. ADR 0006 fwd-1 forbids exactly that.
    //
    // The SYMBOL, not a call: `bypass-is-contained.test.ts` records an aliased import walking
    // straight through a `\s*\(` form.
    const namers = WEB_SOURCES.filter((f) => /\bmembershipHousehold\b/.test(code(join(REPO, f))));
    expect(
      namers.map((f) => relative('', f)).sort(),
      'the membership query returns INTERNAL household ids — only the resolver may hold them',
    ).toEqual([DERIVES_SCOPE]);
  });

  it('🔴 the membership query is never ALIASED out of packages/db — the app-side grep only sees its own name', () => {
    // ⚠️ **The guard above is one-sided, and its sibling at `householdScopeForScript` is not.** That
    // one carries a second, DB-side assertion precisely because a grep for a symbol in `apps/web`
    // cannot see a rename that happened in `packages/db`: one line —
    // `export { membershipHousehold as lookupHousehold } from './queries/household-membership'` —
    // republishes it on the `"."` specifier the app already imports, under a name the app-side sweep
    // has never heard of. Every other guard in this file stays green while a page holds a raw
    // internal `household_id`, which is the ADR 0006 fwd-1 outcome the guard above exists to stop.
    //
    // `export * from './queries/household-membership'` in `src/index.ts` is the ONE intended route
    // and is exempt by name; a star-export of that module from anywhere else is not.
    //
    // 🔴 **The declaring module is NOT exempt, and exempting it was the bug.** The sibling guard
    // exempts its own home safely, because `writers/household-scope-script.ts` is unreachable from
    // `apps/web` by `packages/db`'s `exports` map at all. This module is the opposite: the barrel
    // star-exports it, so **anything it exports is published on the `"."` specifier the app
    // imports** — one `export { membershipHousehold as lookupHousehold };` added INSIDE it reaches
    // the app under a name no guard knows. Copying the sibling's exemption without that adjustment
    // left the guard green against exactly the evasion it was written for, and the first probe of it
    // planted the alias in the barrel, where the filter did reach.
    const BARREL = 'packages/db/src/index.ts';
    const offenders = DB_SOURCES.filter((f) => {
      const rel = relative('', f);
      const src = code(join(REPO, f));
      // One pattern, not three: `{ x as membershipHousehold }` and `{ membershipHousehold as x }`
      // both contain the bare symbol inside the braces, so the two narrower forms were subsumed.
      if (/export\s*\{[^}]*\bmembershipHousehold\b/.test(src)) return true;
      // A star-export naming the module, OR a directory barrel that would re-publish it indirectly.
      if (/export\s+\*\s+from\s+['"][^'"]*(household-membership|\/queries)['"]/.test(src)) {
        return rel !== BARREL;
      }
      return false;
    });
    expect(
      offenders.map((f) => relative('', f)).sort(),
      'membershipHousehold must reach apps/web under its OWN name only — an aliased or extra re-export makes the app-side containment guard vacuous',
    ).toEqual([]);
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

  it('nothing above lib/dal CALLS getHouseholdScope() (write-path invariant 2)', () => {
    // AUTH-1 1c-2. The guards above contain who may MINT or UNWRAP a scope; this one contains who
    // may ASK FOR one. Without it the guide's newest red-flagged invariant is prose: a page could
    // `const scope = await getHouseholdScope(); if (!scope) …` and every existing gate stays green,
    // because nothing is minted and `scope.householdId` is never read — yet a `HouseholdScope` is
    // now sitting in `app/`, which is exactly what invariant 2 forbids. The supported way to ask
    // "does this request resolve a household" without receiving the capability is `householdState()`.
    //
    // Swept by EXCLUSION rather than by naming `app|components`: invariant 2 is "nothing ABOVE
    // `lib/dal` holds a scope", and a `'use server'` module under `lib/` (not `lib/dal/`) is above it
    // too — 1b-bis exists precisely because such modules are easy to forget. Two homes may name the
    // resolver: the DAL that owns it, and the screenshot fixture script, which has a database and no
    // request (already a named constant here).
    const offenders = WEB_SOURCES.filter(
      (f) =>
        !relative('', f).startsWith('apps/web/lib/dal/') &&
        relative('', f) !== FIXTURE_DERIVES_SCOPE &&
        /\bgetHouseholdScope\b/.test(code(join(REPO, f))),
    );
    expect(
      offenders.map((f) => relative('', f)).sort(),
      'write-path.md inv. 2: a caller above lib/dal branches on householdState(), never on the scope itself',
    ).toEqual([]);
  });

  /**
   * `PROF-1 b-s`. The role is an AUTHORITY field: a module that reads it can decide who may write,
   * so the set of modules that can is the thing worth pinning — exactly as `scope.householdId` is.
   */
  it('exactly the named modules read `scope.role` (PROF-1 b-s)', () => {
    const readers = [...DB_SOURCES, ...WEB_SOURCES].filter((f) =>
      // Case-insensitive for the reason the unwrap guard is: a `SCREAMING_CASE` scope constant
      // (`A_SCOPE.role`) walked past `[Ss]cope` and stayed green — found on #350.
      /\b[\w$]*scope\.role\b/i.test(code(join(REPO, f))),
    );
    expect(
      readers.map((f) => relative('', f)).sort(),
      'the role decides who may write, so a new reader is a new authority decision — add it to ' +
        'NAMES_ROLE with its reason, or route through ownerScope()/the owner predicate',
    ).toEqual(Object.keys(NAMES_ROLE).sort());
  });

  it('NAMES_ROLE carries no dead entry', () => {
    const live = new Set(
      [...DB_SOURCES, ...WEB_SOURCES]
        .filter((f) => /\b[\w$]*scope\.role\b/i.test(code(join(REPO, f))))
        .map((f) => relative('', f)),
    );
    expect(
      Object.keys(NAMES_ROLE).filter((p) => !live.has(p)),
      'an entry for a module that no longer reads the role — delete it in the PR that stopped',
    ).toEqual([]);
  });

  it('db:verify mints only NAMED scopes, each with a reason (the plan’s R5(1))', () => {
    // With ~22 mechanical call-site edits, a scope minted AT a call site makes an assertion pass for
    // the wrong reason, invisibly. Named constants mean a wrong scope is a wrong NAME.
    //
    // 🔴 **This was a COUNT (`<= 2`) until PROF-1 b, and the count was the problem.** `b` needs a
    // third scope — a legitimate household-A **member** — because the member path has to be proved
    // against the real writer, not against the forged scope `b-s` used (a forgery is the right test
    // for a forgery and the wrong one for "a member of this household gets 0 rows"). Under a bare
    // count the only ways to get one were to raise the number, which says nothing, or to spread a
    // forgery, which proves the wrong thing. A `Record<name, reason>` is the idiom this file already
    // uses for `NAMES_ROLE` and `scoped.test.ts` uses for its unscoped allowlist: adding a scope is
    // a visible, reviewed edit that must carry a justification.
    const MINTED_SCOPES: Readonly<Record<string, string>> = {
      A_SCOPE: 'household A, OWNER — the default actor for every positive assertion',
      B_SCOPE: 'household B, OWNER — the other side of every cross-household refusal',
      A_MEMBER_SCOPE:
        'household A, MEMBER — PROF-1 b: a member of the SAME household must get 0 rows from ' +
        'archiveProfile, which only a legitimately-minted member scope can prove (a forged one ' +
        'proves the forgery case instead)',
    };

    const verify = code(join(REPO, 'packages/db/scripts/verify.ts'));
    // The declaration site, not the call site: `const NAME = householdScopeForScript(...)`.
    const declared = [
      ...verify.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*householdScopeForScript\(/g),
    ].map((m) => m[1]);
    const mints = verify.match(/householdScopeForScript\(/g) ?? [];

    expect(
      mints.length,
      'every householdScopeForScript() in verify.ts must be a named const — never inline at a call site',
    ).toBe(declared.length);
    expect(
      declared.sort(),
      'a scope minted in verify.ts needs an entry in MINTED_SCOPES saying what it is FOR',
    ).toEqual(Object.keys(MINTED_SCOPES).sort());
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
      expect(() => householdScopeForRequest(value as number, HOUSEHOLD_ROLE.owner)).toThrow(
        /safe integer/,
      );
    },
  );

  /**
   * 🔴 **`toEqual` on the WHOLE object, deliberately — this is the shape pin.** It is what made
   * `PROF-1 b-s`'s widening a visible, reviewed edit rather than a field that appeared: adding
   * `role` broke this line and the two constructors' signatures, which is exactly what should happen
   * when the capability grows. Keep it exhaustive; `toMatchObject` here would let the next field in
   * silently.
   */
  it('a valid id round-trips as a scope carrying the household id and the role', () => {
    expect(householdScopeForScript(7)).toEqual({ householdId: 7, role: HOUSEHOLD_ROLE.owner });
    expect(householdScopeForScript(7, HOUSEHOLD_ROLE.member)).toEqual({
      householdId: 7,
      role: HOUSEHOLD_ROLE.member,
    });
  });

  /**
   * `PROF-1 b-s` — the narrowing, which is the whole point of the second brand.
   *
   * ⚠️ These assert BEHAVIOUR, not the type. The compile-time half (a `HouseholdScope` is not
   * assignable where `OwnerScope` is required) is proved by the `@ts-expect-error` pin below —
   * because a runtime test cannot see it, and a brand that compiles both ways is decoration.
   */
  describe('ownerScope — the authority narrowing (PROF-1 b-s)', () => {
    it('narrows an owner scope to itself', () => {
      const scope = householdScopeForScript(7, HOUSEHOLD_ROLE.owner);
      expect(ownerScope(scope)).toBe(scope);
    });

    it('refuses a member scope with null, never a throw', () => {
      expect(ownerScope(householdScopeForScript(7, HOUSEHOLD_ROLE.member))).toBeNull();
    });

    it('every role is either narrowed or refused — no third answer', () => {
      for (const role of HOUSEHOLD_ROLES) {
        const narrowed = ownerScope(householdScopeForScript(7, role));
        expect(narrowed === null || narrowed.role === HOUSEHOLD_ROLE.owner).toBe(true);
      }
    });
  });
});

/**
 * **PROF-1 a-1w — `profiles.client_id` never leaves the seam.** The one mitigation that bounds the
 * key's existence oracle, enforced rather than asserted in prose.
 *
 * 🔴 **Why this is a test and not a paragraph.** `uq_profiles_client_id` is **global and
 * non-partial**, so a signed-in member submitting a well-formed key learns whether *some* household
 * already holds it: a free key redirects, a spent one is refused. That residual is accepted
 * (`prof-1-athletes.md` -> aS8) **on one condition** — the key is never observable, so the >=74 random
 * bits of a v7 key make guessing infeasible. That condition is what the plan promised as a test and
 * first shipped as prose. The first column added to a profile DTO "for the sync payload" would
 * quietly turn an accepted residual into a live cross-household probe, and nothing else in this repo
 * would notice.
 *
 * ⚠️ **It pins a SET, not an absence**, so a new reader fails here by name rather than by a count
 * nobody re-derives. Both entries are reasoned: the seam reads the column and names it as the
 * insert's conflict target, and `verify.ts` is the proof that it does. A third entry is a design
 * question, not an edit to this list.
 *
 * ## ⚠️ What it catches, stated plainly — probed, not assumed
 *
 * It matches **source text**, so it is a tripwire for the forms a DTO is actually written in, not a
 * proof of containment. Probed against six shapes:
 *
 * | Form                                                 | Caught? |
 * | ---------------------------------------------------- | ------- |
 * | `schema.profiles.clientId`                           | ✅      |
 * | `eq(profiles.clientId, k)` (table import)            | ✅      |
 * | `schema.entries.clientId`                            | ✅ not matched — the OTHER column, correctly ignored |
 * | `profiles['clientId']`                               | ❌      |
 * | `const { clientId } = schema.profiles`               | ❌      |
 * | `const p = schema.profiles; p.clientId`              | ❌      |
 * | `alias(schema.profiles, 'p').clientId`               | ❌      |
 * | `profiles` ⏎ `.clientId` (Prettier splits long chains) | ❌      |
 * | `getTableColumns(schema.profiles)`                    | ❌      |
 * | 🔴 **a whole-row `db.select().from(schema.profiles)` or `.returning()`** | ❌ |
 * | a raw `sql` fragment naming `client_id`              | ❌      |
 *
 * 🔴 **The last two are the ones to understand.** A whole-row select **carries `client_id` without
 * naming it**, and "just return the row" is the likeliest way a DTO leak actually happens — so this
 * guard would not catch the most plausible version of the mistake it is named for. What catches that
 * is a different rule, already enforced elsewhere: the DAL returns a **minimal DTO, never a raw row**
 * (AGENTS.md → "Data Access Layer"), and every current `.from(schema.profiles)` select in `lib/dal`
 * passes an explicit column list. The raw-SQL miss is likewise covered by AGENTS.md → the "don't"
 * list, which forbids `sql.raw` and interpolated SQL outright.
 *
 * ⚠️ **Two more misses come from `code()` itself**, the shared comment-stripper: a mid-line `//`
 * inside a string, and a string containing `/*`, each swallow the rest of a line or block. No file in
 * the tree is affected today (raw-vs-stripped detection was compared across all sources and only the
 * allowlisted files match either way), but the helper is not a parser.
 *
 * **So, stated plainly:** this guard stops the plausible *accident* — someone adding `clientId` to an
 * explicit select list — and stops nothing a determined author does. That is the same bargain
 * `scoped.test.ts` strikes and says so about itself, and the PR that added this must not claim more.
 */
describe('profiles.client_id is named only inside its seam (PROF-1 a-1w)', () => {
  /** `ownership.ts` is the read + the insert's conflict target; `verify.ts` is the proof. */
  const MAY_NAME_CLIENT_ID = [
    'packages/db/src/writers/ownership.ts',
    'packages/db/scripts/verify.ts',
  ];
  const NAMES_CLIENT_ID = /\bprofiles\.clientId\b/;
  // ⚠️ `packages/shared` is included EXPLICITLY. `DB_SOURCES` + `WEB_SOURCES` miss it, and that is
  // where the CSV export builders live (`shared/src/csv/*`) — i.e. exactly one of the surfaces aS8's
  // mitigation names ("no DTO, URL, export, log or Sentry context carries client_id"). A guard whose
  // glob cannot see the export would have been a comfortable one.
  const SHARED_SOURCES = sources('packages/shared/src/**/*.ts');
  const namers = [...DB_SOURCES, ...WEB_SOURCES, ...SHARED_SOURCES].filter((f) =>
    NAMES_CLIENT_ID.test(code(join(REPO, f))),
  );

  it('finds the sources at all (an empty glob would pass everything below)', () => {
    // 🔴 **PER-GLOB floors, because the sum hid a dead glob.** The first version asserted only that
    // the TOTAL exceeded 50 — and `DB_SOURCES` + `SHARED_SOURCES` alone are 72, so an empty
    // `WEB_SOURCES` would have passed while `apps/web` went unscanned. That is where DTOs live.
    expect(DB_SOURCES.length).toBeGreaterThan(20);
    expect(WEB_SOURCES.length).toBeGreaterThan(100);
    expect(SHARED_SOURCES.length).toBeGreaterThan(20);
    // And each glob must still reach the specific surface it is here for: the DAL that builds the
    // profile DTOs, and the CSV builder that writes the export.
    expect(WEB_SOURCES).toContain('apps/web/lib/dal/profiles.ts');
    expect(SHARED_SOURCES).toContain('packages/shared/src/csv/strength-log.ts');
  });

  it('can see a reference, and does not confuse it with the entries column', () => {
    expect(NAMES_CLIENT_ID.test('eq(schema.profiles.clientId, key)')).toBe(true);
    expect(NAMES_CLIENT_ID.test('eq(schema.entries.clientId, key)')).toBe(false);
  });

  it('no file outside the seam names it', () => {
    expect([...namers].sort()).toEqual([...MAY_NAME_CLIENT_ID].sort());
  });

  it('the allowlist carries no dead entry', () => {
    expect(MAY_NAME_CLIENT_ID.filter((f) => !namers.includes(f))).toEqual([]);
  });
});

/**
 * 🔴 **The COMPILE-TIME half of the authority, pinned where a runtime test cannot reach.**
 *
 * `OwnerScope`'s entire claim is that a writer requiring owner authority cannot be called with a
 * plain `HouseholdScope` — _"forgetting it is a compile error, not a review miss"_. Nothing in the
 * suite above can observe that: both values are the same object at runtime. So it is asserted the
 * one way TypeScript allows, with `@ts-expect-error`, which **fails the build as `TS2578 Unused
 * directive` if the error it guards ever stops happening** — i.e. if the brand quietly erodes.
 *
 * This is the idiom `app/p/[profileId]/mutating-actions.test.ts` established at `WP-1`, after a
 * five-document claim that a union was exclusive turned out to be false under probing.
 */
function _ownerAuthorityIsAType(): void {
  const needsOwner = (_scope: OwnerScope): void => {};
  const plain: HouseholdScope = householdScopeForScript(7, HOUSEHOLD_ROLE.member);

  // @ts-expect-error — a plain HouseholdScope is NOT an OwnerScope, which is the whole brand
  needsOwner(plain);

  // …and the narrowed one is, with no cast.
  const narrowed = ownerScope(householdScopeForScript(7, HOUSEHOLD_ROLE.owner));
  if (narrowed) needsOwner(narrowed);
}
