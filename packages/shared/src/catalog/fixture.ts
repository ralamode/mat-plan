import { fixtureIds } from '../program/fixtures/ids';
import type { CatalogMovement } from './entry';
import { catalogOptionOf, type CatalogOption } from './option';

/**
 * A small, generic library for tests, the preview route and test databases
 * ([spec](../../../../docs/specs/cat-3-movement-library.md), chunk C0a).
 *
 * 🔴 **This is what a fixtures database holds in place of the real catalog** (spec E4): a test, CI
 * or preview database never holds a reviewed batch, so a batch PR cannot change what another lane's
 * proof sees. It is never seeded in production.
 *
 * It covers, on purpose: every tracking type and every modality; every lift pattern; an empty
 * equipment set (with and without a primary muscle) and a two-item set; an entry with no primary
 * muscle; aliases; a supervision label; instructions of one line and of several, and entries with
 * none; a movement logged two ways as two entries (the rowing machine); and the shapes the search's vectors need (a compact "trapbar" and "medball", a short
 * alias, a "db" short form). `catalog.test.ts` holds each of those.
 *
 * Its slugs and name keys are disjoint from the legacy `MOVEMENT_SEED_ROWS`, which a fixtures
 * database also holds until that list is retired (spec V3, F1), **and so are its aliases from the
 * legacy picker's** (`MOVEMENT_PICKER_ALIASES`): a query must never alias-hit one movement in each
 * list. That is why the short alias here is `SLRDL` and not the `RDL` the spec's C0a names: the
 * legacy list still answers to `RDL`. The search's vectors are ported with this alias.
 */
const lift: Pick<
  CatalogMovement,
  'modality' | 'unitDefault' | 'isBodyweight' | 'aliases' | 'secondaryMuscles'
> = {
  modality: 'strength',
  unitDefault: null,
  isBodyweight: false,
  aliases: [],
  secondaryMuscles: [],
};
const other: Pick<CatalogMovement, 'pattern' | 'unitDefault' | 'isBodyweight' | 'aliases'> = {
  pattern: null,
  unitDefault: null,
  isBodyweight: false,
  aliases: [],
};

