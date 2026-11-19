// @vitest-environment jsdom
import {
  MOVEMENT_SEED_ROWS,
  MOVEMENT_NAME_MESSAGES,
  TRACKING_TYPE,
  SUPERVISION_LABELS,
  TRACKING_TYPE_LABELS,
  EQUIPMENT_CODE,
  SUPERVISION_KIND,
  type CatalogHowTo,
  BROWSE_FLAT_KINDS,
  BROWSE_OPEN_AT_MOST,
  browseTree,
  byFoldedName,
  MODALITY,
  MODALITY_LABELS,
  MUSCLE,
} from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasLibraryData,
  type LibraryOption,
  type MovementOptionDTO,
  type MovementPickerData,
} from '@/lib/movements/movement-option';
import { CUSTOM_OPEN_AT_MOST } from '@/lib/movements/browse-view';
import { MOVEMENT_PICKER_COPY as COPY } from '@/lib/movements/movement-picker-copy';
import { SHEET_COPY } from '@/components/ui/sheet';

import {
  catalogOption,
  householdOption,
  LIBRARY_OPTIONS,
  libraryNamed,
  expandBrowse,
  pickerTrigger,
  stubSheetHistory,
  withoutLibraryData,
} from '@/test/movement-picker-fixtures';

import { listedAs, MovementPicker, type TodaysProgramForPicker } from './movement-picker';

afterEach(cleanup);

// ── Fixtures, built from the REAL seeded catalog ──────────────────────────────────────────────────
// Not hand-written options: the grouping, the aliases and the names are what PR 4's DAL will read out
// of `MOVEMENT_PICKER_ENTRIES`, so a test over invented rows would pass while the real catalog did
// something else.
//
// `trackingType` is `weight_reps` on every option here: it is the default FAM-1 step 3 gives the
// column, and no seeded row carries its own type until that step types each built-in by slug. From
// then on `catalogOption` reads the row's.
const ALL_CATALOG = MOVEMENT_SEED_ROWS.map((r) => catalogOption(r.name));
/** A household item literally named `RDL`, beside the catalog's Romanian Deadlift (C30's tie). */
const HOUSEHOLD_RDL_ID = '00000000-0000-7000-8000-00000000a0d1';
const trigger = pickerTrigger;

