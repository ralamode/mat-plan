// @vitest-environment jsdom
import {
  EQUIPMENT,
  EQUIPMENT_CODE,
  EQUIPMENT_FILTER_SHOWN_FIRST,
  EQUIPMENT_LABELS,
  MOVEMENT_PICKER_GROUP_LABELS,
  MUSCLE,
  MUSCLE_LABELS,
  TRACKING_TYPE,
  type Equipment,
  type Muscle,
} from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MovementOptionDTO } from '@/lib/movements/movement-option';
import { MOVEMENT_PICKER_COPY as COPY } from '@/lib/movements/movement-picker-copy';
import {
  catalogOption,
  householdOption,
  pickerTrigger,
  stubSheetHistory,
  TEST_TAXONOMY,
} from '@/test/movement-picker-fixtures';

import { MovementPicker } from './movement-picker';

/**
 * The picker's filters (CAT-3 P7 to P10 and P15's announcements; B2-ii). The search's own rules
 * (what passes, what is counted, what Enter picks) are `movement-search.test.ts`'s; this file holds
 * what the SCREEN does with them: the panel, the list under a filter, focus and the one region.
 */

afterEach(cleanup);
beforeEach(stubSheetHistory);

// Seeded movements, with the taxonomy each test needs. Listed pull before push on purpose: the
// filtered browse sorts by the legacy groups' order, not the input's.
const PULL_UP = catalogOption('Pull-Up', {
  equipment: [EQUIPMENT_CODE.pull_up_bar],
  primaryMuscle: MUSCLE.lats,
});
const INVERTED = catalogOption('Inverted Rows', {
  equipment: [EQUIPMENT_CODE.pull_up_bar],
  primaryMuscle: MUSCLE.lats,
});
const ROW = catalogOption('Bent-over Rows', { primaryMuscle: MUSCLE.upper_back });
const PUSH_UPS = catalogOption('Push-Ups', { equipment: [], primaryMuscle: MUSCLE.chest });
const FRONT = catalogOption('Front Squat', { primaryMuscle: MUSCLE.quadriceps });
const CIRCUIT = householdOption('Garage Circuit', 'own-circuit');
const LADDER = householdOption('Pull-Up Ladder', 'own-ladder');
const OPTIONS = [PULL_UP, INVERTED, ROW, PUSH_UPS, FRONT, CIRCUIT, LADDER];

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
            footerAction: <button type="button">Add {selected.length}</button>,
          }}
        />
      ) : (
        <MovementPicker {...common} onPick={onPick} />
      )}
    </main>
  );
}

const open = () => act(() => void pickerTrigger().click());
const input = () => document.querySelector<HTMLInputElement>('input[type="search"]')!;
const type = (value: string) => act(() => void fireEvent.change(input(), { target: { value } }));
const enter = () => act(() => void fireEvent.keyDown(input(), { key: 'Enter' }));
const status = () => document.querySelector('[role="status"]')?.textContent ?? '';
const filtersButton = () => screen.getByRole('button', { name: /^Filters, / });
const openPanel = () => act(() => void fireEvent.click(filtersButton()));
const back = () =>
  act(() => void fireEvent.click(screen.getByRole('button', { name: COPY.filtersBack })));
const group = (name: string) => screen.getByRole('group', { name });
const choice = (groupName: string, label: string) =>
  within(group(groupName)).getByRole(groupName === COPY.equipmentLegend ? 'radio' : 'checkbox', {
    name: new RegExp(`^${label}${COPY.choiceJoin}`),
  });
const muscle = (label: string) => choice(COPY.musclesLegend, label);
const radio = (label: string) => choice(COPY.equipmentLegend, label);
const tick = (box: HTMLElement) => act(() => void fireEvent.click(box));
const press = (key: string) =>
  act(() => void fireEvent.keyDown(screen.getByRole('dialog'), { key }));
const h3s = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const inert = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';
/** Turns the given muscles on, then goes back to the list. */
const withMuscles = (...labels: string[]) => {
  openPanel();
  for (const label of labels) tick(muscle(label));
  press('Escape');
};
const withLats = () => withMuscles(MUSCLE_LABELS.lats);

