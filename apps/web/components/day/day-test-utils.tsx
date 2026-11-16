import { QUANTITY_SLOT, type DayActions, type DayPlan } from '@mat-plan/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { vi, type Mock } from 'vitest';

import { DAY_COPY } from './day-copy';
import { DayScreen } from './day-screen';

/**
 * The day screen's test harness, shared by its test files (FAM-1 lane C): mount the screen as the
 * preview route does, and find its parts by role and name. A test helper, never imported by
 * production code.
 *
 * ⚠️ **The fake is passed in, not imported here.** Only a test file (`*.test.ts(x)`) may import the
 * preview's fakes (the source scan in `app/design/program/fakes.test.ts`), and this file holds no
 * tests, so each test file hands `makeMount` the fake's factory.
 *
 * ⚠️ A test file that uses `mount` also mocks `next/navigation` (the screen's Reload calls
 * `useRouter`), with its own `refresh` spy.
 */

/** What the preview's `createFakeDayActions` is: a plan and a setter in, every action out. */
type FakeFactory = (
  fixture: DayPlan,
  onChange?: (plan: DayPlan) => void,
) => { actions: Required<DayActions>; failNext(): void };

type Actions = Required<DayActions>;
/** Every action, as a spy over the fake (or over what `wrap` put in its place). */
export type Spies = { [K in keyof Actions]: Mock<Actions[K]> };

/**
 * The screen as the preview route mounts it: the fake's change comes back as new props. `wrap`
 * replaces any action, to answer what the fake never does (a rejection, a stale page, a write held
 * in flight). Every action is a spy, so a test can read what the screen sent.
 */
export function makeMount(createFake: FakeFactory) {
  return { mount, show };

  function mount(
    fixture: DayPlan,
    options: {
      failNext?: boolean;
      wrap?: (actions: Actions) => Partial<DayActions>;
      /** Hand the screen `amendRow`, as 12d's routes will: Change (13b-ii). */
      change?: boolean;
    } = {},
  ) {
    const control: { plan: DayPlan; setPlan: (plan: DayPlan) => void; actions: Spies } = {
      plan: fixture,
      setPlan: () => {},
      actions: undefined as unknown as Spies,
    };
    function Harness() {
      const [plan, setPlan] = useState(fixture);
      control.plan = plan;
      control.setPlan = setPlan;
      const [actions] = useState(() => {
        const fake = createFake(fixture, setPlan);
        if (options.failNext) fake.failNext();
        const wrapped = { ...fake.actions, ...options.wrap?.(fake.actions) };
        control.actions = {
          logRow: vi.fn(wrapped.logRow),
          untickRow: vi.fn(wrapped.untickRow),
          retickRow: vi.fn(wrapped.retickRow),
          amendRow: vi.fn(wrapped.amendRow),
          reorderPrograms: vi.fn(wrapped.reorderPrograms),
        };
        // The screen gets what step 13's routes have: no Program order, and Change only when asked.
        const { logRow, untickRow, retickRow, amendRow } = control.actions;
        return options.change
          ? { logRow, untickRow, retickRow, amendRow }
          : { logRow, untickRow, retickRow };
      });
      return <DayScreen plan={plan} actions={actions} />;
    }
    render(<Harness />);
    return control;
  }

  /** A plan rendered once, with the fake's actions: for what the screen shows, not what it does. */
  function show(plan: DayPlan) {
    return render(<DayScreen plan={plan} actions={createFake(plan).actions} />);
  }
}

/** A workout's section, by its heading. */
export const workout = (name: string) => screen.getByRole('region', { name });

/** The item card (an `<li>`) named `itemName` within a workout. */
export function card(workoutName: string, itemName: string) {
  // An item in a superset carries its label first in the heading: "A1 Push press".
  const heading = within(workout(workoutName)).getByRole('heading', {
    level: 4,
    name: (name) =>
      name === itemName || (/^[A-Z]+\d+ /.test(name) && name.endsWith(` ${itemName}`)),
  });
  return heading.closest('li')!;
}
export const LOG_PREFIX = DAY_COPY.logLabel('');
export const isTick = (name: string) => name.startsWith(LOG_PREFIX);
export const tick = (el: HTMLElement) => within(el).getByRole('button', { name: isTick });
export const field = (el: HTMLElement) => within(el).getByRole<HTMLInputElement>('textbox');
export const status = () => screen.getByRole('status').textContent?.replace(/ $/, '');

/** A tap in a browser's order: pointer-down (while the field still has focus), focus, click. */
export async function press(button: HTMLElement) {
  await act(async () => {
    fireEvent.pointerDown(button);
    button.focus();
    fireEvent.click(button);
  });
}

/** A write that stays in flight until the test resolves it. */
export function held() {
  let resolve!: () => void;
  const gate = new Promise<void>((r) => (resolve = r));
  return {
    resolve: () => act(async () => resolve()),
    after: <T,>(write: () => Promise<T>) => gate.then(write),
  };
}

export const lb = (value: number) => ({ slot: QUANTITY_SLOT.primary, unit: 'lb' as const, value });
