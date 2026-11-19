import {
  BROWSE_FLAT_KINDS,
  BROWSE_OPEN_AT_MOST,
  browseTree,
  byFoldedName,
  filterMovementOptions,
  movementFamilyOf,
  movementFiltersOn,
  type BrowseKind,
  type Modality,
  type MovementFamily,
  type MovementFilters,
} from '@mat-plan/shared';

import {
  hasLibraryData,
  matchable,
  type LibraryOption,
  type MovementOptionDTO,
} from '@/lib/movements/movement-option';

/**
 * The picker's browse list as data (CAT-3 B3, spec P12 and K24): what "Your custom items" and "All
 * movements" hold, and which of their groups are open. Pure and DOM-free, so every rule here is
 * unit-tested without rendering (`browse-view.test.ts`); the picker only draws it.
 */

/**
 * "Your custom items" starts open while it holds this many or fewer (spec K25; maintainer,
 * 2026-11-18): above it, the section is one folded line, so "All movements" is on the first screen.
 */
export const CUSTOM_OPEN_AT_MOST = 5;

/**
 * The key of one group whose open state is kept. A kind's key is the kind; a family's is
 * `${kind}/${family}`, **kind-qualified** because `core`, `back`, `hips_legs` and `whole_body` occur
 * under more than one kind.
 */
export type BrowseKey = string;

export const BROWSE_KEY = {
  custom: 'custom',
  /** "All movements", and "Movements that fit your filters" under a filter: one group, one key. */
  all: 'all',
  /** "Today's program", which a caller passes; never under a filter. */
  program: 'program',
  /** ⏳ K24's section. TODO(CAT-3 chunk R): goes with `BuiltInWithoutLibrary`. */
  notSorted: 'not-sorted',
} as const;

export const kindKey = (kind: Modality): BrowseKey => kind;
export const familyKey = (kind: Modality, family: MovementFamily): BrowseKey => `${kind}/${family}`;
/** The DOM id part of a family: `${headingId}-${kind}-${family}`, unique across kinds. */
export const familyIdPart = (kind: Modality, family: MovementFamily) => `${kind}-${family}`;

export type BrowseView = {
  /** The household's own items, in the order given. */
  readonly custom: readonly MovementOptionDTO[];
  /** The library rows that fit, as `browseTree` arranges them. */
  readonly tree: readonly BrowseKind<LibraryOption>[];
  /**
   * ⏳ The old built-ins with no library data (K24), by `byFoldedName`, the comparator the tree
   * uses. Empty under a filter: no filter passes such a row. TODO(CAT-3 chunk R): goes with
   * `BuiltInWithoutLibrary`.
   */
  readonly bare: readonly MovementOptionDTO[];
  /** "All movements · N": the tree's rows plus `bare`, which is `movementFilterCounts(…).total`. */
  readonly total: number;
  /**
   * Every kind and family, and K24's section, opens itself (spec K26; for K24 the maintainer,
   * 2026-11-19): the tree holds `BROWSE_OPEN_AT_MOST` rows or fewer, filter or not. Counted on the
   * tree alone, so the custom items and K24's rows never keep a short tree shut.
   */
  readonly auto: boolean;
  /**
   * A filter is on: the tree is "Movements that fit your filters" and "Your custom items" starts
   * folded, however few they are (P9, K25).
   */
  readonly filtered: boolean;
};

/** What a group's default reads: the view's, and whether every one of Today's program is on a card. */
export type BrowseDefaults = Pick<BrowseView, 'auto' | 'custom' | 'filtered'> & {
  /** Today's program starts folded once every prescribed movement is on a card. */
  readonly programAllOnForm?: boolean;
};

/**
 * Partitions the options ONCE: the filter's `fitting` and `custom`, then `hasLibraryData` (the one
 * test for "has a kind") splits `fitting` into the tree's rows and K24's.
 */
export function browseView(
  options: readonly MovementOptionDTO[],
  filters: MovementFilters,
): BrowseView {
  const { fitting, custom } = filterMovementOptions(matchable(options), filters);
  const library: LibraryOption[] = [];
  const bare: MovementOptionDTO[] = [];
  for (const { option } of fitting) {
    if (hasLibraryData(option)) library.push(option);
    else bare.push(option);
  }
  return {
    custom: custom.map(({ option }) => option),
    tree: browseTree(library),
    bare: bare.sort(byFoldedName),
    total: library.length + bare.length,
    auto: library.length <= BROWSE_OPEN_AT_MOST,
    filtered: movementFiltersOn(filters) > 0,
  };
}