describe('the Filters control (P15)', () => {
  it('names how many are on, and shows them', () => {
    render(<Harness />);
    open();
    expect(filtersButton().getAttribute('aria-label')).toBe(COPY.filtersName(0));
    expect(filtersButton().textContent).toBe(COPY.filters(0));
    withLats();
    expect(filtersButton().getAttribute('aria-label')).toBe(COPY.filtersName(1));
    expect(filtersButton().textContent).toBe(COPY.filters(1));
  });

  it('is not shown when no library movement is listed: there is nothing to filter', () => {
    render(<Harness options={[CIRCUIT, LADDER]} />);
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
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: COPY.filtersHeading }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(input().value).toBe('pull');
    expect(screen.queryByRole('button', { name: /^Pull-Up/ })).toBeNull();
  });

  it('"Back to the list" closes it and returns focus to Filters', () => {
    render(<Harness />);
    open();
    openPanel();
    back();
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
    expect(status()).toBe(COPY.panelStatus(MUSCLE_LABELS.lats, true, 2, false));
    tick(muscle(MUSCLE_LABELS.lats));
    expect(status()).toBe(COPY.panelStatus(MUSCLE_LABELS.lats, false, 5, false));
    tick(radio(COPY.emptyEquipment));
    expect(status()).toBe(COPY.panelStatusChoice(COPY.emptyEquipment, 1, false));
    expect(document.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
  });

  it('under a query it counts results, in the button, the line and the region alike', () => {
    render(<Harness />);
    open();
    type('up');
    openPanel();
    tick(muscle(MUSCLE_LABELS.quadriceps));
    // Pull-Up and Push-Ups fail it; the custom "Pull-Up Ladder" is shown whatever it says.
    expect(screen.getByRole('button', { name: COPY.showResults(1, true) })).toBeTruthy();
    expect(screen.getByText(COPY.panelCount(1, true))).toBeTruthy();
    expect(status()).toBe(COPY.panelStatus(MUSCLE_LABELS.quadriceps, true, 1, true));
  });

  it('names each choice whole, its count said after the label (row 17)', () => {
    render(<Harness />);
    open();
    openPanel();
    const lats = muscle(MUSCLE_LABELS.lats);
    // Set whole on the input: a browser reads a hidden span inside the label as its own box.
    expect(lats.getAttribute('aria-label')).toBe(COPY.choiceName(MUSCLE_LABELS.lats, 2));
    expect(lats.closest('label')!.textContent).toBe(`${MUSCLE_LABELS.lats}2`);
  });

  it('🔴 greys a choice that would leave nothing, unless it is ticked (P7)', () => {
    render(<Harness />);
    open();
    openPanel();
    expect(inert(muscle(MUSCLE_LABELS.neck))).toBe(true);
    expect(inert(muscle(MUSCLE_LABELS.lats))).toBe(false);
    // An inert choice cannot be ticked.
    tick(muscle(MUSCLE_LABELS.neck));
    expect(muscle(MUSCLE_LABELS.neck)).toHaveProperty('checked', false);
    tick(muscle(MUSCLE_LABELS.lats));
    // Chest alone would still leave Push-Ups (muscles are "any of"); "No equipment" with Lats would not.
    expect(inert(muscle(MUSCLE_LABELS.chest))).toBe(false);
    expect(inert(radio(COPY.emptyEquipment))).toBe(true);
    // Lats and Chest, then "No equipment" (Push-Ups fits): Lats alone now counts 0 but stays live.
    tick(muscle(MUSCLE_LABELS.chest));
    tick(radio(COPY.emptyEquipment));
    expect(muscle(MUSCLE_LABELS.lats).closest('label')!.textContent).toBe(`${MUSCLE_LABELS.lats}0`);
    expect(inert(muscle(MUSCLE_LABELS.lats))).toBe(false);
  });

  it('🔴 unticking a choice that counts 0 keeps focus on it: aria-disabled, never disabled', () => {
    render(<Harness />);
    open();
    openPanel();
    tick(muscle(MUSCLE_LABELS.lats));
    tick(muscle(MUSCLE_LABELS.chest));
    tick(radio(COPY.emptyEquipment));
    const lats = muscle(MUSCLE_LABELS.lats);
    lats.focus();
    tick(lats);
    expect(lats).toHaveProperty('checked', false);
    expect(inert(lats)).toBe(true);
    expect(lats).toHaveProperty('disabled', false);
    expect(document.activeElement).toBe(lats);
  });

  it('the radio hints are described, not crammed into the name', () => {
    render(<Harness />);
    open();
    openPanel();
    const none = radio(COPY.emptyEquipment);
    const hint = document.getElementById(none.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(COPY.equipmentNoneHint);
  });

  it('"Show N movements" closes the panel and counts what will show', () => {
    render(<Harness />);
    open();
    openPanel();
    tick(muscle(MUSCLE_LABELS.lats));
    act(
      () => void fireEvent.click(screen.getByRole('button', { name: COPY.showResults(2, false) })),
    );
    expect(screen.queryByRole('heading', { name: COPY.filtersHeading })).toBeNull();
    expect(document.activeElement).toBe(filtersButton());
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
    expect(status()).toBe(COPY.panelStatusChoice(COPY.filtersCleared, 5, false));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: COPY.filtersHeading }));
  });
});

