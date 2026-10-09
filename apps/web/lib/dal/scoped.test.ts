import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **TEN-1 1d — the DAL-side structural guard, and it is ABSOLUTE.**
 *
 * Two claims about `apps/web/lib/dal/`, each as its own assertion with its own exception list:
 *
 * 1. **nothing reaches the database without resolving or being handed a household scope** — exception:
 *    `catalog.ts`'s three global reads;
 * 2. **nothing builds its own ownership predicate** — exception: `household.ts`, for
 *    `reportScopeMiss`'s existence-only probe.
 *
 * Those are **exactly the two exceptions** [write-path.md](../../../../docs/features/write-path.md)
 * (invariant 2, Traps) already declares, and no others. If a third is ever needed, that is a design
 * question, not an edit to this file.
 *
 * ## Why this file could not be written before 1c
 *
 * The plan ([ten-1-household-scope.md](../../../../docs/plans/ten-1-household-scope.md) → chunk 1d)
 * is explicit: *"written earlier it ships with an allowlist that then has to shrink, and an allowlist
 * that shrinks is one nobody audits."* 1b converted the three profile-resolution sites plus everything
 * `ownedEntryIds` reaches; 1c converted the tail and took the hand-written predicate count to **zero**.
 * So these lists are final — the only remaining change is that TEN-2 **removes** one entry, when
 * `movements` gains a `household_id` and `findOrCreateMovementId` stops being a residual. The
 * dead-entry assertion below makes that removal forced rather than optional.
 *
 * ## ⚠️ What this is NOT — `packages/db/src/scope.test.ts` (1b) owns the other half
 *
 * That file guards the scope **type's containment**: no defaulted `scope` parameter, no re-export or
 * alias of the script constructor, `apps/web` never naming it, exactly one module reading
 * `scope.householdId`, exactly one deriving a scope from a request, and `verify.ts` minting at most
 * two. **None of that is repeated here.** This file asks the one question that one cannot: does every
 * `lib/dal` path to the database actually carry a scope, and does any of them still scope by hand?
 *
 * ## ⚠️ And it is one of three vehicles, not the proof
 *
 * Stated plainly so it is not over-claimed. A **call-site** guard cannot see SQL: delete the household
 * conjunct from `isLiveProfile` and `db:verify`'s matrix goes red in both directions while this file
 * stays **green** (the plan's § Test plan says so, and `db:mutations`' patch 01 demonstrates it).
 * Conversely a site that drops the scope entirely is caught only here. Assertion 1 also cannot see a
 * function that resolves a scope and then forgets to pass it into *one* of its queries —
 * `reportScopeMiss` is literally that shape, legitimately, which is why assertion 2 exists and
 * allowlists it separately.
 *
 * ## How it reads the source
 *
 * Comments are **stripped** (the `pages-are-gated.test.ts` idiom), so a `// TODO: getHouseholdScope()`
 * cannot satisfy the guard and a docblock that *describes* the hazard — this one included — cannot
 * trip it. The unit is a **top-level declaration, exported or not**: a private helper that reaches
 * `db` unscoped is the same leak as a public one, and `export.ts` → `prescribedFor` is exactly that
 * shape (it takes a `HouseholdScope` and is never exported).
 */

const DAL_DIR = dirname(fileURLToPath(import.meta.url));

/** Comments out, strings kept — matching calls and identifiers in this app's source. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const dalFiles = globSync('*.ts', { cwd: DAL_DIR })
  .filter((f) => !f.endsWith('.test.ts'))
  .sort();

/**
 * Where a top-level declaration begins. Everything up to the next one is its body, which is all the
 * matching below needs — nothing in this directory nests a declaration at column 0.
 */
const DECL_RE =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface)\s+([\w$]+)/gm;

type Decl = { id: string; body: string };

function declarationsOf(file: string): Decl[] {
  const src = code(join(DAL_DIR, file));
  const starts = [...src.matchAll(DECL_RE)].map((m) => ({ at: m.index, name: m[1]! }));
  return starts.map((s, i) => ({
    id: `${file}#${s.name}`,
    body: src.slice(s.at, starts[i + 1]?.at ?? src.length),
  }));
}

/**
 * Does this declaration hand the Drizzle client to the database?
 *
 * Two shapes, and they are the only two in this directory: `db.select(…)` / `await db\n.insert(…)`
 * (a query built here) and `writerOrQuery(db, …)` (a single-sourced core in `packages/db`). The
 * lookbehind keeps `globalForDb`, `createDb` and the `'./db'` specifier out.
 */
const REACHES_DB = /(?<![\w$.])db\s*\.|\(\s*db\s*[,)]/;

/**
 * Does it carry a household scope? Either it resolves one itself (`await getHouseholdScope()`, the
 * `lib/dal` rule — invariant 2: nothing above this layer holds a scope) or it is handed one as a
 * `HouseholdScope` by a caller in this layer that did.
 */
const CARRIES_SCOPE = /await\s+getHouseholdScope\(\)|\bHouseholdScope\b/;

/**
 * **Exception list 1 — three entries, all in `catalog.ts`, all already recorded in `write-path.md`.**
 *
 * The reason **is** the entry: a future author adding a fourth has to write one, next to the three
 * above it, in the file CI runs — which is the whole point of a list over a regex. A new read that
 * touches **household data** does not belong here at all; it belongs in a function that resolves
 * `getHouseholdScope()`.
 */