function Harness({
  data,
  todaysProgram,
  alreadyIn,
  currentId,
  onPick = vi.fn(),
}: {
  data: MovementPickerData;
  todaysProgram?: TodaysProgramForPicker;
  alreadyIn?: { ids: ReadonlySet<string>; label: string };
  currentId?: string;
  onPick?: (
    p: Parameters<NonNullable<React.ComponentProps<typeof MovementPicker>['onPick']>>[0],
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <main>
      <button ref={ref} type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <MovementPicker
        open={open}
        onOpenChange={setOpen}
        title={COPY.title}
        data={data}
        todaysProgram={todaysProgram}
        alreadyIn={alreadyIn}
        currentId={currentId}
        returnFocusTo={ref}
        onPick={onPick}
      />
    </main>
  );
}

const open = () => act(() => void trigger().click());
const search = (name: string = COPY.searchLabel) => screen.getByRole('searchbox', { name });
let lastTyped = '';
const type = (value: string, name: string = COPY.searchLabel) => {
  lastTyped = value.trim();
  act(() => void fireEvent.change(search(name), { target: { value } }));
};
const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const status = () => document.querySelector('[role="status"]')?.textContent ?? '';

/** A browse group's heading or button, by its label: its accessible name also says its count. */
const startsWith = (label: string) => (name: string) => name.startsWith(label);
const groupHeading = (level: number, label: string) =>
  screen.queryByRole('heading', { level, name: startsWith(label) });
const groupButton = (label: string, n: number) =>
  screen.getByRole('button', { name: COPY.choiceName(label, n) });
describe('the browse list, with no query (CAT-3 B3: P12, K24 to K27)', () => {
  it("orders Your custom items → Recent → Today's program → All movements", () => {
    const recent = catalogOption('Back Squat');
    const prescribed = catalogOption('Front Squat');
    render(
      <Harness
        data={{
          options: [...ALL_CATALOG, householdOption('Garage Circuit', 'h-1')],
          recentIds: [recent.publicId],
        }}
        todaysProgram={{ ids: [prescribed.publicId], onFormIds: new Set() }}
      />,
    );
    open();
    // 🔴 **Today's program IS in this list**: its `h3` holds its disclosure button, so a
    // screen-reader user skimming by heading reaches the day's actual program.
    const expected = [
      screen.getByRole('heading', { level: 3, name: COPY.choiceName(COPY.household, 1) }),
      screen.getByRole('heading', { level: 3, name: COPY.recent }),
      screen.getByRole('heading', { level: 3, name: COPY.todaysProgram }),
      screen.getByRole('heading', {
        level: 3,
        name: COPY.choiceName(COPY.allMovements, ALL_CATALOG.length),
      }),
    ];
    expect(screen.getAllByRole('heading', { level: 3 })).toEqual(expected);
  });

  it('the tree is browseTree: every kind and family, in its order, each with its count', () => {
    render(<Harness data={{ options: LIBRARY_OPTIONS }} />);
    open();
    expandBrowse();
    const tree = browseTree(LIBRARY_OPTIONS.filter(hasLibraryData));
    const names = (level: number) =>
      screen.getAllByRole('heading', { level }).map((h) => h.querySelector('button'));
    expect(names(4)).toEqual(
      tree.map(({ kind, count }) => groupButton(MODALITY_LABELS[kind], count)),
    );
    expect(names(5)).toEqual(
      tree.flatMap(({ families }) =>
        families.flatMap(({ label, options }) =>
          label === null ? [] : [groupButton(label, options.length)],
        ),
      ),
    );
    // Non-vacuity: more than one kind, a flat kind, and a kind with several families.
    expect(tree.length).toBeGreaterThan(2);
    expect(tree.some(({ families }) => families[0]?.family === null)).toBe(true);
    expect(tree.some(({ families }) => families.length > 2)).toBe(true);
  });

  it("the rows of each family and flat kind are in browseTree's order", () => {
    render(<Harness data={{ options: LIBRARY_OPTIONS }} />);
    open();
    expandBrowse();
    const tree = browseTree(LIBRARY_OPTIONS.filter(hasLibraryData));
    for (const { kind, count, families } of tree) {
      const kindGroup = groupButton(MODALITY_LABELS[kind], count).closest('div')!;
      for (const { label, options } of families) {
        const group =
          label === null ? kindGroup : groupButton(label, options.length).closest('div')!;
        // The group's own list: the first `ul` under its body.
        const list = group.querySelector(':scope > div > ul')!;
        const names = [...list.querySelectorAll(':scope > li > div > button:first-child')].map(
          (b) => b.textContent?.split(',')[0],
        );
        expect(names, `${kind}/${label ?? '(flat)'}`).toEqual(options.map((o) => o.name));
      }
    }
  });

  it('a kind with no family level (Conditioning, Skill) lists its rows by name under it (K27, K30)', () => {
    render(<Harness data={{ options: LIBRARY_OPTIONS }} />);
    open();
    expandBrowse();
    const conditioning = LIBRARY_OPTIONS.filter(
      (o) => hasLibraryData(o) && BROWSE_FLAT_KINDS.includes(o.modality),
    );
    expect(conditioning.length).toBeGreaterThan(1);
    for (const option of conditioning) {
      const button = screen.getByRole('button', { name: new RegExp(`^${option.name},`) });
      // Straight under the kind's group: no family heading between them.
      const group = button.closest('ul')!.parentElement!;
      expect(group.previousElementSibling?.tagName).toBe('H4');
    }
  });

  it('a kind and a family start closed; All movements starts open; a tap opens one and leaves the rest', () => {
    render(<Harness data={{ options: LIBRARY_OPTIONS }} />);
    open();
    const all = groupButton(COPY.allMovements, LIBRARY_OPTIONS.length);
    expect(all.getAttribute('aria-expanded')).toBe('true');
    const strength = LIBRARY_OPTIONS.filter(
      (o) => hasLibraryData(o) && o.modality === MODALITY.strength,
    );
    const kind = groupButton(MODALITY_LABELS.strength, strength.length);
    expect(kind.getAttribute('aria-expanded')).toBe('false');
    // A closed group renders nothing: no family heading, no row.
    expect(screen.queryAllByRole('heading', { level: 5 })).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Goblet squat,/ })).toBeNull();
    act(() => void fireEvent.click(kind));
    expect(kind.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 5 }).length).toBeGreaterThan(1);
    expect(
      groupButton(MODALITY_LABELS.mobility, 2).getAttribute('aria-expanded'),
      'the other kinds stay as they were',
    ).toBe('false');
  });

  it(`opens every kind and family by itself at ${BROWSE_OPEN_AT_MOST} rows, and not at one more (K26)`, () => {
    for (const [n, expanded] of [
      [BROWSE_OPEN_AT_MOST, 'true'],
      [BROWSE_OPEN_AT_MOST + 1, 'false'],
    ] as const) {
      render(<Harness data={{ options: LIBRARY_OPTIONS.slice(0, n) }} />);
      open();
      const groups = document.querySelectorAll(':is(h4, h5) > button');
      expect(groups.length, `n=${n}`).toBeGreaterThan(0);
      for (const group of groups)
        expect(group.getAttribute('aria-expanded'), `n=${n}`).toBe(expanded);
      cleanup();
    }
  });

  it(`"Your custom items" is open at ${CUSTOM_OPEN_AT_MOST} and one folded line above it (K25)`, () => {
    const mine = (n: number) =>
      Array.from({ length: n }, (_, i) => householdOption(`Garage ${i + 1}`, `h-${i + 1}`));
    for (const [n, expanded] of [
      [CUSTOM_OPEN_AT_MOST, 'true'],
      [CUSTOM_OPEN_AT_MOST + 1, 'false'],
    ] as const) {
      render(<Harness data={{ options: [...ALL_CATALOG, ...mine(n)] }} />);
      open();
      const custom = groupButton(COPY.household, n);
      expect(custom.getAttribute('aria-expanded'), `n=${n}`).toBe(expanded);
      expect(!!screen.queryByRole('button', { name: /^Garage 1,/ }), `n=${n}`).toBe(
        expanded === 'true',
      );
      cleanup();
    }
  });

  const BARE_THREE = [
    catalogOption('Pull-Up'),
    catalogOption('Back Squat'),
    catalogOption('Dips'),
  ].map(withoutLibraryData);

  it('⏳ the old built-ins with no library entry are "Not sorted yet", after the kinds, by name, folded on a long tree (K24)', () => {
    expect(LIBRARY_OPTIONS.length).toBeGreaterThan(BROWSE_OPEN_AT_MOST);
    render(<Harness data={{ options: [...LIBRARY_OPTIONS, ...BARE_THREE] }} />);
    open();
    const section = groupButton(COPY.notSorted, BARE_THREE.length);
    expect(section.getAttribute('aria-expanded')).toBe('false');
    // An h4 sibling of the kinds, and the last of them.
    expect(screen.getAllByRole('heading', { level: 4 }).at(-1)).toBe(section.parentElement);
    // All movements counts them: N is the tree's rows plus these.
    expect(groupButton(COPY.allMovements, LIBRARY_OPTIONS.length + BARE_THREE.length)).toBeTruthy();
    act(() => void fireEvent.click(section));
    const rows = [...section.closest('div')!.querySelectorAll('li > div > button:first-child')];
    expect(rows.map((b) => b.textContent?.split(',')[0])).toEqual(
      [...BARE_THREE].sort(byFoldedName).map((o) => o.name),
    );
  });

  it('⏳ "Not sorted yet" opens by itself while the tree is short (maintainer, 2026-11-19)', () => {
    render(<Harness data={{ options: [...LIBRARY_OPTIONS.slice(0, 3), ...BARE_THREE] }} />);
    open();
    const section = groupButton(COPY.notSorted, BARE_THREE.length);
    expect(section.getAttribute('aria-expanded')).toBe('true');
    // A tap still wins.
    act(() => void fireEvent.click(section));
    expect(section.getAttribute('aria-expanded')).toBe('false');
  });

  it('⏳ K23: a movement that is both an old built-in and a library row is listed in both places', () => {
    const old = withoutLibraryData(catalogOption('Push-Ups'));
    const library: MovementOptionDTO = {
      ...libraryNamed('Incline push-up'),
      publicId: 'lib-push',
      name: 'Push-up',
    };
    render(<Harness data={{ options: [old, library, ...LIBRARY_OPTIONS] }} />);
    open();
    expandBrowse();
    const notSorted = groupButton(COPY.notSorted, 1).closest('div')!;
    expect(within(notSorted).getByRole('button', { name: /^Push-Ups,/ })).toBeTruthy();
    const inTree = screen.getByRole('button', { name: /^Push-up,/ });
    expect(notSorted.contains(inTree)).toBe(false);
  });

  it('a library-only option (no legacy group) is reachable by browsing', () => {
    render(<Harness data={{ options: [...ALL_CATALOG, ...LIBRARY_OPTIONS] }} />);
    open();
    expandBrowse();
    expect(screen.getByRole('button', { name: /^Couch stretch,/ })).toBeTruthy();
  });

  it('omits a kind with no rows, Recent without recentIds, and Your custom items with none', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    expect(groupHeading(4, MODALITY_LABELS.mobility)).toBeNull();
    expect(groupHeading(3, COPY.recent)).toBeNull();
    expect(groupHeading(3, COPY.household)).toBeNull();
    // Non-vacuity: the helper finds what is there.
    expect(groupHeading(4, MODALITY_LABELS.strength)).toBeTruthy();
    cleanup();
    render(<Harness data={{ options: ALL_CATALOG, recentIds: [] }} />);
    open();
    expect(groupHeading(3, COPY.recent)).toBeNull();
  });

  it('a group is a button in its heading: aria-expanded, aria-controls while open, and focus stays', () => {
    render(<Harness data={{ options: LIBRARY_OPTIONS }} />);
    open();
    const kind = groupButton(MODALITY_LABELS.mobility, 2);
    expect(kind.parentElement?.tagName).toBe('H4');
    expect(kind.getAttribute('type')).toBe('button');
    expect(kind.getAttribute('aria-controls')).toBeNull();
    act(() => kind.focus());
    // A keyboard's Enter on a button is its click.
    act(() => void fireEvent.click(kind));
    expect(kind.getAttribute('aria-expanded')).toBe('true');
    const body = document.getElementById(kind.getAttribute('aria-controls') ?? '');
    // Its two families, each closed, as its body.
    expect(body?.querySelectorAll('h5 > button[aria-expanded="false"]').length).toBe(2);
    expect(document.activeElement).toBe(kind);
    act(() => void fireEvent.click(kind));
    expect(kind.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(kind);
    // Only the top sections are landmarks: a region per kind floods a screen reader's list.
    expect(kind.closest('section')?.getAttribute('aria-labelledby')).toBe(
      groupButton(COPY.allMovements, LIBRARY_OPTIONS.length).parentElement?.id,
    );
  });

  it('family ids are kind-qualified: a family code under two kinds never repeats an id', () => {
    const coreStrength = libraryNamed('Side plank');
    const coreMobility: MovementOptionDTO = {
      ...(libraryNamed('Couch stretch') as LibraryOption),
      publicId: 'lib-core-mobility',
      name: 'Cat-cow',
      primaryMuscle: MUSCLE.abdominals,
    };
    render(<Harness data={{ options: [coreStrength, coreMobility] }} />);
    open();
    const cores = screen.getAllByRole('heading', { level: 5, name: startsWith('Core') });
    expect(cores).toHaveLength(2);
    expect(new Set(cores.map((h) => h.id)).size).toBe(2);
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('which groups are open (CAT-3 B3): one model, kept in the picker', () => {
  beforeEach(stubSheetHistory);
  const GOBLET = libraryNamed('Goblet squat');

  it('🔴 the current row opens every group above it on open (single mode)', () => {
    render(<Harness data={{ options: LIBRARY_OPTIONS }} currentId={GOBLET.publicId} />);
    open();
    const row = screen.getByRole('button', { name: /^Goblet squat,/ });
    expect(row.getAttribute('aria-current')).toBe('true');
  });

  it('⏳ the current row in "Not sorted yet" opens it', () => {
    const bare = withoutLibraryData(catalogOption('Pull-Up'));
    render(<Harness data={{ options: [bare, ...LIBRARY_OPTIONS] }} currentId={bare.publicId} />);
    open();
    expect(groupButton(COPY.notSorted, 1).getAttribute('aria-expanded')).toBe('true');
  });

  it('survives a no-match search and clearing it; resets when the sheet opens again', () => {
    render(<Harness data={{ options: LIBRARY_OPTIONS }} />);
    open();
    const mobility = () => groupButton(MODALITY_LABELS.mobility, 2);
    act(() => void fireEvent.click(mobility()));
    type('zzzzqx');
    // The tree under "No matches" keeps what the person opened.
    expect(mobility().getAttribute('aria-expanded')).toBe('true');
    type('');
    expect(mobility().getAttribute('aria-expanded')).toBe('true');
    act(
      () => void fireEvent.click(screen.getAllByRole('button', { name: SHEET_COPY.close }).at(-1)!),
    );
    open();
    expect(mobility().getAttribute('aria-expanded')).toBe('false');
  });

  function SelectHarness({ selected }: { selected: readonly string[] }) {
    const [isOpen, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <main>
        <button ref={ref} type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <MovementPicker
          open={isOpen}
          onOpenChange={setOpen}
          title="Add items"
          data={{ options: LIBRARY_OPTIONS }}
          returnFocusTo={ref}
          multiple={{
            selected,
            onToggle: vi.fn(),
            onCreate: vi.fn(),
            createLabel: (typed) => (typed ? `New item: ${typed}` : '+ New item'),
            noMatchHint: 'No item matches.',
            searchLabel: 'Search items',
            searchPlaceholder: 'Search items',
            footerAction: <button type="button">Add</button>,
          }}
        />
      </main>
    );
  }
  const goblet = () => screen.queryByRole('checkbox', { name: /^Goblet squat,/ });
  const strength = () =>
    groupButton(
      MODALITY_LABELS.strength,
      LIBRARY_OPTIONS.filter((o) => hasLibraryData(o) && o.modality === MODALITY.strength).length,
    );

  it('a row ticked when the sheet opens has every group above it open (multi)', () => {
    render(<SelectHarness selected={[GOBLET.publicId]} />);
    open();
    expect(goblet()?.getAttribute('aria-checked')).toBe('true');
  });

  it('🔴 a row the caller selects reopens the groups above it, even one the person closed; unticking closes nothing', () => {
    const { rerender } = render(<SelectHarness selected={[]} />);
    open();
    act(() => void fireEvent.click(strength()));
    act(() => void fireEvent.click(strength()));
    expect(strength().getAttribute('aria-expanded')).toBe('false');
    expect(goblet()).toBeNull();
    // The caller's create selects the new row and focuses it: it must be on screen in this commit.
    rerender(<SelectHarness selected={[GOBLET.publicId]} />);
    expect(strength().getAttribute('aria-expanded')).toBe('true');
    expect(goblet()).toBeTruthy();
    rerender(<SelectHarness selected={[]} />);
    expect(goblet(), 'the untick left it on screen').toBeTruthy();
    // A later tap still closes the group.
    act(() => void fireEvent.click(strength()));
    expect(goblet()).toBeNull();
  });

  /** The sheet opened and the selection set by the caller, both as props, so one render does both. */
  function ControlledHarness({
    isOpen,
    selected,
    options = LIBRARY_OPTIONS,
  }: {
    isOpen: boolean;
    selected: readonly string[];
    options?: readonly MovementOptionDTO[];
  }) {
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <main>
        <button ref={ref} type="button">
          Open
        </button>
        <MovementPicker
          open={isOpen}
          onOpenChange={vi.fn()}
          title="Add items"
          data={{ options }}
          returnFocusTo={ref}
          multiple={{
            selected,
            onToggle: vi.fn(),
            onCreate: vi.fn(),
            createLabel: (typed) => (typed ? `New item: ${typed}` : '+ New item'),
            noMatchHint: 'No item matches.',
            searchLabel: 'Search items',
            searchPlaceholder: 'Search items',
            footerAction: <button type="button">Add</button>,
          }}
        />
      </main>
    );
  }
  const DEAD_HANG = libraryNamed('Dead hang');
  const deadHang = () => screen.queryByRole('checkbox', { name: /^Dead hang,/ });

  it('🔴 the sheet opening and a new tick in ONE render: both rows have their groups open', () => {
    const { rerender } = render(<ControlledHarness isOpen={false} selected={[GOBLET.publicId]} />);
    rerender(<ControlledHarness isOpen selected={[GOBLET.publicId, DEAD_HANG.publicId]} />);
    expect(goblet()?.getAttribute('aria-checked')).toBe('true');
    expect(deadHang()?.getAttribute('aria-checked')).toBe('true');
  });

  it('a row selected before its option arrives has its groups opened once it does', () => {
    const { rerender } = render(
      <ControlledHarness
        isOpen
        selected={[GOBLET.publicId]}
        options={LIBRARY_OPTIONS.filter((o) => o.publicId !== GOBLET.publicId)}
      />,
    );
    expect(goblet()).toBeNull();
    rerender(<ControlledHarness isOpen selected={[GOBLET.publicId]} />);
    expect(goblet()?.getAttribute('aria-checked')).toBe('true');
  });

  it('a filter change forgets the groups the person closed, and keeps the ones they opened', () => {
    render(<Harness data={{ options: LIBRARY_OPTIONS }} />);
    open();
    const all = () => groupButton(COPY.allMovements, LIBRARY_OPTIONS.length);
    const mobility = () => groupButton(MODALITY_LABELS.mobility, 2);
    act(() => void fireEvent.click(mobility()));
    act(() => void fireEvent.click(all()));
    expect(all().getAttribute('aria-expanded')).toBe('false');
    act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.filtersName(0) })));
    act(
      () =>
        void fireEvent.click(
          screen.getByRole('radio', { name: new RegExp(`^${COPY.emptyEquipment}`) }),
        ),
    );
    act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.clearFilters })));
    act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.filtersBack })));
    expect(all().getAttribute('aria-expanded')).toBe('true');
    expect(mobility().getAttribute('aria-expanded')).toBe('true');
  });

  it('survives opening and closing the filter panel', () => {
    render(<Harness data={{ options: LIBRARY_OPTIONS }} />);
    open();
    act(() => void fireEvent.click(groupButton(MODALITY_LABELS.mobility, 2)));
    act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.filtersName(0) })));
    act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.filtersBack })));
    expect(groupButton(MODALITY_LABELS.mobility, 2).getAttribute('aria-expanded')).toBe('true');
  });
});

