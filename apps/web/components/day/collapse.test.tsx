// @vitest-environment jsdom
import { type DayPlan } from '@mat-plan/shared';
import {
  archivedAthleteToday,
  closedDayLoggedOnly,
  futurePreview,
  yesterdayHalfDone,
} from '@mat-plan/shared/program/fixtures';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeDayActions } from '@/app/design/program/fakes';

import { DAY_COPY } from './day-copy';
import { DayScreen } from './day-screen';
import { card, held, makeMount, press, workout } from './day-test-utils';

/**
 * FAM-1 12c-iii: a workout finished when the person arrives folds to one line (D38; plan
 * `fam-1-12c-iii-collapse.md` §1–§4).
 */

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.restoreAllMocks();
});

const { mount, show } = makeMount(createFakeDayActions);

const finished = (plan: DayPlan) =>
  plan.workouts.filter((w) => w.progress.total > 0 && w.progress.done >= w.progress.total);
const many = (plan: DayPlan) => plan.programs.length > 1;
const programOf = (plan: DayPlan, id: string | null) =>
  plan.programs.find((p) => p.programPublicId === id)?.name ?? null;
/** The line's accessible name: name, then the label (else the program, on a two-program day), then the count. */
function lineName(plan: DayPlan, w: DayPlan['workouts'][number]): string {
  const detail = w.label ?? (many(plan) ? programOf(plan, w.programPublicId) : null);
  return [w.name, detail, DAY_COPY.progress(w.progress.done, w.progress.total)]
    .filter(Boolean)
    .join(', ');
}
const line = (name: string) => within(workout(name)).queryByRole('button', { expanded: false });
const collapseButton = (name: string) =>
  within(workout(name)).queryByRole('button', { name: DAY_COPY.collapseLabel(name) });

/** `yesterdayHalfDone` with one of a finished workout's rows not logged: finished by one ✓. */
function oneShort(): { plan: DayPlan; name: string } {
  const plan: DayPlan = structuredClone(yesterdayHalfDone);
  const w = finished(plan).find((x) => x.items.some((i) => i.rows.length === 1))!;
  const item = w.items.find((i) => i.rows.length === 1)!;
  item.rows[0]!.logged = null;
  w.progress = { ...w.progress, done: w.progress.done - 1 };
  return { plan, name: w.name };
}

describe('arrival', () => {
  it('a finished workout arrives as one line, named "name, label, done of total"; an unfinished one is open', () => {
    show(yesterdayHalfDone);
    const done = finished(yesterdayHalfDone);
    expect(done.length).toBeGreaterThan(0);
    for (const w of done) {
      const l = line(w.name)!;
      expect(l.getAttribute('aria-expanded')).toBe('false');
      expect(
        within(workout(w.name)).getByRole('button', { name: lineName(yesterdayHalfDone, w) }),
      ).toBe(l);
      // The line sits inside the workout's own heading, and the region keeps its bare name.
      expect(l.closest('h3')).not.toBeNull();
      expect(workout(w.name)).toBeTruthy();
      // The body is hidden, never unmounted: nothing in it is reachable by role.
      expect(within(workout(w.name)).queryAllByRole('listitem')).toHaveLength(0);
      expect(document.getElementById(l.getAttribute('aria-controls')!)?.hidden).toBe(true);
    }
    for (const w of yesterdayHalfDone.workouts.filter((x) => !done.includes(x))) {
      expect(line(w.name)).toBeNull();
    }
  });

  it('with no label and one program the line is "name, count"; with two programs it names the program', () => {
    const plan: DayPlan = structuredClone(yesterdayHalfDone);
    const w = finished(plan)[0]!;
    w.label = null;
    show(plan);
    expect(within(workout(w.name)).getByRole('button', { name: lineName(plan, w) })).toBeTruthy();
    cleanup();
    const onePlan: DayPlan = { ...plan, programs: plan.programs.slice(0, 1) };
    show(onePlan);
    expect(
      within(workout(w.name)).getByRole('button', {
        name: `${w.name}, ${DAY_COPY.progress(w.progress.done, w.progress.total)}`,
      }),
    ).toBeTruthy();
  });

  /** The plan with its first countable workout finished, so only read-only can keep it open. */
  const withFinished = (plan: DayPlan): DayPlan => {
    const next: DayPlan = structuredClone(plan);
    const w = next.workouts.find((x) => x.items.length > 0)!;
    const n = Math.max(1, w.progress.total);
    w.progress = { done: n, total: n };
    return next;
  };
  it.each([
    ['a closed day', closedDayLoggedOnly],
    ['an archived athlete', withFinished(archivedAthleteToday)],
    ['a future day', withFinished(futurePreview)],
  ])('%s shows no line and no Collapse, even with a finished workout', (_case, plan) => {
    show(plan);
    expect(
      screen.queryAllByRole('button', { expanded: false }).filter((b) => b.closest('h3')),
    ).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Collapse / })).toBeNull();
  });
});