/**
 * The groups that hold an option, outermost first: what must be open for its row to be on screen.
 * A household item sits in "Your custom items"; a library row in All movements, its kind and (when
 * its kind has families) its family; a built-in with no library data in K24's section. A row in
 * Today's program (`programIds`) is in that section too.
 */
export function browseAncestors(
  option: MovementOptionDTO,
  programIds: ReadonlySet<string> = new Set(),
): readonly BrowseKey[] {
  const program = programIds.has(option.publicId) ? [BROWSE_KEY.program] : [];
  if (option.owner === 'household') return [BROWSE_KEY.custom, ...program];
  if (!hasLibraryData(option)) return [BROWSE_KEY.all, BROWSE_KEY.notSorted, ...program];
  const kind = option.modality;
  if (BROWSE_FLAT_KINDS.includes(kind)) return [BROWSE_KEY.all, kindKey(kind), ...program];
  return [BROWSE_KEY.all, kindKey(kind), familyKey(kind, movementFamilyOf(option)), ...program];
}

/**
 * Which groups are open. One model, kept by the picker for the sheet's life and reset when it
 * opens.
 *
 * - `userChoice` is written ONLY by a tap, and beats everything derived.
 * - `seeded` is a latch: the ancestors of every row ticked or current, and of every row that
 *   becomes so. It never shrinks while the sheet is open, so unticking never closes a group.
 */
export type BrowseOpenState = {
  readonly userChoice: ReadonlyMap<BrowseKey, boolean>;
  readonly seeded: ReadonlySet<BrowseKey>;
};

export const CLOSED_BROWSE: BrowseOpenState = { userChoice: new Map(), seeded: new Set() };

/**
 * Whether a group is open: the person's tap, else seeded, else its default. All movements (or what
 * fits the filters) starts open; "Your custom items" while it holds `CUSTOM_OPEN_AT_MOST` or fewer
 * and no filter is on (P9); Today's program while any of it is not yet on a card; a kind, a family
 * and K24's "Not sorted yet" when the tree opens itself (`auto`). Never the custom items by `auto`:
 * twenty-four of them would bury a short tree.
 */
export function isBrowseOpen(
  key: BrowseKey,
  state: BrowseOpenState,
  view: BrowseDefaults,
): boolean {
  const chosen = state.userChoice.get(key);
  if (chosen !== undefined) return chosen;
  if (state.seeded.has(key)) return true;
  switch (key) {
    case BROWSE_KEY.all:
      return true;
    case BROWSE_KEY.custom:
      return !view.filtered && view.custom.length <= CUSTOM_OPEN_AT_MOST;
    case BROWSE_KEY.program:
      return !view.programAllOnForm;
    default:
      // A kind, a family, and ⏳ K24's "Not sorted yet": folded on a long tree (K24), open with a
      // short one _(maintainer, 2026-11-19: "Open it while the tree is small")_, since before the
      // library is seeded most rows live there.
      return view.auto;
  }
}

/** A tap: the group flips from what it showed, and the person's choice is kept. */
export function toggleBrowse(
  state: BrowseOpenState,
  key: BrowseKey,
  wasOpen: boolean,
): BrowseOpenState {
  return { ...state, userChoice: new Map(state.userChoice).set(key, !wasOpen) };
}

/**
 * A new selection (a tick, the caller's select or create, the current row) opens every group above
 * it, **even one the person closed earlier**: its ancestors join `seeded` and their taps are
 * forgotten, so the row the caller is about to focus is on screen. A later tap closes it again.
 */
export function seedBrowse(
  state: BrowseOpenState,
  options: readonly MovementOptionDTO[],
  programIds?: ReadonlySet<string>,
): BrowseOpenState {
  const keys = options.flatMap((option) => browseAncestors(option, programIds));
  if (keys.length === 0) return state;
  const userChoice = new Map(state.userChoice);
  for (const key of keys) userChoice.delete(key);
  return { userChoice, seeded: new Set([...state.seeded, ...keys]) };
}

/**
 * On a filter change, the groups the person CLOSED are forgotten, so one closed under one filter
 * can open itself under the next. The ones they opened stay open.
 */
export function forgetClosed(state: BrowseOpenState): BrowseOpenState {
  return {
    ...state,
    userChoice: new Map([...state.userChoice].filter(([, open]) => open)),
  };
}