describe("Today's program", () => {
  const prescribed = catalogOption('Front Squat');
  const other = catalogOption('Back Squat');

  const renderProgram = (
    program: TodaysProgramForPicker,
    extra?: Partial<{ alreadyIn: { ids: ReadonlySet<string>; label: string } }>,
  ) => {
    render(
      <Harness
        data={{ options: ALL_CATALOG }}
        todaysProgram={program}
        alreadyIn={extra?.alreadyIn}
      />,
    );
    open();
  };
  /** Its disclosure: no count, as before it moved onto the picker's one `Group` (CAT-3 B3-ii). */
  const program = (name: string = COPY.todaysProgram) => screen.queryByRole('button', { name });
  const rows = () => {
    const button = program() ?? program(COPY.todaysProgramAllOnForm);
    return button?.closest('section')?.querySelectorAll('li').length ?? 0;
  };

  it('is OPEN while a prescribed movement is not yet on a card', () => {
    renderProgram({
      ids: [prescribed.publicId, other.publicId],
      onFormIds: new Set([other.publicId]),
    });
    expect(program()?.getAttribute('aria-expanded')).toBe('true');
    expect(program()?.parentElement?.tagName).toBe('H3');
    expect(rows()).toBe(2);
  });

  it('is CLOSED, and says so, once every prescribed movement is on a card', () => {
    renderProgram({
      ids: [prescribed.publicId, other.publicId],
      onFormIds: new Set([prescribed.publicId, other.publicId]),
    });
    expect(program(COPY.todaysProgramAllOnForm)?.getAttribute('aria-expanded')).toBe('false');
    expect(rows()).toBe(0);
  });

  it('still lists EVERY prescribed row when closed — a second card is one tap away', () => {
    renderProgram({
      ids: [prescribed.publicId, other.publicId],
      onFormIds: new Set([prescribed.publicId, other.publicId]),
    });
    act(() => void fireEvent.click(program(COPY.todaysProgramAllOnForm)!));
    expect(program(COPY.todaysProgramAllOnForm)?.getAttribute('aria-expanded')).toBe('true');
    expect(rows()).toBe(2);
  });

  it('is absent with `alreadyIn` — D2 edits a workout and has no "today"', () => {
    renderProgram(
      { ids: [prescribed.publicId], onFormIds: new Set() },
      { alreadyIn: { ids: new Set(), label: 'Strength A' } },
    );
    expect(program()).toBeNull();
  });

  it('🔴 drops a prescribed id with no matching option, before deciding open/closed', () => {
    // Otherwise the section opens over a row it cannot render. Reachable when a prescription
    // names a movement outside the picker map, or a household row that fell off Decision 5's list.
    renderProgram({ ids: ['no-such-option-id'], onFormIds: new Set() });
    expect(program()).toBeNull();
  });

  it('single mode: the current row does not open it once all of it is on a card', () => {
    // Only a multi-mode tick latches it: the current row's card is already there.
    render(
      <Harness
        data={{ options: ALL_CATALOG }}
        todaysProgram={{ ids: [prescribed.publicId], onFormIds: new Set([prescribed.publicId]) }}
        currentId={prescribed.publicId}
      />,
    );
    open();
    expect(program(COPY.todaysProgramAllOnForm)?.getAttribute('aria-expanded')).toBe('false');
  });

  /** Multi mode with the sheet open and the selection and program set as props, for a rerender. */
  function ArrivalHarness({
    program: today,
    selected = [prescribed.publicId],
  }: {
    program?: TodaysProgramForPicker;
    selected?: readonly string[];
  }) {
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <main>
        <button ref={ref} type="button">
          Open
        </button>
        <MovementPicker
          open
          onOpenChange={vi.fn()}
          title="Add items"
          data={{ options: ALL_CATALOG }}
          todaysProgram={today}
          returnFocusTo={ref}
          multiple={{
            selected,
            onToggle: vi.fn(),
            onCreate: vi.fn(),
            createLabel: (typed) => (typed ? `New item: ${typed}` : '+ New item'),
            noMatchHint: 'No item matches.',
            searchLabel: 'Search items',
            searchPlaceholder: 'Search items',
            footerAction: <button type="button">Add</button>,
          }}
        />
      </main>
    );
  }

  it('🔴 opens for a ticked row whose program arrives after the tick was seeded', () => {
    const { rerender } = render(<ArrivalHarness />);
    rerender(
      <ArrivalHarness
        program={{ ids: [prescribed.publicId], onFormIds: new Set([prescribed.publicId]) }}
      />,
    );
    expect(program(COPY.todaysProgramAllOnForm)?.getAttribute('aria-expanded')).toBe('true');
  });

  it('🔴 a tick latches it: unticking a row already on another card does not fold it', () => {
    // The row was on a card before the tick, so all of it stays on the form throughout.
    const allOn = { ids: [prescribed.publicId], onFormIds: new Set([prescribed.publicId]) };
    const { rerender } = render(<ArrivalHarness program={allOn} selected={[]} />);
    expect(program(COPY.todaysProgramAllOnForm)?.getAttribute('aria-expanded')).toBe('false');
    rerender(<ArrivalHarness program={allOn} selected={[prescribed.publicId]} />);
    expect(program(COPY.todaysProgramAllOnForm)?.getAttribute('aria-expanded')).toBe('true');
    rerender(<ArrivalHarness program={allOn} selected={[]} />);
    expect(program(COPY.todaysProgramAllOnForm)?.getAttribute('aria-expanded')).toBe('true');
  });

  /** Multi mode, the caller's toggle putting each ticked row on a card, as the item picker does. */
  function ProgramHarness() {
    const [isOpen, setOpen] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <main>
        <button ref={ref} type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <MovementPicker
          open={isOpen}
          onOpenChange={setOpen}
          title="Add items"
          data={{ options: ALL_CATALOG }}
          todaysProgram={{ ids: [prescribed.publicId], onFormIds: new Set(selected) }}
          returnFocusTo={ref}
          multiple={{
            selected,
            onToggle: (option) =>
              setSelected((all) =>
                all.includes(option.publicId)
                  ? all.filter((id) => id !== option.publicId)
                  : [...all, option.publicId],
              ),
            onCreate: vi.fn(),
            createLabel: (typed) => (typed ? `New item: ${typed}` : '+ New item'),
            noMatchHint: 'No item matches.',
            searchLabel: 'Search items',
            searchPlaceholder: 'Search items',
            footerAction: <button type="button">Add</button>,
          }}
        />
      </main>
    );
  }

  it('🔴 a tick in it keeps it open though every row is now on a card, and so does the untick', () => {
    render(<ProgramHarness />);
    open();
    const box = () =>
      within(
        program()?.closest('section') ?? program(COPY.todaysProgramAllOnForm)!.closest('section')!,
      ).queryByRole('checkbox', { name: /^Front Squat\b/ });
    act(() => void fireEvent.click(box()!));
    // The heading now says all of it is added, and the section stays open under the thumb.
    expect(program(COPY.todaysProgramAllOnForm)?.getAttribute('aria-expanded')).toBe('true');
    act(() => void fireEvent.click(box()!));
    expect(program()?.getAttribute('aria-expanded')).toBe('true');
    expect(box()?.getAttribute('aria-checked')).toBe('false');
  });
});

