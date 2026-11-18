// @vitest-environment jsdom
import {
  MOVEMENT_PICKER_ENTRIES,
  MOVEMENT_SEED_ROWS,
  MOVEMENT_NAME_MESSAGES,
  TRACKING_TYPE,
  type MovementPickerGroup,
  SUPERVISION_LABELS,
  TRACKING_TYPE_LABELS,
  EQUIPMENT_CODE,
  MODALITY,
  SUPERVISION_KIND,
  type CatalogHowTo,
  type CatalogOptionTaxonomy,
} from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MovementOptionDTO, MovementPickerData } from '@/lib/movements/movement-option';
import { MOVEMENT_PICKER_COPY as COPY } from '@/lib/movements/movement-picker-copy';
import { SHEET_COPY } from '@/components/ui/sheet';

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
/**
 * The library fields a catalog option must carry (CAT-3 C0b-2), as a test default: a barbell lift
 * with no supervision and no instructions. ⚠️ Not `equipment: []`, which MEANS "No equipment". A
 * test that needs another shape passes `taxonomy`, typed as the contract's, so a misspelt or
 * missing field does not compile.
 */
const TEST_TAXONOMY: CatalogOptionTaxonomy = {
  modality: MODALITY.strength,
  pattern: null,
  equipment: [EQUIPMENT_CODE.barbell],
  primaryMuscle: null,
  secondaryMuscles: [],
  supervision: null,
  hasInstructions: false,
};

const catalogOption = (
  name: string,
  taxonomy: Partial<CatalogOptionTaxonomy> = {},
): MovementOptionDTO => {
  const row = MOVEMENT_SEED_ROWS.find((r) => r.name === name);
  if (!row) throw new Error(`fixture: no seeded movement named ${name}`);
  const entry = MOVEMENT_PICKER_ENTRIES[row.slug];
  if (!entry) throw new Error(`fixture: ${row.slug} has no picker entry`);
  return {
    publicId: row.publicId,
    name: row.name,
    owner: 'catalog',
    group: entry.group,
    aliases: entry.aliases ?? [],
    unitDefault: row.unitDefault,
    isBodyweight: row.isBodyweight,
    trackingType: TRACKING_TYPE.weight_reps,
    ...TEST_TAXONOMY,
    ...taxonomy,
  };
};

const householdOption = (name: string, publicId: string): MovementOptionDTO => ({
  publicId,
  name,
  owner: 'household',
  unitDefault: null,
  isBodyweight: false,
  trackingType: TRACKING_TYPE.weight_reps,
});

const ALL_CATALOG = MOVEMENT_SEED_ROWS.map((r) => catalogOption(r.name));
/** A household item literally named `RDL`, beside the catalog's Romanian Deadlift (C30's tie). */
const HOUSEHOLD_RDL_ID = '00000000-0000-7000-8000-00000000a0d1';
/**
 * ⚠️ **Queried from the DOM, not through `screen`.** Radix's modal dialog puts `aria-hidden` on the
 * rest of the document while it is open, and Testing Library's role queries skip hidden nodes — so
 * `getByRole('button', { name: 'Open' })` stops finding the trigger the moment the sheet opens, with
 * an error that reads as "the harness did not render". The last `main > button` is this render's
 * trigger regardless.
 */
const trigger = () => [...document.querySelectorAll('main > button')].at(-1) as HTMLButtonElement;

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