describe('equipment items (P7)', () => {
  // ⚠️ **Invented rows, on purpose**: sixty-six movements over eleven items, the k-th used by
  // (11 - k), so the most-used order is the vocabulary's first eleven and the eleventh sits beyond
  // the first ten. The seeded catalog has neither the volume nor the spread. The last six items'
  // first drill works the lats, so ticking Lats would reorder a live ranking.
  const ITEMS = EQUIPMENT.slice(0, EQUIPMENT_FILTER_SHOWN_FIRST + 1);
  const drill = (name: string, item: Equipment, primaryMuscle: Muscle | null) =>
    ({
      publicId: `drill-${name}`,
      name,
      owner: 'catalog',
      aliases: [],
      unitDefault: null,
      isBodyweight: false,
      trackingType: TRACKING_TYPE.weight_reps,
      ...TEST_TAXONOMY,
      equipment: [item],
      primaryMuscle,
    }) satisfies MovementOptionDTO;
  const MANY = ITEMS.flatMap((item, k) =>
    Array.from({ length: ITEMS.length - k }, (_, j) =>
      drill(`Drill ${k}-${j}`, item, k >= 5 && j === 0 ? MUSCLE.lats : null),
    ),
  );
  const items = () =>
    within(group(COPY.equipmentItemsLegend))
      .getAllByRole('checkbox')
      .map((box) => box.getAttribute('aria-label')!.split(COPY.choiceJoin)[0]);
  const chosen = () => tick(radio(COPY.equipmentChosen));

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

  it('the order does not move when a muscle is ticked: the next tap stays on target', () => {
    render(<Harness options={MANY} />);
    open();
    openPanel();
    chosen();
    const before = items();
    tick(muscle(MUSCLE_LABELS.lats));
    expect(items()).toEqual(before);
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
    tick(radio(COPY.equipmentAny));
    expect(screen.getByRole('button', { name: COPY.showResults(MANY.length, false) })).toBeTruthy();
    chosen();
    expect(choice(COPY.equipmentItemsLegend, first)).toHaveProperty('checked', true);
  });
});

