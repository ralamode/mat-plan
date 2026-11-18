// @vitest-environment jsdom
import {
  EQUIPMENT,
  EQUIPMENT_CODE,
  EQUIPMENT_FILTER_SHOWN_FIRST,
  EQUIPMENT_LABELS,
  MODALITY,
  MUSCLE,
  MUSCLE_LABELS,
  TRACKING_TYPE,
  type CatalogOptionTaxonomy,
  type Equipment,
  type Muscle,
} from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MovementOptionDTO } from '@/lib/movements/movement-option';
import { MOVEMENT_PICKER_COPY as COPY } from '@/lib/movements/movement-picker-copy';

import { MovementPicker } from './movement-picker';

/**
 * The picker's filters (CAT-3 P7 to P10 and P15's announcements; B2-ii). The search's own rules
 * (what passes, what is counted, what Enter picks) are `movement-search.test.ts`'s; this file holds
 * what the SCREEN does with them: the panel, the list under a filter, focus and the one region.
 */

afterEach(cleanup);
// The sheet pops its history entry on close; in jsdom that popstate lands in a later test.
beforeEach(() => {
  window.history.replaceState(null, '');
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
});

const TAXONOMY: CatalogOptionTaxonomy = {
  modality: MODALITY.strength,
  pattern: null,
  equipment: [EQUIPMENT_CODE.barbell],
  primaryMuscle: null,
  secondaryMuscles: [],
  supervision: null,
  hasInstructions: false,
};
let nextId = 0;
const lib = (name: string, equipment: readonly Equipment[], primaryMuscle: Muscle | null) =>
  ({
    publicId: `lib-${(nextId += 1)}`,
    name,
    owner: 'catalog',
    aliases: [],
    unitDefault: null,
    isBodyweight: false,
    trackingType: TRACKING_TYPE.weight_reps,
    ...TAXONOMY,
    equipment,
    primaryMuscle,
  }) satisfies MovementOptionDTO;
const own = (name: string): MovementOptionDTO => ({
  publicId: `own-${(nextId += 1)}`,
  name,
  owner: 'household',
  unitDefault: null,
  isBodyweight: false,
  trackingType: TRACKING_TYPE.weight_reps,
});

const ROW = lib('Barbell Row', [EQUIPMENT_CODE.barbell], MUSCLE.upper_back);
const PULL_UP = lib('Pull-Up', [EQUIPMENT_CODE.pull_up_bar], MUSCLE.lats);
const CHIN_UP = lib('Chin-Up', [EQUIPMENT_CODE.pull_up_bar], MUSCLE.lats);
const PUSH_UPS = lib('Push-Ups', [], MUSCLE.chest);
const GOBLET = lib('Goblet Squat', [EQUIPMENT_CODE.dumbbell], MUSCLE.quadriceps);
const CIRCUIT = own('Garage Circuit');
const PULL_OWN = own('Pull-Up Ladder');
const OPTIONS = [ROW, PULL_UP, CHIN_UP, PUSH_UPS, GOBLET, CIRCUIT, PULL_OWN];

const trigger = () => [...document.querySelectorAll('main > button')].at(-1) as HTMLButtonElement;

function Harness({
  options = OPTIONS,
  multi = false,
  onPick = vi.fn(),
  recentIds,
}: {
  options?: readonly MovementOptionDTO[];
  multi?: boolean;
  onPick?: (picked: unknown) => void;
  recentIds?: readonly string[];
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
            searchLabel: COPY.searchLabel,
            searchPlaceholder: 'Search items',
            footerAction: <button type="button">Add</button>,
          }}
        />
      ) : (
        <MovementPicker {...common} onPick={onPick} />
      )}
    </main>
  );
}

const open = () => act(() => void trigger().click());
const type = (value: string) =>
  act(
    () =>
      void fireEvent.change(document.querySelector('input[type="search"]')!, {
        target: { value },
      }),
  );
const status = () => document.querySelector('[role="status"]')?.textContent ?? '';
const filtersButton = () => screen.getByRole('button', { name: /^Filters, / });
const openPanel = () => act(() => void fireEvent.click(filtersButton()));
const group = (name: string) => screen.getByRole('group', { name });
const choice = (groupName: string, label: string) =>
  within(group(groupName)).getByRole(groupName === COPY.equipmentLegend ? 'radio' : 'checkbox', {
    name: new RegExp(`^${label}, `),
  });
const muscle = (label: string) => choice(COPY.musclesLegend, label);
const tick = (box: HTMLElement) => act(() => void fireEvent.click(box));
const press = (key: string) =>
  act(() => void fireEvent.keyDown(screen.getByRole('dialog'), { key }));
