import { z } from 'zod';

import { MOVEMENT_SEED_ROWS } from './catalog-movements';

/**
 * The picker's browse structure: which GROUP each seeded movement sits in, and the short names
 * people type for a few of them (PICK-1 Decision 3).
 *
 * 🔴 **Code keyed by slug, not a column, and that is a deliberate trade.** The obvious alternative is
 * a `movements.group` column — but the seed is `ON CONFLICT DO NOTHING` (`packages/db/src/seed.ts`),
 * so a new column's values would never reach the 35 rows already in production without a backfill
 * migration, for display metadata that nothing edits. Grouping by the existing `pattern` does not
 * work either: `isolation` alone splits three ways (a Lateral Raise is Push, a Hammer Curl is Pull, a
 * Calf Raise is Legs), so it would need per-row overrides anyway — at which point the overrides ARE
 * this map.
 *
 * ⚠️ **A global row is listed only if its slug is in {@link MOVEMENT_PICKER_ENTRIES}.** That is what
 * makes "no `other` group" true by construction rather than by a test that happens to pass
 * _(correctness S5, security N1)_. A seeded row added by `CAT-2` without a group is simply not
 * browsable — it still resolves by id and by typed name — and the key-set test below fails until
 * someone chooses, which is the point: an ungrouped movement is a decision, not a default.
 *
 * ⚠️ **Provisional until PICK-1 chunk 0.** The grouping and the six aliases come from the approved
 * prototype (`docs/prototypes/crud-1/index.html`, v8/v9); chunk 0 is the maintainer's confirmation
 * pass, and it edits a TypeScript map rather than running a migration.
 */

/**
 * The browse groups, in the order the picker renders them. `wrestling` is **declared and empty**
 * until `C3` seeds wrestling-specific movements — declared now so the order is settled once and a
 * later PR adds rows rather than re-deciding where they go.
 */
export const MOVEMENT_PICKER_GROUPS = ['push', 'pull', 'legs', 'core', 'wrestling'] as const;

export type MovementPickerGroup = (typeof MOVEMENT_PICKER_GROUPS)[number];

export const movementPickerGroupSchema = z.enum(MOVEMENT_PICKER_GROUPS);

/**
 * What a group is called on screen. Separate from the key so the key stays a stable identifier and
 * the copy can change without touching the map — and so a group tag in search results
 * ("Legs") reads as a person would say it.
 */
export const MOVEMENT_PICKER_GROUP_LABELS: Record<MovementPickerGroup, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
  wrestling: 'Wrestling',
};

/** How many of an athlete's recent movements the picker offers before the browse list. */
export const RECENT_MOVEMENTS_LIMIT = 5;

type MovementPickerEntry = {
  readonly group: MovementPickerGroup;
  /** Short names people type. Matched EXACTLY by key, so `rdl` hits and `rd` does not. */
  readonly aliases?: readonly string[];
};

/**
 * Every seeded movement's group, keyed by slug, plus the aliases.
 *
 * The judgement calls chunk 0 confirms, named here so they are reviewable rather than buried:
 * **Farmer Carry** and **Med-Ball Slam** are Core (the carry is an anti-flexion brace; the slam is
 * trunk-driven), and **Sled Push**, **KB Swings**, **Box Jump**, **Broad Jump** and **Calf Raises**
 * are Legs. Each is a movement whose `pattern` (`carry`, `hinge`, `jump`, `isolation`) says nothing
 * about which drawer a person would look in.
 *
 * The six aliases are the prototype's, and each is a thing typed on a phone between sets:
 * `RDL`, `BSS`, `OHP`, `DB bench`, `KB`, `hip thrust`.
 */
export const MOVEMENT_PICKER_ENTRIES: Readonly<Record<string, MovementPickerEntry>> = {
  // ── Push ──────────────────────────────────────────────────────────────────────
  bb_bench: { group: 'push' },
  dumbbell_bench_press: { group: 'push', aliases: ['DB bench'] },
  overhead_shoulder_press: { group: 'push', aliases: ['OHP'] },
  dips: { group: 'push' },
  lateral_raises: { group: 'push' },
  tricep_extensions: { group: 'push' },
  'push-ups': { group: 'push' },
  // ── Pull ──────────────────────────────────────────────────────────────────────
  'pull-up': { group: 'pull' },
  'bent-over_rows': { group: 'pull' },
  rear_delt_raises: { group: 'pull' },
  hammer_curls: { group: 'pull' },
  barbell_curls: { group: 'pull' },
  '1-arm_db_row': { group: 'pull' },
  inverted_rows: { group: 'pull' },
  // ── Legs ──────────────────────────────────────────────────────────────────────
  box_jump: { group: 'legs' },
  front_squat: { group: 'legs' },
  back_squat: { group: 'legs' },
  nordic_ham_curl: { group: 'legs' },
  romanian_deadlift: { group: 'legs', aliases: ['RDL'] },
  walking_lunge: { group: 'legs' },
  bulgarian_split_squat: { group: 'legs', aliases: ['BSS'] },
  calf_raises: { group: 'legs' },
  sled_push: { group: 'legs' },
  'trap-bar_deadlift': { group: 'legs' },
  broad_jump: { group: 'legs' },
  barbell_hip_thrust: { group: 'legs', aliases: ['hip thrust'] },
  kb_swings: { group: 'legs', aliases: ['KB'] },
  'single-leg_hip_thrusts': { group: 'legs' },
  // ── Core ──────────────────────────────────────────────────────────────────────
  pallof_press: { group: 'core' },
  ab_rollout: { group: 'core' },
  farmer_carry: { group: 'core' },
  'hollow-body_hold': { group: 'core' },
  leg_raises: { group: 'core' },
  'v-sit_crunches': { group: 'core' },
  'med-ball_slam': { group: 'core' },
};

/**
 * Every alias in the map, flattened to `{ alias, slug }` — so a consumer does not re-walk the map and
 * two consumers cannot disagree about which movement an alias reaches.
 */
export const MOVEMENT_PICKER_ALIASES: readonly { readonly alias: string; readonly slug: string }[] =
  Object.entries(MOVEMENT_PICKER_ENTRIES).flatMap(([slug, entry]) =>
    (entry.aliases ?? []).map((alias) => ({ alias, slug })),
  );

/** The seeded slugs the picker browses, in `MOVEMENT_SEED_ROWS` order within each group. */
export function movementPickerSlugsByGroup(group: MovementPickerGroup): readonly string[] {
  return MOVEMENT_SEED_ROWS.filter((row) => MOVEMENT_PICKER_ENTRIES[row.slug]?.group === group).map(
    (row) => row.slug,
  );
}
