import { z } from 'zod';

import { keyBySelf } from '../enums';

/**
 * CAT-3's vocabularies ([spec](../../../../docs/specs/cat-3-movement-library.md), chunk C0a, V1):
 * the words a movement in the library is described with. One list each, three consumers: the
 * entry schema (`./entry`), the reference tables and CHECKs lane A's migration mirrors, and the
 * picker's filters.
 *
 * 🔴 **`EQUIPMENT`, `MUSCLES` and `MODALITIES` are stored data** since lane A's tables (chunk A1,
 * migration 0032: `equipment`, `muscles`, `movements.modality`), each pinned to its array by
 * `db:verify`. What a change needs:
 *
 * - **Adding** an `EQUIPMENT` or `MUSCLES` member: the member here, and the seed, which writes
 *   the two reference tables with `ON CONFLICT DO NOTHING`. No migration.
 * - **Renaming or removing** one: a migration, since rows may already name the code.
 * - **`MODALITIES`**: any change is a migration, because the list is a CHECK on
 *   `movements.modality`, not a table.
 */

/**
 * What a movement needs beyond a floor and open space (spec rule 8). A wall, a step, a bench, a bar
 * and a partner all count: **"no equipment" means the set is empty**, and that is computed
 * (`requiresNoEquipment`), never stored.
 *
 * One code per thing a person owns or has access to. `machine` is any selectorised machine that has
 * no code of its own; `anchor` is a fixed point for a band or the feet; `ball` is any small ball.
 * A sled's tow strap comes with `sled`; the two ropes are two things to own, so there is no plain
 * `rope`.
 *
 * **`any_weight` is a load of the athlete's own choosing, simply held or set in place**: a plate
 * on the back for a weighted plank, whatever is to hand for a weighted sit-up _(maintainer,
 * 2026-11-17: "Just weight, they can choose how to add the weight")_. **Where the way the load is
 * carried is part of the movement, the entry names that tool:** a belt for a load hung from the
 * hips (a weighted pull-up or dip), a vest for one worn on the body (a weighted push-up). Where
 * neither reading is plainly right, the batch's review asks the maintainer.
 *
 * ⚠️ **A required set cannot say "this or that".** A goblet squat names one of dumbbell and
 * kettlebell, and a filter for the other does not show it (spec rule 8, a known limit).
 */