const h3s = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('the Filters control (P15)', () => {
  it('names how many are on, and shows them', () => {
    render(<Harness />);
    open();
    expect(filtersButton().getAttribute('aria-label')).toBe(COPY.filtersName(0));
    expect(filtersButton().textContent).toBe(COPY.filters(0));
    openPanel();
    tick(muscle(MUSCLE_LABELS.lats));
    act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.filtersBack })));
    expect(filtersButton().getAttribute('aria-label')).toBe(COPY.filtersName(1));
    expect(filtersButton().textContent).toBe(COPY.filters(1));
  });

  it('is not shown when no library movement is listed: there is nothing to filter', () => {
    render(<Harness options={[CIRCUIT, PULL_OWN]} />);
    open();
    expect(screen.queryByRole('button', { name: /^Filters, / })).toBeNull();
  });
});

describe('the panel (P7; panel rows 11 to 13, 17)', () => {
  it('replaces the list, focuses its heading, and keeps the search mounted but hidden', () => {
    render(<Harness />);
    open();
    type('pull');
    openPanel();
    const heading = screen.getByRole('heading', { name: COPY.filtersHeading });
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole('searchbox')).toBeNull();
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input.value).toBe('pull');
    expect(screen.queryByRole('checkbox', { name: /^Pull-Up/ })).toBeNull();
  });

  it('"Back to the list" closes it and returns focus to Filters', () => {
    render(<Harness />);
    open();
    openPanel();
    act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.filtersBack })));
    expect(screen.queryByRole('heading', { name: COPY.filtersHeading })).toBeNull();
    expect(document.activeElement).toBe(filtersButton());
  });

  it('🔴 Escape closes the panel only; a second Escape closes the sheet', () => {
    render(<Harness />);
    open();
    openPanel();
    press('Escape');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: COPY.filtersHeading })).toBeNull();
    expect(document.activeElement).toBe(filtersButton());
    press('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says each change once in the sheet\'s ONE region: "Lats on. 2 movements."', () => {
    render(<Harness />);
    open();
    openPanel();
    expect(status()).toBe('');
    tick(muscle(MUSCLE_LABELS.lats));
    expect(status()).toBe(COPY.panelStatus(MUSCLE_LABELS.lats, true, 2));
    tick(muscle(MUSCLE_LABELS.lats));
    expect(status()).toBe(COPY.panelStatus(MUSCLE_LABELS.lats, false, 5));
    tick(choice(COPY.equipmentLegend, COPY.emptyEquipment));
    expect(status()).toBe(COPY.panelStatusChoice(COPY.emptyEquipment, 1));
    expect(document.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
  });

  it('shows each count as digits and says it after the label (row 17)', () => {
    render(<Harness />);
    open();
    openPanel();
    const lats = muscle(MUSCLE_LABELS.lats);
    expect(lats.closest('label')!.textContent).toBe(
      `${MUSCLE_LABELS.lats}, ${COPY.choiceCount(2)}2`,
    );
  });

  it('🔴 greys a choice that would leave nothing, unless it is ticked (P7)', () => {
    render(<Harness />);
    open();
    openPanel();
    expect(muscle(MUSCLE_LABELS.neck)).toHaveProperty('disabled', true);
    expect(muscle(MUSCLE_LABELS.lats)).toHaveProperty('disabled', false);
    // Lats on: Chest alone would still leave Push-Ups, so it stays live (muscles are "any of").
    tick(muscle(MUSCLE_LABELS.lats));
    expect(muscle(MUSCLE_LABELS.chest)).toHaveProperty('disabled', false);
    // "No equipment" with Lats on leaves nothing: greyed.
    expect(choice(COPY.equipmentLegend, COPY.emptyEquipment)).toHaveProperty('disabled', true);
    // A ticked muscle stays live after another choice would empty it, so it can be unticked.
    tick(choice(COPY.equipmentLegend, COPY.equipmentChosen));
    expect(muscle(MUSCLE_LABELS.lats)).toHaveProperty('disabled', false);
  });

  it('the radio hints are described, not crammed into the name', () => {
    render(<Harness />);
    open();
    openPanel();
    const none = choice(COPY.equipmentLegend, COPY.emptyEquipment);
    const hint = document.getElementById(none.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(COPY.equipmentNoneHint);
  });

  it('"Show N movements" closes the panel and counts what will show', () => {
    render(<Harness />);
    open();
    openPanel();
    tick(muscle(MUSCLE_LABELS.lats));
    const show = screen.getByRole('button', { name: COPY.showResults(2, false) });
    act(() => void fireEvent.click(show));
    expect(screen.queryByRole('heading', { name: COPY.filtersHeading })).toBeNull();
    expect(document.activeElement).toBe(filtersButton());
  });

  it('under a query the button counts results, hits and custom items included', () => {
    render(<Harness />);
    open();
    type('pull');
    openPanel();
    tick(muscle(MUSCLE_LABELS.quadriceps));
    // Pull-Up and Chin-Up fail the filter; the custom "Pull-Up Ladder" is shown whatever it says.
    expect(screen.getByRole('button', { name: COPY.showResults(1, true) })).toBeTruthy();
  });

  it('Clear filters: inert with none on; clears, says so and keeps focus in the panel (row 13)', () => {
    render(<Harness />);
    open();
    openPanel();
    const clear = () => screen.getByRole('button', { name: COPY.clearFilters });
    expect(clear().getAttribute('aria-disabled')).toBe('true');
    tick(muscle(MUSCLE_LABELS.lats));
    expect(clear().getAttribute('aria-disabled')).toBeNull();
    act(() => void fireEvent.click(clear()));
    expect(muscle(MUSCLE_LABELS.lats)).toHaveProperty('checked', false);
    expect(status()).toBe(COPY.panelStatusChoice(COPY.filtersCleared, 5));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: COPY.filtersHeading }));
  });
});

