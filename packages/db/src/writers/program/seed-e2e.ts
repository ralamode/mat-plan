import { SEED_PROFILE_4_PUBLIC_ID, type Weekday, WEEKDAYS } from '@mat-plan/shared';
import {
  DAY_PLAN_FIXTURE_SOURCES,
  fixtureIds,
  programOf,
  workoutOf,
  type World,
} from '@mat-plan/shared/program/fixtures';

/**
 * **Not a contract fixture.** The test seed's one program for lane C's Change e2e
 * (`apps/web/e2e/day-page.spec.ts`), and nothing else (docs/plans/fam-1-e2e-change-athlete.md).
 *
 * Athlete Four (`SEED_PROFILE_4_PUBLIC_ID`) is on it from `SEED_E2E_START_DAY`, a fixed past day, so
 * no clock is read: on whatever day the suite runs, in any time zone, today and yesterday both hold
 * **Heavy A ("Morning") and then Heavy B ("Evening")**, the fixture world's two superset workouts.
 *
 * It is a small world of its own (the fixture world's catalog, one program, one assignment), seeded
 * by the same function as the fixture world (`seed-fixtures.ts`), so every skip and the idempotency
 * hold for it too. No read fixture includes it: the contract's deep-equals and counts stay the
 * fixture world's.
 */

const FIXTURE_WORLD: World = DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world;

/**
 * The day Athlete Four starts on the e2e program: any fixed day before every e2e run. Its own value,
 * not the contract world's switch day, which the contract owner may move for a fixture's reason.
 */
export const SEED_E2E_START_DAY = '2026-11-02';

/** The e2e program's id inside its own world. */
export const SEED_E2E_PROGRAM_ID = 'p2001';

/** Its fixed `client_id`: a fixture-style id no fixture program uses (proved in `db:verify`). */
export const SEED_E2E_PROGRAM_CLIENT_ID = fixtureIds.program(SEED_E2E_PROGRAM_ID);

/** Its name. It reads as test data in the preview's Programs list. */
export const SEED_E2E_PROGRAM_NAME = 'Test – Change e2e';

/** The two workouts, by the fixture world's ids: Heavy A, then Heavy B. */
const FAMILY = programOf(FIXTURE_WORLD, 'p1');
const HEAVY = [workoutOf(FAMILY, 'w2'), workoutOf(FAMILY, 'w3')] as const;

/** The slots of every day of the week, in order. */
export const SEED_E2E_SLOTS = [
  { label: 'Morning', wid: 'w2' },
  { label: 'Evening', wid: 'w3' },
] as const;

/** The e2e world: the fixture world's catalog, the one program, Athlete Four on it. */
export const SEED_E2E_WORLD: World = {
  ...FIXTURE_WORLD,
  programs: [
    {
      id: SEED_E2E_PROGRAM_ID,
      name: SEED_E2E_PROGRAM_NAME,
      workouts: HEAVY.map((w) => structuredClone(w)),
      week: Object.fromEntries(
        WEEKDAYS.map((weekday) => [weekday, SEED_E2E_SLOTS.map((slot) => ({ ...slot }))]),
      ) as Record<Weekday, Array<{ label: string; wid: string }>>,
    },
  ],
  assign: { a4: [{ prog: SEED_E2E_PROGRAM_ID, from: SEED_E2E_START_DAY }] },
  entries: [],
};

/** The e2e world's athlete, by its world id. */
export const SEED_E2E_ATHLETES: Readonly<Record<string, string>> = { a4: SEED_PROFILE_4_PUBLIC_ID };

/** What the e2e program adds to a seed run, for the proofs that count every seeded row. */
export const SEED_E2E_COUNTS = {
  workouts: HEAVY.length,
  prescriptions: HEAVY.reduce((n, w) => n + w.items.length, 0),
  assignments: 1,
} as const;
