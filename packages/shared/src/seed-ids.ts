/**
 * Fixed UUIDv7s for the single-tenant v0/v1 seed rows — the stable identities that make a re-seed conflict on
 * the natural key / public_id instead of inserting duplicates. Hoisted to `shared` (from `packages/db`) so
 * BOTH the DB seed and the app-authored `PROGRAM_SEED` (which references the household + specific kids by
 * public_id) can single-source them — `packages/shared` can't import `packages/db`, so the consts live here
 * and `packages/db/src/seed.ts` re-exports them for back-compat.
 *
 * ⚠️ **In the maintainer's deployment these may equal live production `public_id`s** until the fresh
 * start (`CAT-3` K7) or SEC-6's re-key: migration 0001 and the pre-`OPS-2` seed wrote them there. They
 * are never authorization. Since `OPS-2` PR 1 only the fixture seed writes the profile ids; migration
 * 0001 still writes the household id on every new database.
 */

import { seedPublicId } from './catalog-seed';

/** The root household (named `HOUSEHOLD_DEFAULT_NAME`, in `enums.ts`). */
export const SEED_HOUSEHOLD_PUBLIC_ID = seedPublicId('010');

// The the kid profiles under the root household (V1-3). SEED_PROFILE_PUBLIC_ID keeps the v0 id.
export const SEED_PROFILE_PUBLIC_ID = seedPublicId('001');
export const SEED_PROFILE_2_PUBLIC_ID = seedPublicId('002');
/**
 * A THIRD athlete, seeded for `PROF-1 b` (2026-11-08) and owned by the **archive** specs.
 *
 * 🔴 **It exists because archive REMOVES an athlete from the picker, which no other fixture mutation
 * does.** The rename specs can share Athlete Two safely — a rename APPENDS to the name and every
 * sibling matches by substring. Archiving is different in kind: for the ~2s an archive test holds it,
 * Athlete Two's day page is read-only and its tile is gone, so any spec asserting a form on that page
 * fails. Observed: `a11y.spec.ts`'s weigh-in test went red with _"Athlete Two's yesterday should be
 * empty before this test logs it"_, under `fullyParallel`, for exactly that reason.
 *
 * ⚠️ **So do not reach for this one for anything else.** A second spec depending on it would recreate
 * the problem it was added to solve.
 */
export const SEED_PROFILE_3_PUBLIC_ID = seedPublicId('003');

/**
 * Every household and profile `public_id` the seed writes (`PRIV-3` RC, D7), built from the
 * constants above so no UUID is re-typed. Movement ids keep their own set
 * (`MOVEMENT_SEED_PUBLIC_IDS`).
 *
 * Two readers: `household-claim-2026-10-25` refuses a household id in it outside a local or preview
 * database, and `create-household-…` proves it never mints one. 🔴 `db:verify`'s post-seed snapshot
 * holds the seed's households and profiles EQUAL to this set, in both directions, so a seeded row
 * missing from it (or a member the seed no longer writes) fails there.
 */
export const SEED_PUBLIC_IDS: ReadonlySet<string> = new Set([
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_3_PUBLIC_ID,
]);

/**
 * The two seeded profiles' display names — **role names, never a real first name** (AGENTS.md -> "No
 * personal names"; `OSS-1`). Here rather than re-typed in the seed, `db:verify` and the e2e specs,
 * because that re-typing is exactly why the previous names took a fifty-file sweep to remove: the next
 * rename is these two lines.
 *
 * `One`/`Two` rather than `A`/`B` on purpose — the program's day roles are already Day A / Day B, and
 * `athleteADayA` is unreadable. The legacy-CSV evidence set under `docs/samples/legacy-csv/` keeps its
 * own `Athlete A` / `Athlete B` labels: a different corpus, deliberately not fixtures.
 */
export const SEED_PROFILE_NAME = 'Athlete One';
export const SEED_PROFILE_2_NAME = 'Athlete Two';
export const SEED_PROFILE_3_NAME = 'Athlete Three';

/**
 * AUTH-1 1c-3a — the synthetic principal the **test session bypass** returns, injected by
 * `e2e-local.ts`, `screenshot-ephemeral.ts` and CI's smoke step as `E2E_SESSION_BYPASS_USER_ID`.
 *
 * 🔴 **It must never be a real Clerk id.** A real one would be personal data committed to a public
 * repo (AGENTS.md → privacy: *"a real value committed anywhere in the tree is a P0, and deleting it
 * from HEAD is not removing it"*), would collide with that person's own `mat-plan:mutate:<id>` rate
 * bucket, and — were the bypass ever to arm against a live database — would resolve a **real
 * household** rather than failing to resolve anything.
 *
 * Obviously fake on purpose, the `E2E_LOCAL_GATE_PASSWORD` idiom: a random-looking placeholder trips
 * gitleaks, and a reader should be able to tell at a glance that this identifies nobody. The shape
 * still satisfies `CLERK_USER_ID_PATTERN` (`clerk.ts`; `lib/env.ts` applies it), because the principal has to flow through
 * the same code paths a real one does.
 */
export const E2E_SESSION_BYPASS_USER = 'user_000000000000000000000000e2e';
