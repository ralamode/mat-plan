import {
  BROWSE_OPEN_AT_MOST,
  MODALITY,
  MUSCLE,
  movementFilterCounts,
  NO_MOVEMENT_FILTERS,
  type MovementFilters,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import {
  BROWSE_KEY,
  browseAncestors,
  browseView,
  CLOSED_BROWSE,
  CUSTOM_OPEN_AT_MOST,
  familyKey,
  forgetClosed,
  isBrowseOpen,
  kindKey,
  seedBrowse,
  toggleBrowse,
} from '@/lib/movements/browse-view';
import {
  hasLibraryData,
  matchable,
  type LibraryOption,
  type MovementOptionDTO,
} from '@/lib/movements/movement-option';
import {
  catalogOption,
  householdOption,
  LIBRARY_OPTIONS,
  libraryNamed,
  withoutLibraryData,
} from '@/test/movement-picker-fixtures';

const BARE = [catalogOption('Pull-Up'), catalogOption('Back Squat')].map(withoutLibraryData);
const MINE = [householdOption('Garage Circuit', 'h-1'), householdOption('Hill Sprints', 'h-2')];
const ALL = [...LIBRARY_OPTIONS, ...BARE, ...MINE];
const LATS: MovementFilters = { ...NO_MOVEMENT_FILTERS, muscles: [MUSCLE.lats] };

/** The rows of a view's tree, in order. */
const treeRows = (view: ReturnType<typeof browseView>) =>
  view.tree.flatMap(({ families }) => families.flatMap(({ options }) => options));

describe('browseView: the partition (CAT-3 P12, K24)', () => {
  it('lists every option exactly once: in the tree, in "Not sorted yet" or in Your custom items', () => {
    const view = browseView(ALL, NO_MOVEMENT_FILTERS);
    const listed = [...treeRows(view), ...view.bare, ...view.custom];
    expect(listed).toHaveLength(ALL.length);
    expect(new Set(listed)).toEqual(new Set(ALL));
    // Each in its own place, by `hasLibraryData` alone.
    expect(treeRows(view).every(hasLibraryData)).toBe(true);
    expect(view.bare).toEqual(expect.arrayContaining(BARE));
    expect(view.bare).toHaveLength(BARE.length);
    expect(view.custom).toEqual(MINE);
  });

  it('sorts "Not sorted yet" by name, as the tree does', () => {
    expect(browseView(ALL, NO_MOVEMENT_FILTERS).bare.map((o) => o.name)).toEqual([
      'Back Squat',
      'Pull-Up',
    ]);
  });

  it('N is movementFilterCounts(...).total, with no filter and with one', () => {
    // What the filter panel's "Show N movements" reads, through the same mapping the tree uses.
    const rows = matchable(ALL);
    for (const filters of [NO_MOVEMENT_FILTERS, LATS]) {
      const view = browseView(ALL, filters);
      expect(view.total).toBe(movementFilterCounts(rows, { query: '', filters }).total);
    }
    // Non-vacuity: the two states differ, and the old built-ins count only with no filter.
    expect(browseView(ALL, NO_MOVEMENT_FILTERS).total).toBe(LIBRARY_OPTIONS.length + BARE.length);
    const filtered = browseView(ALL, LATS);
    expect(filtered.bare).toEqual([]);
    expect(filtered.total).toBeGreaterThan(0);
    expect(filtered.total).toBeLessThan(LIBRARY_OPTIONS.length);
  });
});

describe('browseView: the tree opens itself when short (K26)', () => {
  const library = (n: number) => LIBRARY_OPTIONS.slice(0, n);

  it(`at ${BROWSE_OPEN_AT_MOST} tree rows, not at one more; custom items and K24's rows do not count`, () => {
    expect(LIBRARY_OPTIONS.length).toBeGreaterThan(BROWSE_OPEN_AT_MOST);
    const at = browseView([...library(BROWSE_OPEN_AT_MOST), ...MINE, ...BARE], NO_MOVEMENT_FILTERS);
    expect(at.auto).toBe(true);
    expect(at.total).toBeGreaterThan(BROWSE_OPEN_AT_MOST);
    expect(browseView(library(BROWSE_OPEN_AT_MOST + 1), NO_MOVEMENT_FILTERS).auto).toBe(false);
  });

  it('opens kinds, families and "Not sorted yet", never Your custom items above five', () => {
    const view = browseView(
      [
        ...library(2),
        ...BARE,
        ...Array.from({ length: CUSTOM_OPEN_AT_MOST + 1 }, (_, i) =>
          householdOption(`Mine ${i}`, `m-${i}`),
        ),
      ],
      NO_MOVEMENT_FILTERS,
    );
    expect(view.auto).toBe(true);
    const kind = view.tree[0]!.kind;
    expect(isBrowseOpen(kindKey(kind), CLOSED_BROWSE, view)).toBe(true);
    // ⏳ The maintainer, 2026-11-19: "Open it while the tree is small" (K24 stays folded otherwise).
    expect(isBrowseOpen(BROWSE_KEY.notSorted, CLOSED_BROWSE, view)).toBe(true);
    expect(isBrowseOpen(BROWSE_KEY.custom, CLOSED_BROWSE, view)).toBe(false);
  });
});

describe('browseView under a filter (CAT-3 P12: "Movements that fit your filters")', () => {
  it('is the same tree over the rows that fit: no empty kind or family, no "Not sorted yet"', () => {
    const view = browseView(ALL, LATS);
    expect(view.filtered).toBe(true);
    expect(browseView(ALL, NO_MOVEMENT_FILTERS).filtered).toBe(false);
    const rows = treeRows(view);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((o) => hasLibraryData(o) && o.primaryMuscle === MUSCLE.lats)).toBe(true);
    for (const { count, families } of view.tree) {
      expect(count).toBeGreaterThan(0);
      for (const { options } of families) expect(options.length).toBeGreaterThan(0);
    }
    expect(view.bare).toEqual([]);
    // Custom items are never filtered (P9): all of them, as with no filter.
    expect(view.custom).toEqual(MINE);
    // Non-vacuity: the filter dropped a kind the unfiltered tree has.
    expect(view.tree.length).toBeLessThan(browseView(ALL, NO_MOVEMENT_FILTERS).tree.length);
  });

  /** `n` library rows that work the lats, each its own movement. */
  const lats = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...(LIBRARY_OPTIONS[0] as LibraryOption),
      publicId: `lats-${i}`,
      name: `Lats ${i}`,
      primaryMuscle: MUSCLE.lats,
    }));
  const others = LIBRARY_OPTIONS.filter(
    (o) => hasLibraryData(o) && o.primaryMuscle !== MUSCLE.lats,
  );

  it(`auto-opens on the FILTERED tree's rows: ${BROWSE_OPEN_AT_MOST} that fit, not one more (K26)`, () => {
    // Over the threshold with no filter, so only the filtered count can open it.
    expect(others.length).toBeGreaterThan(BROWSE_OPEN_AT_MOST);
    const at = [...lats(BROWSE_OPEN_AT_MOST), ...others];
    expect(browseView(at, NO_MOVEMENT_FILTERS).auto).toBe(false);
    expect(browseView(at, LATS).auto).toBe(true);
    expect(browseView([...lats(BROWSE_OPEN_AT_MOST + 1), ...others], LATS).auto).toBe(false);
  });

  it('"Your custom items" starts folded under a filter, however few (P9, K25); a seed still opens it', () => {
    expect(MINE.length).toBeLessThanOrEqual(CUSTOM_OPEN_AT_MOST);
    const filtered = browseView(ALL, LATS);
    const unfiltered = browseView(ALL, NO_MOVEMENT_FILTERS);
    expect(isBrowseOpen(BROWSE_KEY.customFiltered, CLOSED_BROWSE, filtered)).toBe(false);
    expect(isBrowseOpen(BROWSE_KEY.custom, CLOSED_BROWSE, unfiltered)).toBe(true);
    // A seed under the filter opens it.
    expect(
      isBrowseOpen(
        BROWSE_KEY.customFiltered,
        seedBrowse(CLOSED_BROWSE, [MINE[0]!], undefined, true),
        filtered,
      ),
    ).toBe(true);
  });

  it('🔴 a tick with no filter seeds only the unfiltered key: the filtered list stays folded', () => {
    const seeded = seedBrowse(CLOSED_BROWSE, [MINE[0]!]);
    expect(isBrowseOpen(BROWSE_KEY.custom, seeded, browseView(ALL, NO_MOVEMENT_FILTERS))).toBe(
      true,
    );
    expect(isBrowseOpen(BROWSE_KEY.customFiltered, seeded, browseView(ALL, LATS))).toBe(false);
  });

  it('🔴 opening them with no filter does not open them under one: two keys', () => {
    const opened = toggleBrowse(CLOSED_BROWSE, BROWSE_KEY.custom, false);
    expect(isBrowseOpen(BROWSE_KEY.custom, opened, browseView(ALL, NO_MOVEMENT_FILTERS))).toBe(
      true,
    );
    expect(
      isBrowseOpen(BROWSE_KEY.customFiltered, forgetClosed(opened), browseView(ALL, LATS)),
    ).toBe(false);
  });
});