describe('the list with a filter on (P8 to P10; panel rows 9, 10, 15, 16)', () => {
  it('browsing: the filters-on line, custom items folded first with a count, then what fits', () => {
    render(<Harness recentIds={[ROW.publicId]} />);
    open();
    expect(h3s()).toContain(COPY.recent);
    withLats();
    expect(screen.getByText(COPY.filtersOnLine(1))).toBeTruthy();
    expect(h3s()).toEqual([COPY.foldedCount(COPY.householdNotFiltered, 2), COPY.fitHeading]);
    const folded = screen.getByRole('heading', { name: /^Your custom items \(not filtered\)/ });
    expect(folded.closest('details')!.open).toBe(false);
  });

  it("what fits is in the legacy groups' order, whatever the input order, each row tagged", () => {
    render(<Harness />);
    open();
    withMuscles(MUSCLE_LABELS.lats, MUSCLE_LABELS.chest);
    const fit = screen.getByRole('region', { name: COPY.fitHeading });
    const rows = within(fit).getAllByRole('button');
    expect(rows.map((b) => b.textContent!.split(/[\s,]/)[0])).toEqual([
      'Push-Ups',
      'Pull-Up',
      'Inverted',
    ]);
    expect(rows[0]!.textContent).toContain(MOVEMENT_PICKER_GROUP_LABELS.push);
  });

  it('🔴 the folded section opens itself while it holds a ticked row (so focus can reach it)', () => {
    render(<Harness multi />);
    open();
    withLats();
    const folded = screen.getByRole('heading', { name: /^Your custom items \(not filtered\)/ });
    expect(folded.closest('details')!.open).toBe(false);
    tick(screen.getByRole('checkbox', { name: /^Garage Circuit/ }));
    expect(folded.closest('details')!.open).toBe(true);
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
    // "up" finds Pull-Up, Push-Ups and the custom Pull-Up Ladder; Push-Ups is not lats.
    expect(h3s()).toEqual([COPY.matches, COPY.householdNotFiltered]);
    expect(screen.getByText(COPY.outsideMore(1))).toBeTruthy();
    expect(status()).toBe(COPY.statusCount(2));
  });

  it('🔴 a custom near miss set apart is counted as a near miss, not a match (P5, P9)', () => {
    render(<Harness multi />);
    open();
    withLats();
    type('garaje circut');
    expect(h3s()).toEqual([COPY.householdNotFiltered]);
    expect(status()).toBe(COPY.statusNone(1, 0));
    // It is on screen, so the create hint points at it as listed, not as hidden.
    const create = screen.getByRole('button', { name: 'New item: garaje circut' });
    const hint = document.getElementById(create.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(COPY.similarListed('Garage Circuit', 'below'));
  });

  it('🔴 an exact hit outside the filters is first, with no heading, tagged (P8)', () => {
    render(<Harness />);
    open();
    withLats();
    type('push-ups');
    const hit = screen.getByRole('button', { name: /^Push-Ups/ });
    expect(hit.textContent).toContain(COPY.tagNotInFilters);
    expect(hit.closest('section')).toBeNull();
    expect(status()).toContain(COPY.statusAlreadyListedOutside(PUSH_UPS.name));
  });

  it('after a hit the rest are "More matches" (row 15)', () => {
    const THRUST = catalogOption('Barbell Hip Thrust', { primaryMuscle: MUSCLE.glutes });
    const SINGLE = catalogOption('Single-Leg Hip Thrusts', { primaryMuscle: MUSCLE.glutes });
    render(<Harness options={[...OPTIONS, THRUST, SINGLE]} />);
    open();
    withMuscles(MUSCLE_LABELS.glutes);
    type('hip thrust');
    expect(h3s()).toEqual([COPY.moreMatches]);
  });

  it('🔴 Enter picks an exact hit outside the filters (P8)', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    open();
    withLats();
    type('push-ups');
    enter();
    expect(onPick).toHaveBeenCalledWith({ kind: 'existing', option: PUSH_UPS });
  });

  it('multi mode: Enter selects the hit outside the filters and clears the search', () => {
    render(<Harness multi />);
    open();
    withLats();
    type('push-ups');
    enter();
    expect(input().value).toBe('');
    expect(screen.getByRole('button', { name: 'Add 1' })).toBeTruthy();
  });

  it('only hidden matches: says how many, offers Clear filters there, and lists nothing else (P10)', () => {
    render(<Harness />);
    open();
    withLats();
    type('squat');
    const line = screen.getByText(COPY.outsideAll(1, 'squat'));
    expect(
      within(line.parentElement!).getByRole('button', { name: COPY.clearFilters }),
    ).toBeTruthy();
    expect(status()).toContain(COPY.statusOutsideOnly(1));
    expect(screen.queryByRole('region', { name: COPY.fitHeading })).toBeNull();
  });

  it('no match at all: the list beneath is the filtered one, never the whole (P10)', () => {
    render(<Harness />);
    open();
    withLats();
    type('xylophone');
    const fit = screen.getByRole('region', { name: COPY.fitHeading });
    expect(within(fit).queryByRole('button', { name: /^Push-Ups/ })).toBeNull();
    expect(within(fit).getByRole('button', { name: /^Pull-Up/ })).toBeTruthy();
  });

  it('🔴 the create button reads the UNFILTERED result: quiet, naming the hidden near miss (row 9)', () => {
    render(<Harness multi />);
    open();
    withLats();
    type('frnt sqat');
    const create = screen.getByRole('button', { name: 'New item: frnt sqat' });
    expect(create.getAttribute('data-variant')).toBe('ghost');
    const hint = document.getElementById(create.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(COPY.similarOutside(FRONT.name));
  });

  it('single mode: the footer hint says the filters hide the near miss (row 9)', () => {
    render(<Harness />);
    open();
    withLats();
    type('frnt sqat');
    const create = screen.getByRole('button', { name: COPY.asTyped('frnt sqat') });
    const hint = document.getElementById(create.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(COPY.asTypedHintOutside(FRONT.name, 'frnt sqat'));
  });

  it('filters are kept across opens, the panel is not, and the reopen says so once', async () => {
    render(<Harness />);
    open();
    withLats();
    press('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(screen.queryByRole('heading', { name: COPY.filtersHeading })).toBeNull();
    expect(screen.getByText(COPY.filtersOnLine(1))).toBeTruthy();
    // 🔴 Silent at mount (Announcer's rule 1), then said once the region is there.
    expect(status()).toBe('');
    await waitFor(() => expect(status()).toBe(COPY.statusFiltersKept(1)));
    // Opening the panel and coming back does not say it again.
    openPanel();
    back();
    expect(status()).not.toBe(COPY.statusFiltersKept(1));
  });
});
