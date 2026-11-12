// @vitest-environment jsdom
import {
  MOVEMENT_PICKER_ENTRIES,
  MOVEMENT_SEED_ROWS,
  MOVEMENT_NAME_MESSAGES,
  type MovementPickerGroup,
} from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MovementOptionDTO, MovementPickerData } from '@/lib/movements/movement-option';
import { MOVEMENT_PICKER_COPY as COPY } from '@/lib/movements/movement-picker-copy';

import { MovementPicker, type TodaysProgramForPicker } from './movement-picker';

afterEach(cleanup);

// ── Fixtures, built from the REAL seeded catalog ──────────────────────────────────────────────────
// Not hand-written options: the grouping, the aliases and the names are what PR 4's DAL will read out
// of `MOVEMENT_PICKER_ENTRIES`, so a test over invented rows would pass while the real catalog did
// something else.
const catalogOption = (name: string): MovementOptionDTO => {
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
  };
};

const householdOption = (name: string, publicId: string): MovementOptionDTO => ({
  publicId,
  name,
  owner: 'household',
  unitDefault: null,
  isBodyweight: false,
});

const ALL_CATALOG = MOVEMENT_SEED_ROWS.map((r) => catalogOption(r.name));
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
  onPick?: (p: Parameters<React.ComponentProps<typeof MovementPicker>['onPick']>[0]) => void;
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
const search = () => screen.getByRole('searchbox', { name: COPY.searchLabel });
let lastTyped = '';
const type = (value: string) => {
  lastTyped = value.trim();
  act(() => void fireEvent.change(search(), { target: { value } }));
};
const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const status = () => document.querySelector('[role="status"]')?.textContent ?? '';

describe('the browse list, with no query', () => {
  it("orders Recent → Today's program → the groups → Your household", () => {
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

  it('omits Your household when the household owns nothing', () => {
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
    return row?.querySelectorAll('span')[1]?.textContent ?? null;
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

  it('`household` shows everywhere EXCEPT under its own heading', () => {
    const mine = householdOption('Ray Special', 'h-1');
    render(<Harness data={{ options: [...ALL_CATALOG, mine] }} />);
    open();
    expect(tagsFor('Ray Special')).toBeNull(); // under "Your household"
    type('ray special');
    expect(tagsFor('Ray Special')).toBe(COPY.tagHousehold);
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
    expect(status()).toContain(COPY.statusNoMatches);
    type('farmers walk');
    expect(status()).toContain('some of your words');
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
    type('zercher squat'); // no match at all — the only thing offered is creation
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
    const items = document.querySelectorAll('section ul > li > button');
    expect(items.length).toBeGreaterThan(30);
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

  it('every group label comes from the shared map', () => {
    for (const group of Object.values(MOVEMENT_PICKER_ENTRIES).map((e) => e.group)) {
      expect(typeof COPY.groupLabel(group as MovementPickerGroup)).toBe('string');
    }
  });
});