const ALLOWED_UNSCOPED: Readonly<Record<string, string>> = {
  'catalog.ts#getActivityTypeByKey':
    '`activity_types` is global reference data seeded from `packages/shared` (architecture.md § 4), ' +
    'with NO `household_id` column to scope by. Resolving an activity type reveals nothing about ' +
    'any household.',
  'catalog.ts#getMetricDefinition':
    '`metric_definitions` — same: global, seeded from the same consts, no household column.',
  'catalog.ts#findOrCreateMovementId':
    '⚠️ THE ONE THAT IS NOT BENIGN, and the only entry here that is a residual rather than a design ' +
    'choice. `movements` has no `household_id` column either, but it is WRITTEN from free text — so ' +
    "one household's name binds to another household's row, and whichever types a name first pins " +
    "that slug's `name` / `is_bodyweight` / `unit_default` for everyone. TEN-1 1d PROVES that " +
    '(`db:verify` → "TEN-1 1d: the catalog verdict", both directions, through the same ' +
    '`findOrCreateMovement` core this function delegates to) rather than asserting it. **TEN-2 ' +
    'deletes this entry.**',
};

describe('every lib/dal path to the database carries a household scope (TEN-1 1d)', () => {
  const declarations = dalFiles.flatMap(declarationsOf);
  const reachingDb = declarations.filter((d) => REACHES_DB.test(d.body));
  const unscoped = reachingDb.filter((d) => !CARRIES_SCOPE.test(d.body));

  it('finds the source (an empty glob would pass everything below)', () => {
    expect(dalFiles.length, 'apps/web/lib/dal/*.ts').toBeGreaterThan(5);
    expect(declarations.length, 'top-level declarations parsed').toBeGreaterThan(30);
    expect(reachingDb.length, 'declarations that reach `db`').toBeGreaterThan(10);
  });

  it('can see a scoped reach AND an unscoped one (neither detector is vacuous)', () => {
    // If either regex silently stopped matching, the assertions below would pass by finding nothing.
    expect(reachingDb.map((d) => d.id)).toContain('profiles.ts#getProfileByPublicId');
    expect(unscoped.map((d) => d.id)).toContain('catalog.ts#getActivityTypeByKey');
  });

  it('no unallowlisted declaration reaches `db` without one', () => {
    expect(
      unscoped.map((d) => d.id).filter((id) => !(id in ALLOWED_UNSCOPED)),
      'a lib/dal path to the database with no household scope: resolve getHouseholdScope() in it, ' +
        'or take a HouseholdScope from a caller in this layer that did (write-path.md invariant 2)',
    ).toEqual([]);
  });

  it('the allowlist carries no dead entry (TEN-2 must delete its own)', () => {
    // The `household-synthetic-is-dark.test.ts` lesson: an allowlist that cannot go stale. An entry
    // for a function that no longer exists, or that now carries a scope, is coverage nobody
    // re-earned — and it is how `findOrCreateMovementId` would quietly stay listed after TEN-2.
    const live = new Set(unscoped.map((d) => d.id));
    expect(
      Object.keys(ALLOWED_UNSCOPED).filter((id) => !live.has(id)),
      'an allowlist entry that no longer describes anything — delete it in the PR that fixed it',
    ).toEqual([]);
  });
});

describe('no lib/dal function builds its own ownership predicate (TEN-1 1d)', () => {
  /**
   * The predicate is `packages/db/src/writers/ownership.ts` → `isLiveProfile(publicId, scope)` /
   * `inHousehold(scope)`. It had **eleven** hand-typed copies before V1-24; TEN-1 1c took the count
   * to zero. A security predicate is the last thing that should drift between call sites, and the
   * compiler cannot see a twelfth copy — it type-checks perfectly, it is just scoped weaker.
   */
  const OWNERSHIP_COLUMN =
    /\b(?:eq|isNull)\(\s*schema\.profiles\.(?:publicId|householdId|deletedAt)\b/;

  /**
   * **Exception list 2 — one file.** `household.ts` holds `reportScopeMiss`, ADR 0006 obligation 3's
   * existence-only probe: deliberately unscoped, because telling `cross_household` from
   * `unknown_resource` is the entire signal the scoped predicate destroys. It selects a literal,
   * returns `void` (so it cannot be copied into something that returns data) and swallows its own
   * errors; the external answer is still a 404. Documented at the call site.
   *
   * Note this is also the one declaration assertion 1 above **cannot** see: it resolves a scope (to
   * classify the outcome) and then queries without it, so it reads as scoped there. Two assertions,
   * two exception lists, for exactly that reason.
   */
  const PROBE_FILE = 'household.ts';

  it('can see a hand-written predicate (the detector is not vacuous)', () => {
    expect(dalFiles.length).toBeGreaterThan(5);
    expect(OWNERSHIP_COLUMN.test(code(join(DAL_DIR, PROBE_FILE)))).toBe(true);
  });

  it.each(dalFiles.filter((f) => f !== PROBE_FILE).map((f) => [f]))('%s', (file) => {
    const hits = code(join(DAL_DIR, file))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => OWNERSHIP_COLUMN.test(line));
    expect(
      hits,
      `${file} builds an ownership predicate by hand — use isLiveProfile(publicId, scope) or ` +
        'inHousehold(scope) from packages/db/src/writers/ownership.ts, never a copy',
    ).toEqual([]);
  });
});