describe('the browse list, with no query', () => {
  it("orders Recent → Today's program → the groups → Your custom items", () => {
    const recent = catalogOption('Back Squat');
    const prescribed = catalogOption('Front Squat');
    render(
      <Harness
        data={{
          options: [...ALL_CATALOG, householdOption('Ray Special', 'h-1')],
          recentIds: [recent.publicId],
        }}
        todaysProgram={{ ids: [prescribed.publicId], onFormIds: new Set() }}
      />,
    );
    open();
    // 🔴 **Today's program IS in this list, and that is the point of the assertion.** This test
    // first shipped without it, under a comment explaining that a `<summary>` is not an `h3` — which
    // described the bug rather than the requirement. Heading navigation is how a screen-reader user
    // skims a sheet this long, and the section it skipped was the day's actual program. The `h3`
    // now sits inside the `summary`.
    expect(headings()).toEqual([
      COPY.recent,
      COPY.todaysProgram,
      COPY.groupLabel('push'),
      COPY.groupLabel('pull'),
      COPY.groupLabel('legs'),
      COPY.groupLabel('core'),
      COPY.household,
    ]);
  });

  it('omits an empty group — `wrestling` is declared and has no rows until C3', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    expect(headings()).not.toContain(COPY.groupLabel('wrestling'));
  });

  it('omits Recent without `recentIds`, and when it is empty', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    expect(headings()).not.toContain(COPY.recent);
    cleanup();
    render(<Harness data={{ options: ALL_CATALOG, recentIds: [] }} />);
    open();
    expect(headings()).not.toContain(COPY.recent);
  });

  it('omits Your custom items when the household owns nothing', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    expect(headings()).not.toContain(COPY.household);
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
  const details = () => document.querySelector('details');

  it('is OPEN while a prescribed movement is not yet on a card', () => {
    renderProgram({
      ids: [prescribed.publicId, other.publicId],
      onFormIds: new Set([other.publicId]),
    });
    expect(details()?.open).toBe(true);
  });

  it('is CLOSED, and says so, once every prescribed movement is on a card', () => {
    renderProgram({
      ids: [prescribed.publicId, other.publicId],
      onFormIds: new Set([prescribed.publicId, other.publicId]),
    });
    expect(details()?.open).toBe(false);
    expect(document.querySelector('summary')?.textContent).toBe(COPY.todaysProgramAllOnForm);
  });

  it('still lists EVERY prescribed row when closed — a second card stays one tap away', () => {
    renderProgram({
      ids: [prescribed.publicId, other.publicId],
      onFormIds: new Set([prescribed.publicId, other.publicId]),
    });
    const inDetails = details()?.querySelectorAll('li').length;
    expect(inDetails).toBe(2);
  });

  it('is absent with `alreadyIn` — D2 edits a workout and has no "today"', () => {
    renderProgram(
      { ids: [prescribed.publicId], onFormIds: new Set() },
      { alreadyIn: { ids: new Set(), label: 'Strength A' } },
    );
    expect(details()).toBeNull();
  });

  it('🔴 drops a prescribed id with no matching option, before deciding open/closed', () => {
    // Otherwise the `<details>` opens over a row it cannot render. Reachable when a prescription
    // names a movement outside the picker map, or a household row that fell off Decision 5's list.
    renderProgram({ ids: ['no-such-option-id'], onFormIds: new Set() });
    expect(details()).toBeNull();
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

  it('…and NOT for an aliased row reached another way — the group label wins there', () => {
    // The gap the panel found: an unconditional `also called` would outrank the group label for every
    // aliased row in search results, against UX1 8.
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    type('romanian');
    expect(tagsFor('Romanian Deadlift')).toBe(COPY.groupLabel('legs'));
  });

  it("`current` marks the card's movement in the browse list", () => {
    render(<Harness data={{ options: ALL_CATALOG }} currentId={squat.publicId} />);
    open();
    expect(tagsFor('Front Squat')).toBe(COPY.tagCurrent);
  });

  it('a group label appears in SEARCH RESULTS only, not while browsing', () => {
    render(<Harness data={{ options: ALL_CATALOG }} />);
    open();
    // Browsing: the row is already under its group's heading, so repeating it is noise.
    expect(tagsFor('Front Squat')).toBeNull();
    type('front squat');
    expect(tagsFor('Front Squat')).toBe(COPY.groupLabel('legs'));
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

  it('every group label comes from the shared map', () => {
    for (const group of Object.values(MOVEMENT_PICKER_ENTRIES).map((e) => e.group)) {
      expect(typeof COPY.groupLabel(group as MovementPickerGroup)).toBe('string');
    }
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
  beforeEach(() => {
    window.history.replaceState(null, '');
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });

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
    // The heading, then the supervision label ABOVE the steps (K17), then the steps, then Hide.
    expect(box.querySelector('h4')?.textContent).toBe(COPY.howToFor('Pull-Up'));
    expect([...box.children].map((el) => el.tagName)).toEqual(['H4', 'P', 'OL', 'BUTTON']);
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

  it('a library option with no legacy group is found by search and left out of browse (C0b-2)', () => {
    const { group: _dropped, ...rest } = catalogOption('Pallof Press') as Extract<
      MovementOptionDTO,
      { owner: 'catalog' }
    >;
    void _dropped;
    const ungrouped: MovementOptionDTO = { ...rest, publicId: 'lib-1', name: 'Leg Swing' };
    render(<Harness data={{ options: [...ALL_CATALOG, ungrouped] }} />);
    open();
    expect(screen.queryByRole('button', { name: /^Leg Swing/ })).toBeNull();
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