describe('equipment items (P7)', () => {
  // Eleven items, the k-th used by (11 - k) movements, so the most-used order is the vocabulary's
  // first eleven and the eleventh sits beyond the first ten.
  const ITEMS = EQUIPMENT.slice(0, EQUIPMENT_FILTER_SHOWN_FIRST + 1);
  const MANY = ITEMS.flatMap((item, k) =>
    Array.from({ length: ITEMS.length - k }, (_, j) => lib(`Drill ${k}-${j}`, [item], null)),
  );
  const items = () =>
    within(group(COPY.equipmentItemsLegend))
      .getAllByRole('checkbox')
      .map((box) => box.closest('label')!.textContent!.split(',')[0]);
  const chosen = () => tick(choice(COPY.equipmentLegend, COPY.equipmentChosen));

  it('are listed only under "Uses at least one of…", ten first, behind a disclosure', () => {
    render(<Harness options={MANY} />);
    open();
    openPanel();
    expect(screen.queryByRole('group', { name: COPY.equipmentItemsLegend })).toBeNull();
    chosen();
    expect(items()).toEqual(
      ITEMS.slice(0, EQUIPMENT_FILTER_SHOWN_FIRST).map((item) => EQUIPMENT_LABELS[item]),
    );
    const more = screen.getByRole('button', { name: COPY.showAllEquipment(EQUIPMENT.length) });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    act(() => void fireEvent.click(more));
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(items()).toHaveLength(EQUIPMENT.length);
  });

  it('a ticked item beyond ten stays listed, and stays after unticking until the panel closes', () => {
    const eleventh = EQUIPMENT_LABELS[ITEMS.at(-1)!];
    render(<Harness options={MANY} />);
    open();
    openPanel();
    chosen();
    act(() => void fireEvent.click(screen.getByRole('button', { name: /^Show all equipment/ })));
    tick(choice(COPY.equipmentItemsLegend, eleventh));
    act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.showFewerEquipment })));
    expect(items()).toContain(eleventh);
    tick(choice(COPY.equipmentItemsLegend, eleventh));
    expect(items()).toContain(eleventh);
    press('Escape');
    openPanel();
    expect(items()).not.toContain(eleventh);
  });

  it('🔴 changing the radio clears nothing: the ticks come back with "Uses at least one of…"', () => {
    const first = EQUIPMENT_LABELS[ITEMS[0]!];
    render(<Harness options={MANY} />);
    open();
    openPanel();
    chosen();
    tick(choice(COPY.equipmentItemsLegend, first));
    tick(choice(COPY.equipmentLegend, COPY.equipmentAny));
    expect(screen.getByRole('button', { name: COPY.showResults(MANY.length, false) })).toBeTruthy();
    chosen();
    expect(choice(COPY.equipmentItemsLegend, first)).toHaveProperty('checked', true);
  });
});

