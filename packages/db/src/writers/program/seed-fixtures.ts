import {
  emptyWeek,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
  type ProgramResult,
  type Weekday,
  WEEKDAYS,
  newId,
} from '@mat-plan/shared';
import {
  DAY_PLAN_FIXTURE_SOURCES,
  fixtureIds,
  programView,
  workoutDraft,
  type World,
} from '@mat-plan/shared/program/fixtures';

import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { programBlockByClientId } from '../ownership';
import { putOn } from './assign';
import { createProgram } from './create-program';
import { newItem } from './new-item';
import { saveWeek } from './save-week';
import { saveWorkout } from './save-workout';

/**
 * The world the program contract's fixtures are built from (the prototype's `seed()`), as the
 * `today-two-programs` fixture holds it: the same `seeded` world `programs-list` and `family-program`
 * are built from (`@mat-plan/shared/program/fixtures`).
 */
const FIXTURE_WORLD: World = DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world;

/**
 * The seed's athletes, by the fixture world's ids. Adult One (`a3`) has no seed profile, so
 * Adult One's program is seeded with nobody on it.
 */
export const SEED_FIXTURE_ATHLETES: Readonly<Record<string, string>> = {
  a1: SEED_PROFILE_PUBLIC_ID,
  a2: SEED_PROFILE_2_PUBLIC_ID,
};

/**
 * A fixture program's `client_id`: the contract's placeholder id for it. Fixed, so a second seed run
 * finds the program the first one made. It is never the program's `public_id`, which the writer
 * mints.
 */
export const seedFixtureProgramClientId = (programId: string) => fixtureIds.program(programId);

/** Every fixture program's `client_id`, for a proof that must tell the seed's programs from others. */
export const SEED_FIXTURE_PROGRAM_CLIENT_IDS: readonly string[] = FIXTURE_WORLD.programs.map((p) =>
  seedFixtureProgramClientId(p.id),
);

function must<T extends object>(result: ProgramResult<T>, what: string): { ok: true } & T {
  // Fixed text: it names the fixture step, never a value from the database.
  if (!result.ok) throw new Error(`seedProgramFixtures: ${what} refused (${result.reason})`);
  return result;
}

/**
 * Seed the FIXTURE family's programs into one household: the programs, workouts and weeks the
 * program contract's named fixtures describe, and the seed's athletes on them, from the days the
 * fixtures say (`docs/plans/fam-1-family-program.md` §4, "Named fixtures"; FAM-1 step 6c-i).
 *
 * **Built with the real program writers**, so what is seeded is what a person could have made:
 * `createProgram`, `newItem` (an item the household or the catalog already has is reused, as the
 * picker would), `saveWorkout`, `saveWeek` and `putOn`. `putOn` is given each start day as its
 * `today`, so a start in the past is the start a person made that day.
 *
 * Lane A's step 1 calls it from `src/seed.ts` when `SEED_FIXTURES=1` (D10: only the test seed writes
 * fixture programs; production never does). Logged rows are not seeded.
 *
 * @param db    The seed's database handle, or an open transaction.
 * @param scope The household to seed into, as its owner. The CALLER resolves it: `seed.ts` already
 *              resolves the root household, and is one of the modules allowed to mint a scope
 *              (`writers/household-scope-script.ts` → "Who may call it"). This module must not mint
 *              one, and must not take a household id.
 *
 * **Idempotent: a program the household already has (by its fixed `client_id`, live or removed) is
 * left as it is**, with its workouts, week and athletes, whatever was done to it since. A run that
 * fails writes nothing: it is one transaction.
 */
export async function seedProgramFixtures(db: Executor, scope: HouseholdScope): Promise<void> {
  await db.transaction(async (tx) => {
    const items = new Map<string, { itemPublicId: string; name: string }>();
    const itemFor = async (key: keyof World['catalog']) => {
      const known = items.get(key);
      if (known) return known;
      const { name, type } = FIXTURE_WORLD.catalog[key];
      const made = must(await newItem(tx, scope, { name, trackingType: type }), `item ${key}`);
      // An item found by name keeps its own type; a fixture's quantities fit only the fixture's.
      if (made.trackingType !== type) {
        throw new Error(`seedProgramFixtures: item ${key} exists with another tracking type`);
      }
      const found = { itemPublicId: made.itemPublicId, name: made.name };
      items.set(key, found);
      return found;
    };

    const made = new Map<string, string>();
    for (const program of FIXTURE_WORLD.programs) {
      const clientId = seedFixtureProgramClientId(program.id);
      if (await programBlockByClientId(tx, scope, clientId)) continue;

      const { programPublicId } = must(
        await createProgram(tx, scope, { clientId, name: program.name }),
        `program ${program.id}`,
      );

      const workoutIds = new Map<string, string>();
      for (const workout of program.workouts) {
        const draft = workoutDraft(FIXTURE_WORLD, program.id, workout.wid);
        // One statement at a time: a transaction is one connection.
        const itemsOf = [];
        for (const [i, item] of workout.items.entries()) {
          const real = await itemFor(item.iid);
          itemsOf.push({
            ...draft.items[i]!,
            prescriptionClientId: newId(),
            itemPublicId: real.itemPublicId,
            itemName: real.name,
          });
        }
        const { workoutPublicId } = must(
          await saveWorkout(tx, scope, {
            ...draft,
            programPublicId,
            workoutClientId: newId(),
            workoutPublicId: null,
            items: itemsOf,
          }),
          `workout ${workout.wid}`,
        );
        workoutIds.set(fixtureIds.workout(workout.wid), workoutPublicId);
      }

      const { week } = programView(FIXTURE_WORLD, program.id);
      const days = emptyWeek();
      for (const weekday of WEEKDAYS) {
        days[weekday as Weekday] = week[weekday].map((slot) => ({
          ...slot,
          workoutPublicId: workoutIds.get(slot.workoutPublicId)!,
        }));
      }
      must(await saveWeek(tx, scope, { programPublicId, days }), `week of ${program.id}`);
      made.set(program.id, programPublicId);
    }

    // Each athlete's programs in their own order, so the order `putOn` gives them is the world's.
    // Only onto programs made in this run: a program seeded before keeps the athletes it has now.
    for (const [athlete, assigned] of Object.entries(FIXTURE_WORLD.assign)) {
      const profilePublicId = SEED_FIXTURE_ATHLETES[athlete];
      if (!profilePublicId) continue;
      for (const stretch of assigned) {
        const programPublicId = made.get(stretch.prog);
        if (!programPublicId) continue;
        // Every stretch the seeded world holds is open (`to` unset); a closed one would need Take off.
        if (stretch.to !== undefined) {
          throw new Error('seedProgramFixtures: a closed stretch needs Take off (step 6d)');
        }
        must(
          await putOn(
            tx,
            scope,
            { programPublicId, profilePublicIds: [profilePublicId], from: stretch.from },
            stretch.from,
          ),
          `${athlete} on ${stretch.prog}`,
        );
      }
    }
  });
}