describe("Today's program", () => {
  const view = browseView(ALL, NO_MOVEMENT_FILTERS);
  const GOBLET = libraryNamed('Goblet squat');

  it('starts open while any of it is not on a card, folded once all of it is', () => {
    expect(
      isBrowseOpen(BROWSE_KEY.program, CLOSED_BROWSE, { ...view, programAllOnForm: false }),
    ).toBe(true);
    expect(
      isBrowseOpen(BROWSE_KEY.program, CLOSED_BROWSE, { ...view, programAllOnForm: true }),
    ).toBe(false);
  });

  it('…unless it holds a ticked row, read live (the ids may arrive after the tick)', () => {
    const allOnTicked = { ...view, programAllOnForm: true, programHoldsTicked: true };
    expect(isBrowseOpen(BROWSE_KEY.program, CLOSED_BROWSE, allOnTicked)).toBe(true);
    // A tap still wins.
    expect(
      isBrowseOpen(
        BROWSE_KEY.program,
        toggleBrowse(CLOSED_BROWSE, BROWSE_KEY.program, true),
        allOnTicked,
      ),
    ).toBe(false);
  });

  it('🔴 a selection in it opens it, even with all of it on a card (the row is about to be focused)', () => {
    const program = new Set([GOBLET.publicId, MINE[0]!.publicId]);
    expect(browseAncestors(GOBLET, program)).toContain(BROWSE_KEY.program);
    expect(browseAncestors(MINE[0]!, program)).toEqual([BROWSE_KEY.custom, BROWSE_KEY.program]);
    expect(browseAncestors(MINE[0]!, program, true)).toEqual([
      BROWSE_KEY.customFiltered,
      BROWSE_KEY.program,
    ]);
    expect(browseAncestors(GOBLET)).not.toContain(BROWSE_KEY.program);
    const allOn = { ...view, programAllOnForm: true };
    expect(
      isBrowseOpen(BROWSE_KEY.program, seedBrowse(CLOSED_BROWSE, [GOBLET], program), allOn),
    ).toBe(true);
    // A row outside the program does not open it.
    const other = libraryNamed('Easy run');
    expect(
      isBrowseOpen(BROWSE_KEY.program, seedBrowse(CLOSED_BROWSE, [other], program), allOn),
    ).toBe(false);
  });
});