describe('the list with a filter on (P9, P10; panel rows 10, 16)', () => {
  const withLats = () => {
    openPanel();
    tick(muscle(MUSCLE_LABELS.lats));
    press('Escape');
  };

  it('browsing: the filters-on line, custom items folded first, then what fits; no Recent', () => {
    render(<Harness recentIds={[ROW.publicId]} />);
    open();
    expect(h3s()).toContain(COPY.recent);
    withLats();
    expect(screen.getByText(COPY.filtersOnLine(1))).toBeTruthy();
    expect(h3s()).toEqual([COPY.householdNotFiltered, COPY.fitHeading]);
    const folded = screen.getByRole('heading', { name: COPY.householdNotFiltered });
    expect(folded.closest('details')!.open).toBe(false);
    const fit = screen.getByRole('region', { name: COPY.fitHeading });
    expect(
      within(fit)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([expect.stringMatching(/^Pull-Up/), expect.stringMatching(/^Chin-Up/)]);
  });

  it("the list's Clear filters drops them and moves focus to Filters (row 13)", () => {
    render(<Harness />);
    open();
    withLats();
    act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.clearFilters })));
    expect(screen.queryByText(COPY.filtersOnLine(1))).toBeNull();
    expect(filtersButton().getAttribute('aria-label')).toBe(COPY.filtersName(0));
    expect(document.activeElement).toBe(filtersButton());
  });

  it('searching: the filtered matches, custom items apart, then how many more are outside', () => {
    render(<Harness />);
    open();
    withLats();
    type('up');
    // "up" finds Pull-Up, Chin-Up, Push-Ups and the custom Pull-Up Ladder; Push-Ups is not lats.
    expect(h3s()).toEqual([COPY.matches, COPY.householdNotFiltered]);
    expect(screen.getByText(COPY.outsideMore(1))).toBeTruthy();
    expect(status()).toBe(COPY.statusCount(3));
  });

  it('🔴 an exact hit outside the filters is first, with no heading, tagged (P8)', () => {
    render(<Harness />);
    open();
    withLats();
    type('push-ups');
    const hit = screen.getByRole('button', { name: /^Push-Ups/ });
    expect(hit.textContent).toContain(COPY.tagNotInFilters);
    expect(hit.closest('section')).toBeNull();
    expect(status()).toContain(COPY.statusAlreadyListed(PUSH_UPS.name));
  });

  it('after a hit the rest are "More matches" (row 15)', () => {
    const HOLD = lib('Pull-Up Hold', [EQUIPMENT_CODE.pull_up_bar], MUSCLE.lats);
    render(<Harness options={[...OPTIONS, HOLD]} />);
    open();
    withLats();
    type('pull-up');
    expect(h3s()).toEqual([COPY.moreMatches, COPY.householdNotFiltered]);
  });

  it('🔴 Enter picks an exact hit outside the filters (P8)', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    open();
    withLats();
    type('push-ups');
    act(
      () =>
        void fireEvent.keyDown(document.querySelector('input[type="search"]')!, { key: 'Enter' }),
    );
    expect(onPick).toHaveBeenCalledWith({ kind: 'existing', option: PUSH_UPS });
  });

  it('nothing passes: says how many are outside, and the list beneath stays the filtered one (P10)', () => {
    render(<Harness />);
    open();
    withLats();
    type('goblet');
    expect(screen.getByText(COPY.outsideAll(1, 'goblet'))).toBeTruthy();
    expect(status()).toContain(COPY.statusOutsideOnly(1));
    expect(screen.getByRole('region', { name: COPY.fitHeading })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Goblet Squat/ })).toBeNull();
  });

  it('🔴 the create button reads the UNFILTERED result: quiet, naming the hidden near miss (row 9)', () => {
    render(<Harness multi />);
    open();
    withLats();
    type('gobblet sqat');
    const create = screen.getByRole('button', { name: 'New item: gobblet sqat' });
    expect(create.getAttribute('data-variant')).toBe('ghost');
    const hint = document.getElementById(create.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(COPY.similarOutside(GOBLET.name));
  });

  it('single mode: the footer hint says the near miss is outside the filters (row 9)', () => {
    render(<Harness />);
    open();
    withLats();
    type('gobblet sqat');
    const create = screen.getByRole('button', { name: COPY.asTyped('gobblet sqat') });
    const hint = document.getElementById(create.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(COPY.asTypedHintOutside(GOBLET.name, 'gobblet sqat'));
  });

  it('filters are kept across opens, the panel is not, and the reopen says they are on', async () => {
    render(<Harness />);
    open();
    withLats();
    press('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(screen.queryByRole('heading', { name: COPY.filtersHeading })).toBeNull();
    expect(screen.getByText(COPY.filtersOnLine(1))).toBeTruthy();
    // Silent at mount (Announcer's rule 1), then said once the region is there.
    await waitFor(() => expect(status()).toBe(COPY.statusFiltersKept(1)));
    type('pull');
    expect(status()).not.toBe(COPY.statusFiltersKept(1));
  });
});