describe('one tag per row, by precedence', () => {
  const squat = catalogOption('Front Squat');
  const tagsFor = (name: string) => {
    const row = screen.getAllByRole('button').find((b) => b.textContent?.startsWith(name));
    return row?.querySelector('[data-row-tag]')?.textContent ?? null;
  };

  it('`already in` outranks everything', () => {
    render(
      <Harness
        data={{ options: ALL_CATALOG }}
        alreadyIn={{ ids: new Set([squat.publicId]), label: 'Strength A' }}
        currentId={squat.publicId}
      />,
    );
    open();
    expect(tagsFor('Front Squat')).toBe(COPY.tagAlreadyIn('Strength A'));
  });

  it('`also called` fires only on an ALIAS HIT, and names the alias that hit', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('rdl');
    expect(tagsFor('Romanian Deadlift')).toBe(COPY.tagAlsoCalled('RDL'));
  });

  it('…and NOT for an aliased row reached another way', () => {
    // The gap the panel found: an unconditional `also called` would tag every aliased row in search
    // results, against UX1 8.
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('romanian');
    expect(tagsFor('Romanian Deadlift')).toBeNull();
  });

  it("`current` marks the card's movement in the browse list", () => {
    render(<Harness data={{ options: ALL_CATALOG }} currentId={squat.publicId} />);
    open();
    expect(tagsFor('Front Squat')).toBe(COPY.tagCurrent);
  });

  it("no row carries a group tag, browsing or searching: the second line is P14's alone (P12)", () => {
    // On Romanian Deadlift, which carries a legacy `group`, so the test cannot pass for want of one.
    const rdl = catalogOption('Romanian Deadlift');
    expect(rdl.owner === 'catalog' && rdl.group).toBeTruthy();
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    expandBrowse();
    expect(tagsFor('Romanian Deadlift')).toBeNull();
    type('romanian deadlift');
    expect(tagsFor('Romanian Deadlift')).toBeNull();
  });

  it('a household item carries no tag: its second line says "Custom item" everywhere (P14)', () => {
    const mine = householdOption('Garage Circuit', 'h-1');
    render(<Harness data={{ options: [...ALL_CATALOG, mine] }} />);
    open();
    const row = () => screen.getByRole('button', { name: /^Garage Circuit/ });
    expect(tagsFor('Garage Circuit')).toBeNull();
    expect(row().textContent).toContain(COPY.customItem);
    type('garage circuit');
    expect(tagsFor('Garage Circuit')).toBeNull();
    expect(row().textContent).toContain(COPY.customItem);
    expect(row().textContent).not.toContain(COPY.emptyEquipment);
  });
});

describe('the status region (criterion 46)', () => {
  it('🔴 is EMPTY on open — the Announcer must mount silent', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    expect(status()).toBe('');
  });

  it('counts matches, singular and plural', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    // `front squat` is an exact hit, so the status carries its reason too — the `{count}. {reason}`
    // shape panel 2 · 2 decided, pinned whole rather than by substring.
    type('front squat');
    expect(status()).toBe(`${COPY.statusCount(1)} ${COPY.statusAlreadyListed('Front Squat')}`);
    // ⚠️ **`toBe`, not `toContain('matches')`** — which was the first draft and is satisfied by
    // "No matches.", so the plural half of a test named "singular and plural" could not fail. The
    // count is written out (3 of Back / Front / Goblet Squat) rather than taken from the rendered
    // rows: an expectation computed from the subject agrees with it by construction.
    type('squat');
    expect(status()).toBe(COPY.statusCount(3));
  });

  it('says No matches, and falls back to the some-words count', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('zzzzz');
    expect(status()).toBe(COPY.statusNoMatches);
    type('farmers walk');
    // Farmer Carry and Walking Lunge, written out.
    expect(status()).toBe(COPY.statusNone(0, 2));
  });

  it('carries the ONE reason "use as typed" is unavailable', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('pullups');
    expect(status()).toContain(COPY.statusAlreadyListed('Pull-Up'));
  });

  it('🔴 the exact reason WINS over an unusable-input reason', () => {
    // The panel's case: `pull-up,` has a comma but folds to an exact hit, so the comma message must
    // never appear — one region, one reason, by precedence.
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('pull-up,');
    expect(status()).toContain(COPY.statusAlreadyListed('Pull-Up'));
    expect(status()).not.toContain(MOVEMENT_NAME_MESSAGES.commaOrLineBreak);
  });
});