describe('isBrowseOpen: the defaults', () => {
  const view = browseView(ALL, NO_MOVEMENT_FILTERS);
  const SQUAT = familyKey(MODALITY.strength, 'squat');

  it('All movements open; a kind and a family closed on a long tree; custom items by their count', () => {
    expect(view.auto).toBe(false);
    expect(isBrowseOpen(BROWSE_KEY.all, CLOSED_BROWSE, view)).toBe(true);
    expect(isBrowseOpen(kindKey(MODALITY.strength), CLOSED_BROWSE, view)).toBe(false);
    expect(isBrowseOpen(SQUAT, CLOSED_BROWSE, view)).toBe(false);
    expect(isBrowseOpen(BROWSE_KEY.notSorted, CLOSED_BROWSE, view)).toBe(false);
    const mine = (n: number) =>
      browseView(
        Array.from({ length: n }, (_, i) => householdOption(`Mine ${i}`, `m-${i}`)),
        NO_MOVEMENT_FILTERS,
      );
    expect(isBrowseOpen(BROWSE_KEY.custom, CLOSED_BROWSE, mine(CUSTOM_OPEN_AT_MOST))).toBe(true);
    expect(isBrowseOpen(BROWSE_KEY.custom, CLOSED_BROWSE, mine(CUSTOM_OPEN_AT_MOST + 1))).toBe(
      false,
    );
  });

  it("a person's tap beats every default, auto and the seed included", () => {
    const short = browseView(LIBRARY_OPTIONS.slice(0, 3), NO_MOVEMENT_FILTERS);
    const kind = kindKey(short.tree[0]!.kind);
    expect(isBrowseOpen(kind, CLOSED_BROWSE, short)).toBe(true);
    const closed = toggleBrowse(CLOSED_BROWSE, kind, true);
    expect(isBrowseOpen(kind, closed, short)).toBe(false);
    const seededThenClosed = toggleBrowse(
      { userChoice: new Map(), seeded: new Set([SQUAT]) },
      SQUAT,
      true,
    );
    expect(isBrowseOpen(SQUAT, seededThenClosed, view)).toBe(false);
    expect(
      isBrowseOpen(BROWSE_KEY.all, toggleBrowse(CLOSED_BROWSE, BROWSE_KEY.all, true), view),
    ).toBe(false);
  });
});