export const EQUIPMENT = [
  'barbell',
  'ez_bar',
  'trap_bar',
  'plates',
  'dumbbell',
  'kettlebell',
  'medicine_ball',
  'sandbag',
  'weight_vest',
  'ankle_weights',
  'wrist_weights',
  'weight_belt',
  'any_weight',
  'bench',
  'rack',
  'pull_up_bar',
  'dip_bars',
  'rings',
  'parallettes',
  'suspension_trainer',
  'band',
  'cable_machine',
  'machine',
  'landmine',
  'box',
  'step',
  'wall',
  'sled',
  'battle_rope',
  'climbing_rope',
  'heavy_bag',
  'mat',
  'foam_roller',
  'exercise_ball',
  'ab_wheel',
  'jump_rope',
  'air_bike',
  'rowing_machine',
  'ski_ergometer',
  'treadmill',
  'stationary_bike',
  'climbing_machine',
  'back_extension_bench',
  'glute_ham_developer',
  'towel',
  'anchor',
  'hill_or_stairs',
  'ball',
  'cones',
  'hurdles',
  'agility_ladder',
  'pool',
  'partner',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export const equipmentSchema = z.enum(EQUIPMENT);
/** Branch on a NAMED member (`EQUIPMENT_CODE.barbell`), never a bare string. */
export const EQUIPMENT_CODE = keyBySelf(EQUIPMENT);

/** What each item is called on screen. The prototype (chunk P0) settles the final words. */
export const EQUIPMENT_LABELS = {
  barbell: 'Barbell',
  ez_bar: 'EZ bar',
  trap_bar: 'Trap bar',
  plates: 'Plates',
  dumbbell: 'Dumbbell',
  kettlebell: 'Kettlebell',
  medicine_ball: 'Medicine ball',
  sandbag: 'Sandbag',
  weight_vest: 'Weight vest',
  ankle_weights: 'Ankle weights',
  wrist_weights: 'Wrist weights',
  weight_belt: 'Weight belt',
  any_weight: 'Any weight',
  bench: 'Bench',
  rack: 'Rack',
  pull_up_bar: 'Pull-up bar',
  dip_bars: 'Dip bars',
  rings: 'Rings',
  parallettes: 'Parallettes',
  suspension_trainer: 'Suspension trainer',
  band: 'Band',
  cable_machine: 'Cable machine',
  machine: 'Machine',
  landmine: 'Landmine',
  box: 'Box',
  step: 'Step',
  wall: 'Wall',
  sled: 'Sled',
  battle_rope: 'Battle rope',
  climbing_rope: 'Climbing rope',
  heavy_bag: 'Heavy bag',
  mat: 'Mat',
  foam_roller: 'Foam roller',
  exercise_ball: 'Exercise ball',
  ab_wheel: 'Ab wheel',
  jump_rope: 'Jump rope',
  air_bike: 'Air bike',
  rowing_machine: 'Rowing machine',
  ski_ergometer: 'Ski ergometer',
  treadmill: 'Treadmill',
  stationary_bike: 'Stationary bike',
  climbing_machine: 'Climbing machine',
  back_extension_bench: 'Back-extension bench',
  glute_ham_developer: 'Glute-ham developer',
  towel: 'Towel',
  anchor: 'Anchor point',
  hill_or_stairs: 'Hill or stairs',
  ball: 'Ball',
  cones: 'Cones',
  hurdles: 'Hurdles',
  agility_ladder: 'Agility ladder',
  pool: 'Pool',
  partner: 'Partner',
} as const satisfies Record<Equipment, string>;

/**
 * Muscles, as anatomy only (spec rule 9). Conditioning, mobility and skill are not muscles: they
 * are `MODALITIES`. A movement has one optional primary and any number of secondaries.
 */
export const MUSCLES = [
  'neck',
  'traps',
  'shoulders',
  'chest',
  'upper_back',
  'lats',
  'lower_back',
  'biceps',
  'triceps',
  'forearms',
  'abdominals',
  'obliques',
  'hip_flexors',
  'glutes',
  'adductors',
  'abductors',
  'quadriceps',
  'hamstrings',
  'calves',
  'shins',
] as const;
export type Muscle = (typeof MUSCLES)[number];
export const muscleSchema = z.enum(MUSCLES);
export const MUSCLE = keyBySelf(MUSCLES);

/**
 * What each muscle is called on screen: plain words, since a child may be the one choosing
 * (spec, chunk P0). The anatomical name stays the code. "Obliques" is the maintainer's choice over
 * "Side abs" (2026-11-17, from the first batch review).
 */
export const MUSCLE_LABELS = {
  neck: 'Neck',
  traps: 'Upper traps',
  shoulders: 'Shoulders',
  chest: 'Chest',
  upper_back: 'Upper back',
  lats: 'Lats',
  lower_back: 'Lower back',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms and grip',
  abdominals: 'Abs',
  obliques: 'Obliques',
  hip_flexors: 'Hip flexors',
  glutes: 'Glutes',
  adductors: 'Inner thigh',
  abductors: 'Outer hip',
  quadriceps: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
  shins: 'Shins',
} as const satisfies Record<Muscle, string>;

/**
 * What kind of training a movement is (spec rule 9). `pattern` (`MOVEMENT_PATTERNS`) keeps its
 * eleven lift patterns and is required only for `strength`.
 *
 * 🔴 **`modality` is also what marks a row as a catalog row in the database** (spec rule 2): only
 * the catalog seed writes it, so a global `movements` row with a modality is a catalog row and any
 * other row has none.
 */
export const MODALITIES = ['strength', 'conditioning', 'mobility', 'skill'] as const;
export type Modality = (typeof MODALITIES)[number];
export const modalitySchema = z.enum(MODALITIES);
export const MODALITY = keyBySelf(MODALITIES);

export const MODALITY_LABELS = {
  strength: 'Strength',
  conditioning: 'Conditioning',
  mobility: 'Mobility',
  skill: 'Skill and drills',
} as const satisfies Record<Modality, string>;

/**
 * A label on the few movements the maintainer marks (decision K14). It describes the movement and
 * the adult, never the athlete: it is shown the same for everyone and never hides, blocks or
 * reorders an option (spec P13). An entry with no value has no label; "none" is not a member, so
 * hundreds of unmarked entries make no claim.
 */
export const SUPERVISION = ['coach'] as const;
export type Supervision = (typeof SUPERVISION)[number];
export const supervisionSchema = z.enum(SUPERVISION);
export const SUPERVISION_KIND = keyBySelf(SUPERVISION);

/** The words shown on the row. The prototype (chunk P0) settles them. */
export const SUPERVISION_LABELS = {
  coach: 'Learn with a coach present',
} as const satisfies Record<Supervision, string>;

/**
 * What kind of media an entry may point at (decision K18). Nothing points at any yet.
 */
export const MEDIA_KINDS = ['video', 'animation'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const mediaKindSchema = z.enum(MEDIA_KINDS);
export const MEDIA_KIND = keyBySelf(MEDIA_KINDS);

/**
 * Short forms people type for a piece of equipment, expanded **inside the search only** (spec P3):
 * "db row" finds Dumbbell row. Never an entry's alias (V3), because a short form names equipment,
 * not one movement, and never applied in `movementNameKey`, so `existingItem` and the search agree
 * on what already exists.
 */
export const QUERY_SHORT_FORMS = {
  db: 'dumbbell',
  kb: 'kettlebell',
  bb: 'barbell',
  ez: 'ez bar',
  trx: 'suspension trainer',
} as const satisfies Record<string, string>;
export type QueryShortForm = keyof typeof QUERY_SHORT_FORMS;