export const CATALOG_FIXTURE: readonly CatalogMovement[] = [
  {
    ...lift,
    slug: 'goblet_squat',
    name: 'Goblet squat',
    pattern: 'squat',
    trackingType: 'weight_reps',
    unitDefault: 'lb',
    equipment: ['dumbbell'],
    primaryMuscle: 'quadriceps',
    secondaryMuscles: ['glutes'],
    instructions: [
      'Hold one dumbbell upright against your chest with both hands.',
      'Stand with your feet a little wider than your hips.',
      'Sit down between your heels with your chest up and your elbows inside your knees.',
      'Stand back up by pushing the floor away.',
    ].join('\n'),
  },
  {
    ...lift,
    slug: 'trap_bar_carry',
    name: 'Trap bar carry',
    pattern: 'carry',
    trackingType: 'distance',
    equipment: ['trap_bar', 'plates'],
    primaryMuscle: 'forearms',
    secondaryMuscles: ['traps'],
  },
  {
    ...lift,
    slug: 'single-leg_romanian_deadlift',
    name: 'Single-leg Romanian deadlift',
    aliases: ['SLRDL'],
    pattern: 'hinge',
    trackingType: 'weight_reps',
    unitDefault: 'lb',
    equipment: ['dumbbell'],
    primaryMuscle: 'hamstrings',
    secondaryMuscles: ['glutes'],
  },
  {
    ...lift,
    slug: 'incline_dumbbell_press',
    name: 'Incline dumbbell press',
    pattern: 'horizontal_push',
    trackingType: 'weight_reps',
    unitDefault: 'lb',
    equipment: ['dumbbell', 'bench'],
    primaryMuscle: 'chest',
    secondaryMuscles: ['shoulders', 'triceps'],
  },
  {
    ...lift,
    slug: 'incline_push-up',
    name: 'Incline push-up',
    pattern: 'horizontal_push',
    trackingType: 'reps',
    isBodyweight: true,
    equipment: ['bench'],
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps'],
  },
  {
    ...lift,
    slug: 'chin-up',
    name: 'Chin-up',
    pattern: 'vertical_pull',
    trackingType: 'reps',
    isBodyweight: true,
    equipment: ['pull_up_bar'],
    primaryMuscle: 'lats',
    secondaryMuscles: ['biceps'],
  },
  {
    ...lift,
    slug: 'weighted_chin-up',
    name: 'Weighted chin-up',
    pattern: 'vertical_pull',
    trackingType: 'weight_reps',
    unitDefault: 'lb',
    isBodyweight: true,
    equipment: ['pull_up_bar', 'weight_belt'],
    primaryMuscle: 'lats',
    secondaryMuscles: ['biceps'],
  },
  {
    ...lift,
    slug: 'overhead_press',
    name: 'Overhead press',
    aliases: ['Strict press'],
    pattern: 'vertical_push',
    trackingType: 'weight_reps',
    unitDefault: 'lb',
    equipment: ['barbell'],
    primaryMuscle: 'shoulders',
    secondaryMuscles: ['triceps'],
  },
  {
    ...lift,
    slug: 'medicine_ball_chest_pass',
    name: 'Medicine ball chest pass',
    aliases: ['Med-ball chest pass'],
    pattern: 'horizontal_push',
    trackingType: 'reps',
    equipment: ['medicine_ball', 'wall'],
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps'],
  },
  {
    ...lift,
    slug: 'suitcase_carry',
    name: 'Suitcase carry',
    pattern: 'carry',
    trackingType: 'distance',
    equipment: ['dumbbell'],
    primaryMuscle: 'obliques',
    secondaryMuscles: ['forearms'],
  },
  {
    ...lift,
    slug: 'side_plank',
    name: 'Side plank',
    pattern: 'core',
    trackingType: 'time_sets',
    isBodyweight: true,
    equipment: [],
    primaryMuscle: 'obliques',
    secondaryMuscles: ['abdominals'],
    instructions: [
      'Lie on one side with your elbow under your shoulder and your feet stacked.',
      'Lift your hips until your body is one straight line from head to heels.',
      'Hold and keep breathing. Then swap sides.',
    ].join('\n'),
  },
  {
    ...lift,
    slug: 'dead_hang',
    name: 'Dead hang',
    pattern: 'vertical_pull',
    trackingType: 'time_sets',
    isBodyweight: true,
    equipment: ['pull_up_bar'],
    primaryMuscle: 'forearms',
    secondaryMuscles: ['lats'],
  },
  {
    ...lift,
    slug: 'hang_power_clean',
    name: 'Hang power clean',
    pattern: 'hinge',
    trackingType: 'weight_reps',
    unitDefault: 'lb',
    equipment: ['barbell'],
    primaryMuscle: 'glutes',
    secondaryMuscles: ['hamstrings', 'traps'],
    supervision: 'coach',
  },
  {
    ...lift,
    slug: 'reverse_lunge',
    name: 'Reverse lunge',
    pattern: 'lunge',
    trackingType: 'reps',
    isBodyweight: true,
    equipment: [],
    primaryMuscle: 'quadriceps',
    secondaryMuscles: ['glutes'],
  },
  {
    ...lift,
    slug: 'squat_jump',
    name: 'Squat jump',
    pattern: 'jump',
    trackingType: 'reps',
    isBodyweight: true,
    equipment: [],
    primaryMuscle: 'quadriceps',
    secondaryMuscles: ['calves'],
  },
  {
    ...lift,
    slug: 'biceps_curl',
    name: 'Biceps curl',
    pattern: 'isolation',
    trackingType: 'weight_reps',
    unitDefault: 'lb',
    equipment: ['dumbbell'],
    primaryMuscle: 'biceps',
    secondaryMuscles: ['forearms'],
  },
  {
    ...lift,
    slug: 'dumbbell_row',
    name: 'Dumbbell row',
    pattern: 'horizontal_pull',
    trackingType: 'weight_reps',
    unitDefault: 'lb',
    equipment: ['dumbbell', 'bench'],
    primaryMuscle: 'upper_back',
    secondaryMuscles: ['lats', 'biceps'],
  },
  {
    ...other,
    slug: 'rowing_machine',
    name: 'Rowing machine',
    modality: 'conditioning',
    trackingType: 'duration',
    equipment: ['rowing_machine'],
    primaryMuscle: null,
    secondaryMuscles: [],
  },
  {
    ...other,
    slug: 'rowing_machine_intervals',
    name: 'Rowing machine intervals',
    modality: 'conditioning',
    trackingType: 'time_sets',
    equipment: ['rowing_machine'],
    primaryMuscle: null,
    secondaryMuscles: [],
  },
  {
    ...other,
    slug: 'easy_run',
    name: 'Easy run',
    modality: 'conditioning',
    trackingType: 'duration',
    isBodyweight: true,
    equipment: [],
    primaryMuscle: null,
    secondaryMuscles: [],
    instructions: 'Run at a pace where you could still talk in full sentences.',
  },
  {
    ...other,
    slug: 'jump_rope',
    name: 'Jump rope',
    modality: 'conditioning',
    trackingType: 'count',
    isBodyweight: true,
    equipment: ['jump_rope'],
    primaryMuscle: 'calves',
    secondaryMuscles: [],
  },
  {
    ...other,
    slug: 'couch_stretch',
    name: 'Couch stretch',
    modality: 'mobility',
    trackingType: 'time_sets',
    isBodyweight: true,
    equipment: ['bench'],
    primaryMuscle: 'hip_flexors',
    secondaryMuscles: ['quadriceps'],
  },
  {
    ...other,
    slug: 'foam_rolling',
    name: 'Foam rolling',
    modality: 'mobility',
    trackingType: 'check',
    equipment: ['foam_roller'],
    primaryMuscle: null,
    secondaryMuscles: [],
  },
  {
    ...other,
    slug: 'stance_motion',
    name: 'Stance motion',
    modality: 'skill',
    trackingType: 'time_sets',
    isBodyweight: true,
    equipment: [],
    primaryMuscle: null,
    secondaryMuscles: [],
  },
];

/**
 * A stable id for each fixture movement, by slug, for the preview route and for comparing a read
 * with the fixture. Beside the entry and never in it: a catalog entry has no id (spec rule 5).
 */
export const CATALOG_FIXTURE_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  CATALOG_FIXTURE.map((entry, index) => [entry.slug, fixtureIds.catalogMovement(index + 1)]),
);

/**
 * The test library as the picker's options (chunk C0b-2): `catalogOptionOf` over each entry, with
 * its fixture id. What the preview's picker lists beside the household's fixture items, and what
 * the option read is compared with (spec P11).
 */
export const CATALOG_FIXTURE_OPTIONS: readonly CatalogOption[] = CATALOG_FIXTURE.map(
  (entry, index) => catalogOptionOf(entry, fixtureIds.catalogMovement(index + 1)),
);