describe('during a visit', () => {
  it('the last ✓ leaves the workout open, now with Collapse; the next arrival folds it', async () => {
    const { plan, name } = oneShort();
    const control = mount(plan);
    expect(line(name)).toBeNull();
    const open = within(workout(name)).getAllByRole('button', { pressed: false })[0]!;
    await press(open);
    expect(line(name)).toBeNull();
    expect(collapseButton(name)).not.toBeNull();
    // Coming back: a new mount of what the page now holds.
    const now = control.plan;
    cleanup();
    show(now);
    expect(line(name)).not.toBeNull();
  });

  it('a tap opens it with focus on Collapse; Collapse folds it with focus on the line; nothing is announced', () => {
    const name = finished(yesterdayHalfDone)[0]!.name;
    show(yesterdayHalfDone);
    const before = screen.getByRole('status').textContent;
    act(() => {
      fireEvent.click(line(name)!);
    });
    const collapse = collapseButton(name)!;
    expect(document.activeElement).toBe(collapse);
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(within(workout(name)).queryAllByRole('listitem').length).toBeGreaterThan(0);
    act(() => {
      fireEvent.click(collapse);
    });
    expect(document.activeElement).toBe(line(name));
    expect(screen.getByRole('status').textContent).toBe(before);
  });

  it('a mount moves no focus', () => {
    show(yesterdayHalfDone);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('busy: Collapse is never offered over work not saved', () => {
  const name = () =>
    finished(yesterdayHalfDone).find((w) => w.items.some((i) => i.rows.length > 1)) ??
    finished(yesterdayHalfDone)[0]!;

  it('not while a write is in flight', async () => {
    const gate = held();
    const w = finished(yesterdayHalfDone)[0]!;
    mount(yesterdayHalfDone, {
      wrap: (a) => ({ untickRow: (input) => gate.after(() => a.untickRow(input)) }),
    });
    act(() => {
      fireEvent.click(line(w.name)!);
    });
    expect(collapseButton(w.name)).not.toBeNull();
    const tick = within(workout(w.name)).getAllByRole('button', { pressed: true })[0]!;
    await act(async () => {
      fireEvent.click(tick);
    });
    expect(collapseButton(w.name)).toBeNull();
    await gate.resolve();
  });

  it('not while a Change is typed and not saved', () => {
    const w = finished(yesterdayHalfDone).find((x) =>
      x.items.some((i) => i.rows.some((r) => r.logged && r.logged.values.quantities.length > 0)),
    )!;
    mount(yesterdayHalfDone, { change: true });
    act(() => {
      fireEvent.click(line(w.name)!);
    });
    expect(collapseButton(w.name)).not.toBeNull();
    const field = within(workout(w.name)).getAllByRole('textbox')[0]!;
    act(() => {
      field.focus();
      fireEvent.change(field, { target: { value: '99' } });
    });
    expect(collapseButton(w.name)).toBeNull();
  });

  it('not while an added set is not ticked', () => {
    const w = name();
    const setItem = w.items.find((i) => i.rows.length > 1);
    // The fixture's finished workouts hold a set item (Neck bridge, three sets).
    expect(setItem).toBeTruthy();
    if (!setItem) return;
    mount(yesterdayHalfDone);
    act(() => {
      fireEvent.click(line(w.name)!);
    });
    act(() => {
      fireEvent.click(
        within(card(w.name, setItem.name)).getByRole('button', {
          name: DAY_COPY.addSetTo(setItem.name),
        }),
      );
    });
    expect(collapseButton(w.name)).toBeNull();
  });
});

describe('focus when a control goes by itself', () => {
  function unfinish(plan: DayPlan, name: string): DayPlan {
    const next: DayPlan = structuredClone(plan);
    const w = next.workouts.find((x) => x.name === name)!;
    const row = w.items.flatMap((i) => i.rows).find((r) => r.logged)!;
    row.logged = null;
    w.progress = { ...w.progress, done: w.progress.done - 1 };
    return next;
  }

  it('the line goes while focused (another phone’s un-tick): the workout opens, focus on its name', async () => {
    const name = finished(yesterdayHalfDone)[0]!.name;
    const control = mount(yesterdayHalfDone);
    act(() => line(name)!.focus());
    await act(async () => control.setPlan(unfinish(control.plan, name)));
    expect(line(name)).toBeNull();
    expect(document.activeElement?.textContent).toBe(name);
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
  });

  it('Collapse goes while focused: focus on the name', async () => {
    const name = finished(yesterdayHalfDone)[0]!.name;
    const control = mount(yesterdayHalfDone);
    act(() => {
      fireEvent.click(line(name)!);
    });
    expect(document.activeElement).toBe(collapseButton(name));
    await act(async () => control.setPlan(unfinish(control.plan, name)));
    expect(collapseButton(name)).toBeNull();
    expect(document.activeElement?.textContent).toBe(name);
  });

  it('when focus is elsewhere, a control that goes leaves it there', async () => {
    const name = finished(yesterdayHalfDone)[0]!.name;
    const control = mount(yesterdayHalfDone);
    const elsewhere = line(finished(yesterdayHalfDone)[1]!.name)!;
    act(() => elsewhere.focus());
    await act(async () => control.setPlan(unfinish(control.plan, name)));
    expect(line(name)).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('a closed_day opens every line', async () => {
    const { plan, name } = oneShort();
    mount(plan, {
      wrap: () => ({ logRow: async () => ({ ok: false, reason: 'closed_day' as const }) }),
    });
    const other = finished(plan).find((w) => w.name !== name)!;
    expect(line(other.name)).not.toBeNull();
    await press(within(workout(name)).getAllByRole('button', { pressed: false })[0]!);
    expect(line(other.name)).toBeNull();
    // The notice takes focus, as before 12c-iii.
    expect(document.activeElement?.textContent).toContain(DAY_COPY.closed);
  });
});

describe('more of the plan’s rules (12c-iii review)', () => {
  it('a folded name has no tab stop; open, it is the focus target', () => {
    const name = finished(yesterdayHalfDone)[0]!.name;
    show(yesterdayHalfDone);
    const folded = within(line(name)!).getByText(name);
    expect(folded.getAttribute('tabindex')).toBeNull();
    act(() => {
      fireEvent.click(line(name)!);
    });
    expect(within(workout(name)).getByText(name).getAttribute('tabindex')).toBe('-1');
  });

  it('a change of day and back is coming back: a workout finished during the visit folds', async () => {
    const { plan, name } = oneShort();
    const control = mount(plan);
    await press(within(workout(name)).getAllByRole('button', { pressed: false })[0]!);
    expect(line(name)).toBeNull();
    const now = control.plan;
    await act(async () => control.setPlan({ ...now, day: '2000-01-01' }));
    await act(async () => control.setPlan(now));
    expect(line(name)).not.toBeNull();
  });

  it('a refused un-tick’s message keeps Collapse away (nothing failed behind a line)', async () => {
    const w = finished(yesterdayHalfDone)[0]!;
    mount(yesterdayHalfDone, {
      wrap: () => ({ untickRow: async () => ({ ok: false, reason: 'not_found' as const }) }),
    });
    act(() => {
      fireEvent.click(line(w.name)!);
    });
    await press(within(workout(w.name)).getAllByRole('button', { pressed: true })[0]!);
    expect(collapseButton(w.name)).toBeNull();
  });

  it('Collapse comes back when a typed Change is typed back to what is stored', () => {
    const w = finished(yesterdayHalfDone).find((x) =>
      x.items.some((i) => i.rows.some((r) => r.logged && r.logged.values.quantities.length > 0)),
    )!;
    mount(yesterdayHalfDone, { change: true });
    act(() => {
      fireEvent.click(line(w.name)!);
    });
    const field = within(workout(w.name)).getAllByRole('textbox')[0]!;
    const stored = (field as HTMLInputElement).value;
    act(() => {
      field.focus();
      fireEvent.change(field, { target: { value: '99' } });
    });
    expect(collapseButton(w.name)).toBeNull();
    act(() => {
      fireEvent.change(field, { target: { value: stored } });
    });
    expect(collapseButton(w.name)).not.toBeNull();
  });

  it('under StrictMode a tap still puts focus on Collapse, and a later self-open steals nothing', async () => {
    const name = finished(yesterdayHalfDone)[0]!.name;
    render(
      <StrictMode>
        <DayScreen
          plan={yesterdayHalfDone}
          actions={createFakeDayActions(yesterdayHalfDone, () => {}).actions}
        />
      </StrictMode>,
    );
    await act(async () => {
      fireEvent.click(line(name)!);
    });
    expect(document.activeElement).toBe(collapseButton(name));
    await act(async () => {
      fireEvent.click(collapseButton(name)!);
    });
    expect(document.activeElement).toBe(line(name));
  });
});