describe('browseAncestors and seedBrowse: a selection opens every group above it', () => {
  const view = browseView(ALL, NO_MOVEMENT_FILTERS);
  const GOBLET = libraryNamed('Goblet squat');
  const RUN = libraryNamed('Easy run');

  it('names the kind and the family; a flat kind has no family; K24 and custom items their own', () => {
    expect(browseAncestors(GOBLET)).toEqual([
      BROWSE_KEY.all,
      kindKey(MODALITY.strength),
      familyKey(MODALITY.strength, 'squat'),
    ]);
    expect(browseAncestors(RUN)).toEqual([BROWSE_KEY.all, kindKey(MODALITY.conditioning)]);
    expect(browseAncestors(BARE[0]!)).toEqual([BROWSE_KEY.all, BROWSE_KEY.notSorted]);
    expect(browseAncestors(MINE[0]!)).toEqual([BROWSE_KEY.custom]);
    expect(browseAncestors(MINE[0]!, undefined, true)).toEqual([BROWSE_KEY.customFiltered]);
  });

  it('agrees with browseTree for EVERY row: the groups it names are the ones the row is drawn in', () => {
    const tree = browseView(LIBRARY_OPTIONS, NO_MOVEMENT_FILTERS).tree;
    let rows = 0;
    for (const { kind, families } of tree) {
      for (const { family, options } of families) {
        for (const option of options) {
          rows += 1;
          expect(browseAncestors(option), option.name).toEqual([
            BROWSE_KEY.all,
            kindKey(kind),
            ...(family === null ? [] : [familyKey(kind, family)]),
          ]);
        }
      }
    }
    expect(rows).toBe(LIBRARY_OPTIONS.length);
  });

  it('🔴 opens them even after the person closed one, and a later tap still closes it', () => {
    const kind = kindKey(MODALITY.strength);
    const closedByTap = toggleBrowse(toggleBrowse(CLOSED_BROWSE, kind, false), kind, true);
    expect(isBrowseOpen(kind, closedByTap, view)).toBe(false);
    const seeded = seedBrowse(closedByTap, [GOBLET]);
    for (const key of browseAncestors(GOBLET))
      expect(isBrowseOpen(key, seeded, view), key).toBe(true);
    expect(isBrowseOpen(kind, toggleBrowse(seeded, kind, true), view)).toBe(false);
  });

  it('opens "Not sorted yet" for a bare row, and Your custom items above five for a custom one', () => {
    const many = browseView(
      Array.from({ length: CUSTOM_OPEN_AT_MOST + 1 }, (_, i) =>
        householdOption(`Mine ${i}`, `m-${i}`),
      ),
      NO_MOVEMENT_FILTERS,
    );
    const mine = many.custom[0]!;
    expect(isBrowseOpen(BROWSE_KEY.custom, seedBrowse(CLOSED_BROWSE, [mine]), many)).toBe(true);
    expect(isBrowseOpen(BROWSE_KEY.notSorted, seedBrowse(CLOSED_BROWSE, [BARE[0]!]), view)).toBe(
      true,
    );
  });

  it('seeding nothing changes nothing', () => {
    expect(seedBrowse(CLOSED_BROWSE, [])).toBe(CLOSED_BROWSE);
  });
});

describe('forgetClosed: a filter change', () => {
  it('drops the groups the person closed and keeps the ones they opened', () => {
    const a = kindKey(MODALITY.strength);
    const b = kindKey(MODALITY.mobility);
    const state = toggleBrowse(toggleBrowse(CLOSED_BROWSE, a, true), b, false);
    const after = forgetClosed(state);
    expect([...after.userChoice]).toEqual([[b, true]]);
    expect(after.seeded).toBe(state.seeded);
  });
});

describe('keys are kind-qualified', () => {
  it('the same family code under two kinds gives two keys', () => {
    const plank = libraryNamed('Side plank');
    const coreStretch: MovementOptionDTO = {
      ...(libraryNamed('Couch stretch') as LibraryOption),
      publicId: 'lib-core-mobility',
      name: 'Cat-cow',
      primaryMuscle: MUSCLE.abdominals,
    };
    const view = browseView([plank, coreStretch], NO_MOVEMENT_FILTERS);
    const keys = view.tree.flatMap(({ kind, families }) =>
      families.map(({ family }) => familyKey(kind, family!)),
    );
    expect(view.tree.flatMap(({ families }) => families.map(({ family }) => family))).toEqual([
      'core',
      'core',
    ]);
    expect(new Set(keys).size).toBe(2);
  });
});
