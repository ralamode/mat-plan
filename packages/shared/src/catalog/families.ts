import { MOVEMENT_PATTERNS, type MovementPattern } from '../movements';
import { foldMovementQuery } from '../movement-search';
import type { CatalogOptionTaxonomy } from './option';
import { MODALITY, type Modality, type Muscle } from './vocabulary';

/**
 * How "All movements" opens with no query (CAT-3 spec P12; the maintainer's choice of 2026-11-17,
 * "Kind, then family"): the kind of training, then a family. For strength the family is the lift
 * pattern under a plain label; for every other kind it is a body area, from the primary muscle.
 */

/** The kinds in the order the picker lists them. Not `MODALITIES`' order, which is the schema's. */
export const BROWSE_KINDS = [
  MODALITY.strength,
  MODALITY.mobility,
  MODALITY.conditioning,
  MODALITY.skill,
] as const satisfies readonly Modality[];

export const BODY_AREAS = [
  'neck_shoulders',
  'chest_arms',
  'back',
  'core',
  'hips_legs',
  'whole_body',
] as const;
export type BodyArea = (typeof BODY_AREAS)[number];

/** A family is a lift pattern (strength) or a body area (the other kinds). The codes do not overlap. */
export const MOVEMENT_FAMILIES = [
  ...MOVEMENT_PATTERNS.filter((pattern) => pattern !== 'core'),
  ...BODY_AREAS,
] as readonly MovementFamily[];
export type MovementFamily = Exclude<MovementPattern, 'core'> | BodyArea;

/**
 * The words on a family's heading. Plain ones: nobody browsing a list of exercises looks for
 * "vertical pull".
 *
 * `core` is one family whether it is the strength pattern or the body area, so a strength
 * movement and a mobility one both sit under "Core", each under its own kind.
 */
export const MOVEMENT_FAMILY_LABELS = {
  vertical_pull: 'Pull-ups and pulldowns',
  horizontal_pull: 'Rows',
  horizontal_push: 'Push-ups and presses',
  vertical_push: 'Overhead presses and dips',
  squat: 'Squats',
  hinge: 'Hinges and deadlifts',
  lunge: 'Lunges',
  jump: 'Jumps',
  carry: 'Carries and sleds',
  isolation: 'Arms, calves and single muscles',
  neck_shoulders: 'Neck and shoulders',
  chest_arms: 'Chest and arms',
  back: 'Back',
  core: 'Core',
  hips_legs: 'Hips and legs',
  whole_body: 'Whole body',
} as const satisfies Record<MovementFamily, string>;

/** The body area each muscle belongs to. Exhaustive: a new muscle code does not compile without one. */
export const MUSCLE_BODY_AREA = {
  neck: 'neck_shoulders',
  traps: 'neck_shoulders',
  shoulders: 'neck_shoulders',
  chest: 'chest_arms',
  biceps: 'chest_arms',
  triceps: 'chest_arms',
  forearms: 'chest_arms',
  upper_back: 'back',
  lats: 'back',
  lower_back: 'back',
  abdominals: 'core',
  obliques: 'core',
  hip_flexors: 'hips_legs',
  glutes: 'hips_legs',
  adductors: 'hips_legs',
  abductors: 'hips_legs',
  quadriceps: 'hips_legs',
  hamstrings: 'hips_legs',
  calves: 'hips_legs',
  shins: 'hips_legs',
} as const satisfies Record<Muscle, BodyArea>;

type Grouped = Pick<CatalogOptionTaxonomy, 'modality' | 'pattern' | 'primaryMuscle'>;

/**
 * The family a movement is listed under.
 *
 * Strength: its lift pattern (`core` is the Core family). Any other kind: the body area of its
 * primary muscle, or "Whole body" when it has none (a run, a sled push for time). A strength
 * movement always has a pattern (the entry schema refuses one without), so the fall-through to
 * the body area is for a row the type allows and the library never holds. (The accepted prototype
 * filed such a row under "Other"; a body area is a heading a person can use, and no library row
 * reaches either.)
 */
export function movementFamilyOf(option: Grouped): MovementFamily {
  if (option.modality === MODALITY.strength && option.pattern !== null) return option.pattern;
  return option.primaryMuscle === null ? 'whole_body' : MUSCLE_BODY_AREA[option.primaryMuscle];
}

/** When a filter leaves this many movements or fewer, every kind and family is shown open (P12). */
export const BROWSE_OPEN_AT_MOST = 20;

export type BrowseFamily<T> = {
  readonly family: MovementFamily;
  readonly label: string;
  readonly options: readonly T[];
};
export type BrowseKind<T> = {
  readonly kind: Modality;
  readonly count: number;
  readonly families: readonly BrowseFamily<T>[];
};

/**
 * The order a list of movements is read in: by name, folded as the search folds it (case, accents
 * and punctuation aside), and by the name as written where two fold alike, so the order never
 * depends on the order given. `browseTree` sorts each family with it. Exported so a list beside
 * the tree sorts the same way: the picker's interim section for the old built-ins with no library
 * entry (spec K24) uses it, and a second comparator there could drift from this one.
 */
export function byFoldedName(a: { readonly name: string }, b: { readonly name: string }): number {
  const [x, y] = [foldMovementQuery(a.name), foldMovementQuery(b.name)];
  return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * "All movements" as a tree (P12): the kinds in `BROWSE_KINDS`' order, each with its families,
 * the biggest first (ties by label), each with its movements by name. **A kind or a family with
 * nothing in it is left out**, so a filtered list shows no empty heading. A count is
 * `options.length`; the whole tree's is the sum of its kinds'.
 *
 * Pure and deterministic: the same options in any order give the same tree, and an option given
 * twice is listed once. The names are compared folded, as the search compares them, never with
 * the host's locale. (The accepted prototype left two families of one size in the order they
 * came; here the tie goes by label, so the tree does not depend on the order of the read.)
 */
export function browseTree<T extends Grouped & { readonly name: string }>(
  options: readonly T[],
): readonly BrowseKind<T>[] {
  const unique = [...new Set(options)];
  return BROWSE_KINDS.flatMap((kind) => {
    const ofKind = unique.filter((option) => option.modality === kind);
    if (ofKind.length === 0) return [];
    const grouped = new Map<MovementFamily, T[]>();
    for (const option of ofKind) {
      const family = movementFamilyOf(option);
      grouped.set(family, [...(grouped.get(family) ?? []), option]);
    }
    const families = [...grouped].map(([family, list]) => ({
      family,
      label: MOVEMENT_FAMILY_LABELS[family],
      options: [...list].sort(byFoldedName),
    }));
    families.sort(
      (a, b) =>
        b.options.length - a.options.length || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
    );
    return [{ kind, count: ofKind.length, families }];
  });
}