describe('"Use as typed"', () => {
  // ⚠️ Matched by the COPY, not a hand-written regex. The label changed from 'Use "X" as typed' to
  // 'Add "X" as a new movement' on the UX review's finding that the button and its hint used two
  // different verbs for one action — and a literal regex here meant six tests went red on a copy
  // change rather than on a behaviour change.
  const asTyped = () =>
    screen.queryAllByRole('button').find((b) => b.textContent === COPY.asTyped(lastTyped)) ?? null;

  it('is offered for a novel name', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('zercher squat');
    expect(asTyped()).not.toBeNull();
  });

  it.each([
    ['pullups', 'an exact hit'],
    ['rdl', 'an alias hit'],
  ])('is WITHHELD for %j (%s)', (query) => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type(query);
    expect(asTyped()).toBeNull();
  });

  it.each([
    ['🙂', MOVEMENT_NAME_MESSAGES.noLetter],
    ['---', MOVEMENT_NAME_MESSAGES.noLetter],
    ['a,b', MOVEMENT_NAME_MESSAGES.commaOrLineBreak],
  ])("is present but aria-disabled for %j, with the schema's reason", (query, message) => {
    // 🔴 The panel's gap 4: `🙂` and `---` FOLD to `''`, so a check on the fold would drop them into
    // browse mode and never show this button at all. The check is on the trimmed RAW text.
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type(query);
    expect(asTyped()?.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(message)).toBeTruthy();
  });

  it('is absent for a whitespace-only query', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('   ');
    expect(asTyped()).toBeNull();
  });

  it('hands the caller a TRIMMED name, and does not write', () => {
    const onPick = vi.fn();
    render(<Harness data={{ options: ALL_CATALOG }} onPick={onPick} />);
    open();
    type('  zercher squat  ');
    act(() => void asTyped()!.click());
    expect(onPick).toHaveBeenCalledWith({ kind: 'typed', name: 'zercher squat' });
  });

  it('does nothing when aria-disabled', () => {
    const onPick = vi.fn();
    render(<Harness data={{ options: ALL_CATALOG }} onPick={onPick} />);
    open();
    type('🙂');
    act(() => void asTyped()!.click());
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('the footer (panel 2 · 7)', () => {
  it('🔴 ALWAYS ends with Close — browsing, matching, and offering to create', () => {
    // The hazard: U0 renders a full-width outline Close when no footer is passed, so a conditional
    // footer swapped Close for an outline "Use as typed" at the SAME thumb position two keystrokes
    // apart — and that button mints a movement nothing can delete until V1-9b.
    //
    // ⚠️ An earlier version ended with `expect(footerButtons).toBeTruthy()` — a FUNCTION REFERENCE,
    // always truthy, so that line asserted nothing and the helper it named was never called. Caught
    // by the reuse review. The loop below is the whole test.
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    let checked = 0;
    for (const query of ['', 'front squat', 'pullups', 'zercher squat', '🙂']) {
      type(query);
      const buttons = screen.getAllByRole('button').map((b) => b.textContent);
      expect(buttons.at(-1), `query: ${JSON.stringify(query)}`).toBe(COPY.close);
      checked += 1;
    }
    // Anti-vacuity: a loop over an empty list passes silently (the `it.each([])` trap this repo
    // already records), so the count is asserted too.
    expect(checked).toBe(5);
  });

  it('…and Close is LAST, not merely present', () => {
    // The precedence IS the hazard: Close existing somewhere while "Use as typed" sits where the
    // thumb expects Close is exactly the state panel 2 · 7 refused.
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('zercher squat');
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const closeAt = labels.lastIndexOf(COPY.close);
    const typedAt = labels.indexOf(COPY.asTyped('zercher squat'));
    expect(typedAt).toBeGreaterThanOrEqual(0);
    expect(closeAt).toBeGreaterThan(typedAt);
  });
});

describe('Enter in the search box (panel 2 · 3)', () => {
  const pressEnter = () => act(() => void fireEvent.keyDown(search(), { key: 'Enter' }));

  it('picks the single match', () => {
    const onPick = vi.fn();
    render(<Harness data={{ options: ALL_CATALOG }} onPick={onPick} />);
    open();
    type('front squat');
    pressEnter();
    expect(onPick).toHaveBeenCalledWith({
      kind: 'existing',
      option: expect.objectContaining({ name: 'Front Squat' }),
    });
  });

  it('picks the alias hit even with several matches', () => {
    const onPick = vi.fn();
    render(<Harness data={{ options: ALL_CATALOG }} onPick={onPick} />);
    open();
    type('rdl');
    pressEnter();
    expect(onPick).toHaveBeenCalledWith({
      kind: 'existing',
      option: expect.objectContaining({ name: 'Romanian Deadlift' }),
    });
  });

  it('🔴 NEVER fires "use as typed" (UX3 N8)', () => {
    const onPick = vi.fn();
    render(<Harness data={{ options: ALL_CATALOG }} onPick={onPick} />);
    open();
    type('zercher squat'); // no match: some-words rows only, and creation
    pressEnter();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('does not pick from `someWords` — they are not matches', () => {
    const onPick = vi.fn();
    render(<Harness data={{ options: ALL_CATALOG }} onPick={onPick} />);
    open();
    type('farmers walk');
    pressEnter();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('resolves TWO exact hits to the first, catalog before household', () => {
    // No seeded pair collides, but a pre-PICK-1 household row whose SLUG differs can share a key:
    // `Pull Ups` slugs to `pull-ups`, not `pull-up`, so Decision 5 does not shadow it and the
    // picker lists both.
    //
    // 🔴 **This fixture is chosen so ONLY the `isCatalog` term can decide, and it is probed.** Two
    // earlier versions could not fail. `Pullups` looked like a collision but `movementNameKey`
    // folds the trailing `s`, so the names differ once folded (`pullup` vs `pull up`) and the
    // alphabetical term picked the catalog row on its own — deleting `isCatalog` left the test
    // green. Reordering the input did not help for the same reason. `Pull Ups` folds to exactly
    // `pull up`, so rank ties, the name term is 0, and with the household row FIRST a stable sort
    // keeps it first unless `isCatalog` fires.
    const onPick = vi.fn();
    render(
      <Harness
        data={{ options: [householdOption('Pull Ups', 'h-dupe'), ...ALL_CATALOG] }}
        onPick={onPick}
      />,
    );
    open();
    type('pull ups');
    pressEnter();
    expect(onPick).toHaveBeenCalledWith({
      kind: 'existing',
      option: expect.objectContaining({ owner: 'catalog', name: 'Pull-Up' }),
    });
  });
});

describe('the rest of the contract', () => {
  it('marks the current movement with aria-current, and does not also announce its tag', () => {
    const squat = catalogOption('Front Squat');
    render(<Harness data={{ options: ALL_CATALOG }} currentId={squat.publicId} />);
    open();
    const row = screen.getAllByRole('button').find((b) => b.textContent?.startsWith('Front Squat'));
    expect(row?.getAttribute('aria-current')).toBe('true');
    // The `current` tag is VISIBLE (a sighted user needs the cue) and hidden from assistive tech,
    // which `aria-current` has already told. Without this the row reads "Front Squat, current,
    // current" — the UX review of the built component found it.
    const tag = [...(row?.querySelectorAll('span') ?? [])].find(
      (s) => s.textContent === COPY.tagCurrent,
    );
    expect(tag?.getAttribute('aria-hidden')).toBe('true');
  });

  it('resets the query when reopened', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('front squat');
    expect((search() as HTMLInputElement).value).toBe('front squat');
    act(() => void screen.getAllByRole('button', { name: COPY.close })[0]!.click());
    open();
    expect((search() as HTMLInputElement).value).toBe('');
  });

  it('every option row is a real button in a list item', () => {
    // Semantic HTML is required (AGENTS.md): `ul`/`li`/`button`, never a clickable div, and no
    // `listbox`/`option` — this is a list of actions, not a select.
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    expandBrowse();
    // A row's pick control is a button in its list item (beside "How to", when the row has it),
    // and no button sits inside another.
    const items = document.querySelectorAll('section ul > li > div > button:first-child');
    expect(items.length).toBeGreaterThan(30);
    expect(document.querySelector('button button')).toBeNull();
    expect(document.querySelector('[role="listbox"], [role="option"]')).toBeNull();
  });

  it('🔴 imports no Server Action and no `app/` module — it CANNOT write', () => {
    // A source scan, because this is the property that makes the component reusable by D2's editor
    // (criterion 34) and it is invisible to any behavioural test.
    // ⚠️ A cwd-relative path, not `new URL(..., import.meta.url)` — under jsdom `import.meta.url` is
    // not a `file:` URL and `readFileSync` throws "The URL must be of scheme file". If the cwd ever
    // moves, this throws rather than passing vacuously, which is the right failure.
    const source = readFileSync('components/movements/movement-picker.tsx', 'utf8');
    expect(source).not.toMatch(/'use server'/);
    expect(source).not.toMatch(/from '@\/app\//);
    // ⚠️ …and the RELATIVE form, which the alias pattern does not catch. `from '../../app/actions'`
    // imports exactly the thing this test exists to forbid and passed the scan.
    expect(source).not.toMatch(/from '[^']*\/app\//);
    expect(source).not.toMatch(/\baction=/);
  });

  it('a movement option carries no magnitude', () => {
    const option = catalogOption('Front Squat');
    // 🔴 **The suppression IS the assertion.** A DECLARATION is not a prescription
    // (strength-logging invariant 1, AGENTS.md's one inviolable product rule). If
    // `MovementOptionDTO` ever gains `load`, the directive below goes UNUSED and `tsc` fails — so it
    // pins the absence, and deleting it removes a guard rather than silencing one. The plan mandates
    // it here (Decision 5). `hold-the-bar` flags the string either way; justified in the PR.
    // @ts-expect-error — `load` must not exist on a movement option.
    void option.load;
    expect(option.unitDefault === null || typeof option.unitDefault === 'string').toBe(true);
  });

  it('a movement option says how it is tracked, and a pick hands that on', () => {
    // FAM-1 step 0b. The tracking type is a declaration too (which fields a card has), never a
    // number, so it rides on the option the picker already returns.
    const onPick = vi.fn();
    const squat = catalogOption('Front Squat');
    render(<Harness data={{ options: [squat] }} onPick={onPick} />);
    open();
    const row = screen.getAllByRole('button').find((b) => b.textContent?.startsWith(squat.name));
    act(() => void fireEvent.click(row!));

    expect(onPick).toHaveBeenCalledWith({
      kind: 'existing',
      option: expect.objectContaining({ trackingType: TRACKING_TYPE.weight_reps }),
    });
  });
});

// ── Multi-select (FAM-1 step 9: the program builder's item picker) ────────────────────────────────
describe('multi-select', () => {
  function MultiHarness({
    data,
    takeover = null,
    notice,
    onCreate = vi.fn(),
  }: {
    data: MovementPickerData;
    takeover?: { body: React.ReactNode; footer: React.ReactNode } | null;
    notice?: string;
    onCreate?: (typed: string) => void;
  }) {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <main>
        <button ref={ref} type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <MovementPicker
          open={open}
          onOpenChange={setOpen}
          title="Add items"
          data={data}
          returnFocusTo={ref}
          multiple={{
            selected,
            onToggle: (option) =>
              setSelected((all) =>
                all.includes(option.publicId)
                  ? all.filter((id) => id !== option.publicId)
                  : [...all, option.publicId],
              ),
            onCreate,
            createLabel: (typed) => (typed ? `New item: ${typed}` : '+ New item'),
            noMatchHint: 'No item matches.',
            searchLabel: 'Search items',
            searchPlaceholder: 'Search items',
            footerAction: <button type="button">Add {selected.length}</button>,
            footerNote: <p>the picks so far</p>,
            notice,
            takeover,
          }}
        />
      </main>
    );
  }
  const data = { options: ALL_CATALOG };
  const box = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) });

  it('a row is a checkbox that toggles and keeps the sheet open', () => {
    render(<MultiHarness data={data} />);
    open();
    expandBrowse();
    fireEvent.click(box('Romanian Deadlift'));
    expect(box('Romanian Deadlift').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(box('Romanian Deadlift'));
    expect(box('Romanian Deadlift').getAttribute('aria-checked')).toBe('false');
  });

  it('Enter selects the one match (never deselects, never creates) and clears the search', () => {
    const onCreate = vi.fn();
    render(<MultiHarness data={data} onCreate={onCreate} />);
    open();
    type('rdl', 'Search items');
    fireEvent.keyDown(search('Search items'), { key: 'Enter' });
    expect((search('Search items') as HTMLInputElement).value).toBe('');
    expect(box('Romanian Deadlift').getAttribute('aria-checked')).toBe('true');
    type('rdl', 'Search items');
    fireEvent.keyDown(search('Search items'), { key: 'Enter' });
    expect(box('Romanian Deadlift').getAttribute('aria-checked')).toBe('true');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('an alias hit offers no create: "RDL" is Romanian Deadlift', () => {
    render(<MultiHarness data={data} />);
    open();
    type('RDL', 'Search items');
    expect(screen.queryByRole('button', { name: /^New item/ })).toBeNull();
    expect(status()).toContain(COPY.statusAlreadyListed('Romanian Deadlift'));
  });

  it('create sits at the top of the list, names the text, and hands it over', () => {
    const onCreate = vi.fn();
    render(<MultiHarness data={data} onCreate={onCreate} />);
    open();
    expect(screen.getByRole('button', { name: '+ New item' })).toBeTruthy();
    type('Bear crawl', 'Search items');
    expect(screen.getByText('No item matches.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New item: Bear crawl' }));
    expect(onCreate).toHaveBeenCalledWith('Bear crawl');
  });

  it('the caller’s action sits beside Close, which stays last, with its note above both', () => {
    render(<MultiHarness data={data} />);
    open();
    const row = screen.getByRole('button', { name: 'Add 0' }).parentElement!;
    // One row: the caller's action, then Close.
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Add 0',
      'Close',
    ]);
    const note = screen.getByText('the picks so far');
    expect(note.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a notice takes the status region; a takeover replaces search and list', () => {
    render(
      <MultiHarness
        data={data}
        notice="Bear crawl created and selected."
        takeover={{ body: <p>the form</p>, footer: <button type="button">Create</button> }}
      />,
    );
    open();
    expect(status()).toBe('Bear crawl created and selected.');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText('the form')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('a similar name is named under the create button, which stays quiet (CAT-3 P5)', () => {
    render(<MultiHarness data={data} />);
    open();
    type('bulgarain', 'Search items');
    const create = screen.getByRole('button', { name: 'New item: bulgarain' });
    const hint = document.getElementById(create.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(COPY.similarListed('Bulgarian Split Squat', 'below'));
    expect(create.getAttribute('data-variant')).toBe('ghost');
    expect(box('Bulgarian Split Squat')).toBeTruthy();
    // Enter selects nothing: a similar name is a guess (P5).
    fireEvent.keyDown(search('Search items'), { key: 'Enter' });
    expect(box('Bulgarian Split Squat').getAttribute('aria-checked')).toBe('false');
  });

  it('a short form that spells a movement offers no "New item", and Enter ticks it (C30)', () => {
    render(<MultiHarness data={data} />);
    open();
    type('bb curl', 'Search items');
    expect(screen.queryByRole('button', { name: 'New item: bb curl' })).toBeNull();
    fireEvent.keyDown(search('Search items'), { key: 'Enter' });
    expect(box('Barbell Curls').getAttribute('aria-checked')).toBe('true');
  });

  it('a similar name that is already ticked is not named: tapping it would untick it', () => {
    render(<MultiHarness data={data} />);
    open();
    type('bulgarian', 'Search items');
    fireEvent.click(box('Bulgarian Split Squat'));
    type('bulgarain', 'Search items');
    expect(box('Bulgarian Split Squat').getAttribute('aria-checked')).toBe('true');
    const create = screen.getByRole('button', { name: 'New item: bulgarain' });
    expect(create.getAttribute('aria-describedby')).toBeNull();
  });

  it('several some-words rows name no movement under the create button', () => {
    render(<MultiHarness data={data} />);
    open();
    // No near miss (no `z…` word), three some-words rows: none of them is "the one".
    type('zercher squat', 'Search items');
    const create = screen.getByRole('button', { name: 'New item: zercher squat' });
    expect(create.getAttribute('aria-describedby')).toBeNull();
    expect(create.getAttribute('data-variant')).toBe('ghost');
  });
});

/**
 * The picker's own modules, read as source, comments out (the shared scans' `code()` convention).
 * ⚠️ cwd-relative paths, as in the scan above: under jsdom `import.meta.url` is not a `file:` URL.
 */
const PICKER_DIRS = ['components/movements', 'lib/movements'];
const pickerSources = () =>
  PICKER_DIRS.flatMap((dir) =>
    // Recursive: a later chunk's subfolder (B2's filters) is scanned too.
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => {
        const path = `${dir}/${f}`;
        const source = readFileSync(path, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
        return { path, source };
      }),
  );

describe('search (CAT-3 B1: short forms and similar names)', () => {
  it('🔴 a short form that spells a movement IS that movement: "bb curl" is Barbell Curls (P1, C30)', () => {
    const onPick = vi.fn();
    render(<Harness data={{ options: ALL_CATALOG }} onPick={onPick} />);
    open();
    type('bb curl');
    expect(headings()).toEqual([COPY.matches]);
    // Withheld, as an exact name or alias is: the server's `existingItem` reads the same signal.
    expect(screen.queryByRole('button', { name: COPY.asTyped('bb curl') })).toBeNull();
    expect(status()).toBe(`${COPY.statusCount(1)} ${COPY.statusAlreadyListed('Barbell Curls')}`);
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({
      kind: 'existing',
      option: expect.objectContaining({ name: 'Barbell Curls' }),
    });
  });

  it('a short form alone that spells no movement lists the match and still offers "use as typed"', () => {
    // `KB` was an alias until B1 retired it (P3): `kb` now finds KB Swings by its own name only.
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('kb');
    expect(screen.getByRole('button', { name: /^KB Swings/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.asTyped('kb') })).toBeTruthy();
  });

  it('🔴 a row found through part of another name says "also called", and Enter does not pick it (P5, P17)', () => {
    const onPick = vi.fn();
    const ohp = { ...catalogOption('Overhead Shoulder Press'), aliases: ['Military press'] };
    const options = ALL_CATALOG.map((o) => (o.publicId === ohp.publicId ? ohp : o));
    render(<Harness data={{ options }} onPick={onPick} />);
    open();
    type('military');
    const row = screen.getByRole('button', { name: /^Overhead Shoulder Press/ });
    expect(row.textContent).toContain(COPY.tagAlsoCalled('Military press'));
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('🔴 the list names, withholds and picks exactly what listedAs (existingItem) names', () => {
    // One rule in two places: the list reads it off its search result, the item form and the
    // server through existingItem. This holds them to one answer, a household "RDL" included (C30:
    // an own name outranks another movement's alias).
    // Two lists: the catalog alone (`rdl` is an ALIAS hit there), and with a household item named
    // `RDL` (an exact NAME hit, which wins): each branch of the rule is exercised.
    const withHousehold = [householdOption('RDL', HOUSEHOLD_RDL_ID), ...ALL_CATALOG];
    const queries = ['rdl', 'RDL', 'bb curl', 'front squat', 'kb', 'db bench', 'bulgarain'];
    for (const [options, query] of [ALL_CATALOG, withHousehold].flatMap((opts) =>
      queries.map((q) => [opts, q] as const),
    )) {
      const onPick = vi.fn();
      render(<Harness data={{ options }} onPick={onPick} />);
      open();
      type(query);
      const expected = listedAs(options, query);
      if (expected) {
        expect(status(), query).toContain(COPY.statusAlreadyListed(expected.name));
        expect(screen.queryByRole('button', { name: COPY.asTyped(query) }), query).toBeNull();
        fireEvent.keyDown(search(), { key: 'Enter' });
        expect(onPick.mock.calls[0]?.[0], query).toMatchObject({
          kind: 'existing',
          option: { publicId: expected.publicId },
        });
      } else {
        expect(status(), query).not.toMatch(/Already in the list/);
      }
      cleanup();
    }
    // Non-vacuity: the household row wins `RDL`, and `db bench` names nothing.
    expect(listedAs(withHousehold, 'RDL')?.publicId).toBe(HOUSEHOLD_RDL_ID);
    expect(listedAs(ALL_CATALOG, 'rdl')?.name).toBe('Romanian Deadlift');
    expect(listedAs(ALL_CATALOG, 'db bench')).toBeUndefined();
  });

  it('Enter picks the one match a short form finds: "db bench" is Dumbbell Bench Press', () => {
    const onPick = vi.fn();
    render(<Harness data={{ options: ALL_CATALOG }} onPick={onPick} />);
    open();
    type('db bench');
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({
      kind: 'existing',
      option: expect.objectContaining({ name: 'Dumbbell Bench Press' }),
    });
  });

  it("listedAs is the server's existingItem: name, alias, or what a short form spells", () => {
    expect(listedAs(ALL_CATALOG, 'romanian deadlift')?.name).toBe('Romanian Deadlift');
    expect(listedAs(ALL_CATALOG, 'rdl')?.name).toBe('Romanian Deadlift');
    expect(listedAs(ALL_CATALOG, 'bb curl')?.name).toBe('Barbell Curls');
    expect(listedAs(ALL_CATALOG, 'kb')).toBeUndefined();
    expect(listedAs(ALL_CATALOG, 'bulgarain')).toBeUndefined();
  });

  it('a misspelling lists the similar names, and the status counts them (P4, P5)', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('bulgarain');
    expect(headings()).toEqual([COPY.near]);
    expect(screen.getByRole('button', { name: /^Bulgarian Split Squat/ })).toBeTruthy();
    expect(status()).toBe(COPY.statusNone(1, 0));
  });

  it('🔴 similar names come first, and a row in both lists is shown and counted once (P5)', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    // `squat` alone matches three; with the misspelt word, none match. Bulgarian Split Squat is a
    // similar name AND matches "squat": it shows under Similar names only.
    type('bulgarain squat');
    expect(headings()).toEqual([COPY.near, COPY.someWords]);
    expect(screen.getAllByRole('button', { name: /^Bulgarian Split Squat/ })).toHaveLength(1);
    const [near, some] = screen.getAllByRole('region');
    expect(near!.textContent).toContain('Bulgarian Split Squat');
    expect(some!.textContent).not.toContain('Bulgarian Split Squat');
    // Written out, not counted from the rows: Back Squat and Front Squat.
    expect(status()).toBe(COPY.statusNone(1, 2));
  });

  it('🔴 Enter never picks a similar name (P5)', () => {
    const onPick = vi.fn();
    render(<Harness data={{ options: ALL_CATALOG }} onPick={onPick} />);
    open();
    type('bulgarain');
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('on a touch screen, Enter over listed rows puts the keyboard away; over nothing it does not', () => {
    // jsdom has no `matchMedia`, so the picker takes the coarse-pointer path here.
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('bulgarain');
    act(() => search().focus());
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(document.activeElement).not.toBe(search());
    expect(screen.getByRole('dialog')).toBeTruthy();
    type('zzzzz');
    act(() => search().focus());
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(document.activeElement).toBe(search());
  });

  it('"use as typed" stays offered, and its hint names the similar movement first (P5)', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('bulgarain');
    const create = screen.getByRole('button', { name: COPY.asTyped('bulgarain') });
    const hint = () => document.getElementById(create.getAttribute('aria-describedby') ?? '');
    expect(hint()?.textContent).toBe(COPY.asTypedHintNear('Bulgarian Split Squat', 'bulgarain'));
    // Quiet while something is listed: the loud one is for a list with nothing in it (UX2 B1).
    expect(create.getAttribute('data-variant')).toBe('ghost');
    type('zzzzz');
    expect(
      screen.getByRole('button', { name: COPY.asTyped('zzzzz') }).getAttribute('data-variant'),
    ).toBe('outline');
  });

  it('several some-words rows name no movement in the hint: plain warning only', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('zercher squat');
    const create = screen.getByRole('button', { name: COPY.asTyped('zercher squat') });
    const hint = document.getElementById(create.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(COPY.asTypedHint('zercher squat'));
  });

  it('🔴 the picker sends the query nowhere itself (P6): imports, network, URL, storage, logs', () => {
    // P6 says the query never leaves the device. The picker keeps it in its own state; what it hands
    // its callers is `createLabel` (every render: the caller's own words, pure) and, on a tap, a
    // deliberate create (`onCreate`, `onPick({ kind: 'typed' })`). The caller's side is
    // `item-picker.test.tsx`'s. ⚠️ Holds while the app has no browser Sentry: a client init must
    // keep Replay off or `maskAllInputs` on.
    const sources = pickerSources();
    expect(sources.map((s) => s.path)).toContain('components/movements/movement-picker.tsx');
    // An allowlist, so an import that could send the text (a Server Action, a helper that does)
    // fails here and forces the question, which a list of banned names never does.
    const ALLOWED = new Set([
      'react',
      '@mat-plan/shared',
      '@/components/ui/button',
      '@/components/ui/sheet',
      // The filter panel (B2-ii): scanned here too, as a file of this folder.
      '@/components/movements/movement-filter-panel',
      '@/lib/constants',
      '@/lib/utils',
      '@/lib/i18n/plural',
      '@/lib/i18n/locale',
      '@/lib/movements/movement-option',
      '@/lib/movements/movement-picker-copy',
      // The browse tree's view model (CAT-3 B3): pure, no DOM.
      '@/lib/movements/browse-view',
      // The disclosure's chevron (CAT-3 B3): an icon, no I/O.
      'lucide-react',
    ]);
    for (const { path, source } of sources) {
      const specifiers = [
        ...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g),
      ].map((m) => m[1] ?? m[2]);
      expect(
        specifiers.filter((spec) => !ALLOWED.has(spec!)),
        path,
      ).toEqual([]);
      for (const leak of [
        /'use server'/,
        /\bfetch\(/,
        /\bconsole\./,
        /\buseRouter\b|\buseSearchParams\b|\busePathname\b/,
        /\bwindow\.(?:location|history)\b|\bhistory\.(?:push|replace)State\b/,
        /\b(?:local|session)Storage\b|\bindexedDB\b|\bdocument\.cookie\b/,
        /\bnavigator\.sendBeacon\b|\bXMLHttpRequest\b|\bWebSocket\b/,
        /\bSentry\b|@sentry\//,
        /new RegExp\(/,
      ])
        expect(source, `${path}: ${String(leak)}`).not.toMatch(leak);
    }
    // The callback that fires on every keystroke is handed nothing.
    const picker = sources.find((s) => s.path.endsWith('movement-picker.tsx'))!.source;
    expect(picker).toMatch(/onQueryChange\?\.\(\)/);
    expect(picker).not.toMatch(/onQueryChange\?\.\([^)]/);
  });
});

describe('the row: its second line, supervision label and "How to" (CAT-3 B2-i: P13, P14, P16)', () => {
  // The sheet pops its history entry on close, and in jsdom that popstate lands in a LATER test and
  // closes its sheet; these tests await, so it arrives. Stubbed as item-picker.test.tsx does.
  beforeEach(stubSheetHistory);

  const SQUAT = catalogOption('Back Squat', {
    equipment: [EQUIPMENT_CODE.barbell, EQUIPMENT_CODE.bench],
  });
  const PUSH_UPS = catalogOption('Push-Ups', { equipment: [] });
  const ROPE = catalogOption('Pull-Up', {
    equipment: [EQUIPMENT_CODE.pull_up_bar],
    supervision: SUPERVISION_KIND.coach,
    hasInstructions: true,
  });
  const MINE = householdOption('Garage Circuit', 'h-1');
  const STEPS: CatalogHowTo = {
    name: 'Pull-Up',
    instructions: 'Hang from the bar.\nPull up until your chin is over it.',
    supervision: SUPERVISION_KIND.coach,
  };

  type Loader = (publicId: string) => Promise<CatalogHowTo | null>;
  function RowHarness({
    howTo,
    multi = false,
    options = [SQUAT, PUSH_UPS, ROPE, MINE],
    recentIds,
    notice,
    currentId,
  }: {
    howTo?: Loader;
    multi?: boolean;
    options?: readonly MovementOptionDTO[];
    recentIds?: readonly string[];
    notice?: string;
    currentId?: string;
  }) {
    const [isOpen, setOpen] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const ref = useRef<HTMLButtonElement>(null);
    const common = {
      open: isOpen,
      onOpenChange: setOpen,
      title: COPY.title,
      data: { options, recentIds },
      returnFocusTo: ref,
      howTo,
    };
    return (
      <main>
        <button ref={ref} type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        {multi ? (
          <MovementPicker
            {...common}
            multiple={{
              selected,
              onToggle: (option) => setSelected((all) => [...all, option.publicId]),
              onCreate: vi.fn(),
              createLabel: (typed) => (typed ? `New item: ${typed}` : '+ New item'),
              noMatchHint: 'No item matches.',
              searchLabel: 'Search items',
              searchPlaceholder: 'Search items',
              footerAction: <button type="button">Add</button>,
              notice,
            }}
          />
        ) : (
          <MovementPicker {...common} onPick={vi.fn()} currentId={currentId} />
        )}
      </main>
    );
  }
  /** A row's pick control (a button, or a checkbox in multi mode), by the name it starts with. */
  const row = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('li > div > button:first-child')].find((b) =>
      b.textContent?.startsWith(name),
    )!;

  it("a row's accessible name reads its parts apart: name, label, second line", () => {
    render(<RowHarness />);
    open();
    expect(
      screen.getByRole('button', {
        // jsdom's name computation drops the separator's spaces; a browser keeps them.
        name: `Pull-Up,${SUPERVISION_LABELS.coach},${TRACKING_TYPE_LABELS.weight_reps} · Pull-up bar`,
      }),
    ).toBeTruthy();
  });
  const howToButton = (name: string) => screen.queryByRole('button', { name: COPY.howToFor(name) });

  /**
   * ⏳ An old built-in the library has no entry for (7a-ii, until CAT-3 chunk R): the seeded row with
   * its browse group, and none of the taxonomy's keys.
   */
  const BARE = withoutLibraryData(catalogOption('Back Squat'));

  it('⏳ a built-in without library data says only how it is logged: no equipment, no label, no "How to" (7a-ii)', () => {
    for (const multi of [false, true]) {
      render(<RowHarness multi={multi} options={[BARE, ROPE]} howTo={vi.fn(async () => STEPS)} />);
      open();
      expandBrowse();
      const text = row('Back Squat').textContent ?? '';
      expect(text, `multi=${multi}`).toBe(`Back Squat, ${TRACKING_TYPE_LABELS.weight_reps}`);
      expect(text).not.toContain(COPY.emptyEquipment);
      expect(text).not.toContain(SUPERVISION_LABELS.coach);
      expect(howToButton('Back Squat')).toBeNull();
      // The row beside it still has its library data, so the loader is wired.
      expect(howToButton('Pull-Up')).toBeTruthy();
      cleanup();
    }
  });

  it('hasLibraryData: a library row, even one needing no equipment; never a bare built-in or a custom item', () => {
    expect(hasLibraryData(PUSH_UPS)).toBe(true);
    expect(hasLibraryData(SQUAT)).toBe(true);
    expect(hasLibraryData(BARE)).toBe(false);
    expect(hasLibraryData(MINE)).toBe(false);
  });

  it('says how each row is logged and what it needs, in both modes; a custom item never says "No equipment" (P14)', () => {
    for (const multi of [false, true]) {
      render(<RowHarness multi={multi} />);
      open();
      expect(row('Back Squat').textContent, `multi=${multi}`).toContain(
        `${TRACKING_TYPE_LABELS.weight_reps} · Barbell, Bench`,
      );
      expect(row('Push-Ups').textContent).toContain(`· ${COPY.emptyEquipment}`);
      expect(row('Garage Circuit').textContent).toContain(`· ${COPY.customItem}`);
      expect(row('Garage Circuit').textContent).not.toContain(COPY.emptyEquipment);
      cleanup();
    }
  });

  it('the supervision label is never dropped for a tag: both show (P13)', () => {
    render(<RowHarness currentId={ROPE.publicId} />);
    open();
    expect(row('Pull-Up').textContent).toContain(SUPERVISION_LABELS.coach);
    expect(row('Pull-Up').querySelector('[data-row-tag]')?.textContent).toBe(COPY.tagCurrent);
  });

  it('shows the supervision label as text on its row, in both modes, at full contrast (P13)', () => {
    for (const multi of [false, true]) {
      render(<RowHarness multi={multi} />);
      open();
      const label = [...row('Pull-Up').querySelectorAll('span')].find(
        (span) => span.textContent === SUPERVISION_LABELS.coach,
      );
      expect(label, `multi=${multi}`).toBeTruthy();
      expect(label!.className).toContain('text-foreground');
      expect(label!.className).not.toContain('text-muted-foreground');
      expect(row('Back Squat').textContent).not.toContain(SUPERVISION_LABELS.coach);
      cleanup();
    }
  });

  it('in multi mode the box comes before the name, so ticks line up whatever the row holds', () => {
    render(<RowHarness multi howTo={vi.fn(async () => STEPS)} />);
    open();
    const pick = row('Pull-Up');
    const box = pick.querySelector('[aria-hidden]');
    expect(pick.firstElementChild).toBe(box);
  });

  it('shows no "How to" without a loader, and only on rows that have instructions with one', () => {
    render(<RowHarness />);
    open();
    expect(howToButton('Pull-Up')).toBeNull();
    cleanup();
    render(<RowHarness howTo={vi.fn(async () => STEPS)} />);
    open();
    expect(howToButton('Pull-Up')).toBeTruthy();
    expect(howToButton('Back Squat')).toBeNull();
    expect(howToButton('Garage Circuit')).toBeNull();
  });

  it('🔴 opens the steps under the row, the supervision label first (K17), and hides them again', async () => {
    const howTo = vi.fn(async () => STEPS);
    render(<RowHarness howTo={howTo} />);
    open();
    const button = howToButton('Pull-Up')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeNull();
    fireEvent.click(button);
    const box = await waitFor(() => {
      const id = button.getAttribute('aria-controls');
      expect(id).toBeTruthy();
      const el = document.getElementById(id!)!;
      expect(el.querySelectorAll('ol > li')).toHaveLength(2);
      return el;
    });
    expect(howTo).toHaveBeenCalledWith(ROPE.publicId);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // The heading, then the supervision label ABOVE the steps (K17), then the steps, then Hide. The
    // row sits under a family's `h5`, so its heading is an `h6`: no level is skipped or repeated.
    expect(button.closest('ul')?.parentElement?.previousElementSibling?.tagName).toBe('H5');
    expect(box.querySelector('h6')?.textContent).toBe(COPY.howToFor('Pull-Up'));
    expect([...box.children].map((el) => el.tagName)).toEqual(['H6', 'P', 'OL', 'BUTTON']);
    expect(box.querySelector('p')?.textContent).toBe(SUPERVISION_LABELS.coach);
    // "Hide" puts focus back on "How to" before its own box goes.
    fireEvent.click(within(box).getByRole('button', { name: COPY.howToHide }));
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('🔴 the label comes from the option, so a loader that leaves it out cannot drop it', async () => {
    render(<RowHarness howTo={vi.fn(async () => ({ ...STEPS, supervision: null }))} />);
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(document.querySelectorAll('ol > li').length).toBe(2));
    const box = document.getElementById(howToButton('Pull-Up')!.getAttribute('aria-controls')!)!;
    expect(box.textContent).toContain(SUPERVISION_LABELS.coach);
  });

  it('no steps yet, and a failed load with a retry that works, said once in the status', async () => {
    const howTo = vi
      .fn<Loader>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(STEPS);
    render(<RowHarness howTo={howTo} />);
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(screen.getByText(COPY.howToFailed)).toBeTruthy());
    expect(status()).toBe(COPY.statusHowToFailed('Pull-Up'));
    fireEvent.click(screen.getByRole('button', { name: COPY.howToRetry }));
    await waitFor(() => expect(document.querySelectorAll('ol > li').length).toBe(2));
    cleanup();
    render(<RowHarness howTo={vi.fn(async () => null)} />);
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(screen.getByText(COPY.howToNone)).toBeTruthy());
    expect(document.querySelector('ol')).toBeNull();
  });

  it('🔴 one row at a time, a late answer for a row no longer open is dropped, and typing closes it', async () => {
    let resolveFirst: (steps: CatalogHowTo) => void = () => {};
    const other = catalogOption('Front Squat', { hasInstructions: true });
    const howTo = vi
      .fn<Loader>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({
        name: 'Front Squat',
        instructions: 'Hold the bar in front.',
        supervision: null,
      });
    render(<RowHarness howTo={howTo} options={[ROPE, other]} />);
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    fireEvent.click(howToButton('Front Squat')!);
    await waitFor(() => expect(screen.getByText('Hold the bar in front.')).toBeTruthy());
    await act(async () => resolveFirst(STEPS));
    expect(howToButton('Pull-Up')!.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Hang from the bar.')).toBeNull();
    type('front');
    expect(howToButton('Front Squat')!.getAttribute('aria-expanded')).toBe('false');
    // Back to the list the box was opened in: typing ended it, so it does not come back.
    type('');
    expect(howToButton('Front Squat')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('🔴 a reopen drops an answer still in flight', async () => {
    let resolve: (steps: CatalogHowTo) => void = () => {};
    render(<RowHarness howTo={vi.fn<Loader>(() => new Promise((r) => (resolve = r)))} />);
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    fireEvent.click(screen.getAllByRole('button', { name: SHEET_COPY.close }).at(-1)!);
    open();
    await act(async () => resolve(STEPS));
    expect(howToButton('Pull-Up')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('a second tap on "How to" closes it, and Enter clearing the search closes it too', async () => {
    render(<RowHarness multi howTo={vi.fn<Loader>(async () => STEPS)} />);
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(document.querySelectorAll('ol > li').length).toBe(2));
    fireEvent.click(howToButton('Pull-Up')!);
    expect(howToButton('Pull-Up')!.getAttribute('aria-expanded')).toBe('false');
    type('pull', 'Search items');
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(document.querySelectorAll('ol > li').length).toBe(2));
    fireEvent.keyDown(search('Search items'), { key: 'Enter' });
    expect(document.querySelector('ol')).toBeNull();
  });

  it('🔴 Enter clearing the search ends a failed How-to: its message does not stay said', async () => {
    render(<RowHarness multi howTo={vi.fn<Loader>().mockRejectedValue(new Error('offline'))} />);
    open();
    type('pull', 'Search items');
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(status()).toBe(COPY.statusHowToFailed('Pull-Up')));
    fireEvent.keyDown(search('Search items'), { key: 'Enter' });
    expect(status()).not.toBe(COPY.statusHowToFailed('Pull-Up'));
  });

  it('🔴 a movement listed twice (Recent and its group) opens ONE box, under the row tapped', async () => {
    render(<RowHarness howTo={vi.fn<Loader>(async () => STEPS)} recentIds={[ROPE.publicId]} />);
    open();
    const copies = screen.getAllByRole('button', { name: COPY.howToFor('Pull-Up') });
    expect(copies).toHaveLength(2);
    fireEvent.click(copies[1]!);
    await waitFor(() => expect(document.querySelectorAll('ol > li').length).toBe(2));
    expect(document.querySelectorAll('[role="region"][aria-labelledby]')).toHaveLength(1);
    expect(copies[0]!.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: COPY.howToHide }));
    expect(document.activeElement).toBe(copies[1]);
  });

  it('🔴 "Try again" keeps focus on "How to", and the failure stays said through the retry', async () => {
    const howTo = vi
      .fn<Loader>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise(() => {}));
    render(<RowHarness howTo={howTo} />);
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    const retry = await screen.findByRole('button', { name: COPY.howToRetry });
    fireEvent.click(retry);
    expect(document.activeElement).toBe(howToButton('Pull-Up'));
    // Not back to the search count while the retry loads (criterion 46: read once).
    expect(status()).toBe(COPY.statusHowToFailed('Pull-Up'));
  });

  it('the failure is said over a standing notice, goes with Hide, and a tick silences it', async () => {
    render(
      <RowHarness
        multi
        notice="Bear crawl made and ticked."
        howTo={vi.fn<Loader>().mockRejectedValue(new Error('offline'))}
      />,
    );
    open();
    expect(status()).toBe('Bear crawl made and ticked.');
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(status()).toBe(COPY.statusHowToFailed('Pull-Up')));
    fireEvent.click(row('Back Squat'));
    expect(status()).toBe('Bear crawl made and ticked.');
    fireEvent.click(howToButton('Pull-Up')!);
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(status()).toBe(COPY.statusHowToFailed('Pull-Up')));
    fireEvent.click(screen.getByRole('button', { name: COPY.howToHide }));
    expect(status()).toBe('Bear crawl made and ticked.');
  });

  it('steps that are all blank read "No steps for this movement yet.", never an empty list', async () => {
    render(
      <RowHarness howTo={vi.fn<Loader>(async () => ({ ...STEPS, instructions: '\n  \n' }))} />,
    );
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(screen.getByText(COPY.howToNone)).toBeTruthy());
    expect(document.querySelector('ol')).toBeNull();
  });

  it('the open box is a region named by its heading, busy while it loads', () => {
    render(<RowHarness howTo={vi.fn<Loader>(() => new Promise(() => {}))} />);
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    const region = screen.getByRole('region', { name: COPY.howToFor('Pull-Up') });
    expect(region.getAttribute('aria-busy')).toBe('true');
  });

  it('with a loader, a row without steps keeps the "How to" column, so rows end at one edge', () => {
    render(<RowHarness howTo={vi.fn<Loader>(async () => STEPS)} />);
    open();
    const spacer = row('Back Squat').parentElement!.lastElementChild!;
    expect(spacer.tagName).toBe('SPAN');
    expect(spacer.getAttribute('aria-hidden')).toBe('true');
    cleanup();
    render(<RowHarness />);
    open();
    expect(row('Back Squat').parentElement!.children).toHaveLength(1);
  });

  it('a library option with no legacy group is found by search and by browsing, with no tag (C0b-2, P12)', () => {
    const { group: _dropped, ...rest } = catalogOption('Pallof Press') as Extract<
      MovementOptionDTO,
      { owner: 'catalog' }
    >;
    void _dropped;
    const ungrouped: MovementOptionDTO = { ...rest, publicId: 'lib-1', name: 'Leg Swing' };
    render(<Harness data={{ options: [...ALL_CATALOG, ungrouped] }} />);
    open();
    expandBrowse();
    expect(screen.getByRole('button', { name: /^Leg Swing/ })).toBeTruthy();
    type('leg swing');
    const found = screen.getByRole('button', { name: /^Leg Swing/ });
    expect(found.querySelector('[data-row-tag]')).toBeNull();
  });

  it('🔴 the same row closed and reopened: the first load failing late does not land over the second', async () => {
    let rejectFirst: (error: Error) => void = () => {};
    const howTo = vi
      .fn<Loader>()
      .mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
      .mockImplementationOnce(() => new Promise(() => {}));
    render(<RowHarness howTo={howTo} />);
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    fireEvent.click(howToButton('Pull-Up')!);
    fireEvent.click(howToButton('Pull-Up')!);
    // Both loads have started (the loader is called a microtask later) before the first fails.
    await waitFor(() => expect(howTo).toHaveBeenCalledTimes(2));
    await act(async () => rejectFirst(new Error('offline')));
    expect(screen.getByText(COPY.howToLoading)).toBeTruthy();
    expect(status()).not.toBe(COPY.statusHowToFailed('Pull-Up'));
  });

  it('a loader that throws instead of rejecting is a failure, not a box loading forever', async () => {
    render(
      <RowHarness
        howTo={vi.fn<Loader>(() => {
          throw new Error('offline');
        })}
      />,
    );
    open();
    fireEvent.click(howToButton('Pull-Up')!);
    await waitFor(() => expect(screen.getByText(COPY.howToFailed)).toBeTruthy());
  });
});
