import {
  addDays,
  dayPlanSchema,
  existingItem,
  hiddenAtSchema,
  newId,
  PROGRAM_REFUSAL,
  programViewSchema,
  QUANTITY_SLOT,
  ROW_REFUSAL,
  TRACKING_TYPE,
  TRACKING_TYPES,
  WORKOUT_NAME_MAX,
  type DayPlan,
  type RowResult,
  type RowWrite,
} from '@mat-plan/shared';
import {
  adultProgramWithCopy,
  closedDayLoggedOnly,
  everyTypeOnce,
  familyProgram,
  familyProgramAfterTakeOff,
  FIXTURE_TODAY,
  fixtureIds,
  futurePreview,
  heavyADraft,
  heavyASupersets,
  newWorkoutEmpty,
  programsList,
  todayStretchingFirst,
  todayTwoPrograms,
  workoutLeftTheWeek,
  yesterdayEditedAfterLogging,
} from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import type { MovementOptionDTO } from '@/lib/movements/movement-option';
import { appSources, code, WEB_DIR } from '@/test/source-scan';

import { createFakeDayActions, createFakeProgramActions, type FakeProgramState } from './fakes';
import { catalogPickerOptions, pickerOptions } from './picker-options';

/**
 * A library row for a test, under another name. 🔴 **Spread from a real one, never written out**:
 * a library row's fields are whatever `catalogOptionOf` gives (its taxonomy among them), and the
 * picker's option type is about to require them (CAT-3 chunk B2-i), so a hand-written literal here
 * would stop compiling the day that type gains a field. Weight × reps, like the row it stands in for.
 */
function libraryRow(over: {
  readonly publicId: string;
  readonly name: string;
  readonly aliases: readonly string[];
}): MovementOptionDTO {
  const template = catalogPickerOptions.find(
    (option) => option.trackingType === TRACKING_TYPE.weight_reps,
  );
  if (!template || template.owner !== 'catalog') {
    throw new Error('the preview lists no library row that logs weight × reps');
  }
  return { ...template, ...over };
}

/**
 * The fakes follow the accepted prototype's rules (FAM-1 plan §8, "Behaviour"). Each rule a fake
 * implements is held here, so a screen built against a fake is built against the rule and not
 * against an accident of the fake.
 */

// ── The day ─────────────────────────────────────────────────────────────────────────────────────

/** A fake over a fixture, and the latest plan it handed back. */
function day(fixture: DayPlan) {
  let latest = fixture;
  const fake = createFakeDayActions(fixture, (plan) => void (latest = plan));
  return { ...fake, plan: () => latest };
}

const itemOf = (plan: DayPlan, name: string) => {
  for (const workout of plan.workouts) {
    const item = workout.items.find((i) => i.name === name);
    if (item) return { workout, item };
  }
  throw new Error(`no item named ${name}`);
};

/** The first row of the named item that is not logged yet, as an empty ✓ on it. */
function tick(plan: DayPlan, name: string, values: RowWrite['values'] = { quantities: [] }) {
  const { workout, item } = itemOf(plan, name);
  const row = item.rows.find((r) => !r.logged);
  if (!row || !workout.workoutPublicId || !item.prescriptionPublicId) {
    throw new Error(`no open, prescribed row on ${name}`);
  }
  return {
    clientId: newId(),
    profilePublicId: plan.profilePublicId,
    day: plan.day,
    workoutPublicId: workout.workoutPublicId,
    prescriptionPublicId: item.prescriptionPublicId,
    set: row.set,
    values,
  } satisfies RowWrite;
}

function succeeded(result: RowResult) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}

const lb = (value: number) => ({ slot: QUANTITY_SLOT.primary, unit: 'lb' as const, value });

describe('the fake DayActions: ✓', () => {
  it('an empty ✓ logs the prescription for every tracking type: every-type-once', async () => {
    // The fixture logs each type's first row as prescribed. Clear them, tick each with nothing
    // typed, and the fake must store what the fixture holds.
    const cleared = structuredClone(everyTypeOnce);
    for (const workout of cleared.workouts) {
      workout.progress.done = 0;
      for (const item of workout.items) for (const row of item.rows) row.logged = null;
    }
    const { actions } = day(cleared);
    const items = everyTypeOnce.workouts.flatMap((w) => w.items);
    expect(items.map((i) => i.trackingType)).toEqual([...TRACKING_TYPES]);
    for (const item of items) {
      const result = succeeded(await actions.logRow(tick(cleared, item.name)));
      expect(result.values, item.name).toEqual(item.rows[0]?.logged?.values);
    }
  });

  it('an empty ✓ fills the row, its prescribed text and the workout’s count', async () => {
    // Athlete Two's Heavy A has nothing logged: 4 × 8 @ 25 lb on the bench.
    const { actions, plan } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press');
    const result = succeeded(await actions.logRow(write));

    expect(result.values).toEqual({ reps: 8, quantities: [lb(25)] });
    const { workout, item } = itemOf(plan(), 'DB bench press');
    expect(item.rows.find((r) => r.set === write.set)?.logged).toEqual({
      entryPublicId: result.entryPublicId,
      values: result.values,
      prescribedText: item.prescribedText,
    });
    expect(workout.progress.done).toBe(
      itemOf(heavyASupersets, 'DB bench press').workout.progress.done + 1,
    );
    expect(dayPlanSchema.safeParse(plan()).success).toBe(true);
  });

  it('logs what was typed in place of the prescription', async () => {
    const { actions } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press', { reps: 6, quantities: [lb(30)] });
    expect(succeeded(await actions.logRow(write)).values).toEqual({
      reps: 6,
      quantities: [lb(30)],
    });
  });

  it('a Check logs with nothing measured', async () => {
    const { actions } = day(heavyASupersets);
    const check = heavyASupersets.workouts
      .flatMap((w) => w.items)
      .find((i) => i.trackingType === TRACKING_TYPE.check);
    expect(check, 'the fixture has a Check item').toBeDefined();
    const result = succeeded(await actions.logRow(tick(heavyASupersets, check!.name)));
    expect(result.values).toEqual({ quantities: [] });
  });

  it('a value that is not a number is bad_value, and nothing is logged', async () => {
    const { actions, plan } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press');
    for (const reps of [Number.NaN, '8' as unknown as number, 2.5]) {
      expect(await actions.logRow({ ...write, values: { reps, quantities: [] } })).toEqual({
        ok: false,
        reason: ROW_REFUSAL.bad_value,
      });
    }
    expect(plan()).toBe(heavyASupersets);
  });

  it('a number in another unit than the item logs in is bad_value', async () => {
    const { actions } = day(heavyASupersets);
    const kg = { slot: QUANTITY_SLOT.primary, unit: 'kg' as const, value: 12 };
    const write = tick(heavyASupersets, 'DB bench press', { quantities: [kg] });
    expect(await actions.logRow(write)).toEqual({ ok: false, reason: ROW_REFUSAL.bad_value });
  });

  it('a retry under the same clientId answers as the first call did and logs once', async () => {
    const { actions, plan } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press');
    const first = await actions.logRow(write);
    expect(await actions.logRow(write)).toEqual(first);
    const { item } = itemOf(plan(), 'DB bench press');
    expect(item.rows.filter((r) => r.logged)).toHaveLength(1);
  });

  it('a second ✓ on a logged row is slot_taken', async () => {
    const { actions } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press');
    await actions.logRow(write);
    expect(await actions.logRow({ ...write, clientId: newId() })).toEqual({
      ok: false,
      reason: ROW_REFUSAL.slot_taken,
    });
  });

  it('a set past the prescribed ones is "+ Add set"', async () => {
    const { actions, plan } = day(heavyASupersets);
    const before = itemOf(heavyASupersets, 'DB bench press');
    const write = { ...tick(heavyASupersets, 'DB bench press'), set: before.item.rows.length + 1 };
    succeeded(await actions.logRow(write));

    const after = itemOf(plan(), 'DB bench press');
    expect(after.item.rows).toHaveLength(before.item.rows.length + 1);
    expect(after.workout.progress).toEqual({
      done: before.workout.progress.done + 1,
      total: before.workout.progress.total + 1,
    });
  });

  it('refuses a row of another athlete, another day or a prescription that is not there', async () => {
    const { actions } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press');
    const refused = async (change: Partial<RowWrite>) => {
      const result = await actions.logRow({ ...write, clientId: newId(), ...change });
      return result.ok ? 'ok' : result.reason;
    };
    expect(await refused({ profilePublicId: fixtureIds.athlete('a1') })).toBe(
      ROW_REFUSAL.not_found,
    );
    expect(await refused({ day: addDays(write.day, -1) })).toBe(ROW_REFUSAL.not_found);
    expect(await refused({ prescriptionPublicId: newId() })).toBe(ROW_REFUSAL.program_changed);
  });

  it('a workout that left the week takes no new row', async () => {
    const off = workoutLeftTheWeek.workouts.find((w) => !w.scheduled);
    const item = off?.items.find((i) => i.prescriptionPublicId);
    expect(off && item, 'the fixture has an off-week workout with a live item').toBeTruthy();
    const { actions } = day(workoutLeftTheWeek);
    const result = await actions.logRow({
      clientId: newId(),
      profilePublicId: workoutLeftTheWeek.profilePublicId,
      day: workoutLeftTheWeek.day,
      workoutPublicId: off!.workoutPublicId!,
      prescriptionPublicId: item!.prescriptionPublicId!,
      set: item!.rows.length + 1,
      values: { quantities: [] },
    });
    expect(result).toEqual({ ok: false, reason: ROW_REFUSAL.not_scheduled });
  });

  it.each([
    ['a closed day', closedDayLoggedOnly],
    ['a future day', futurePreview],
  ])('%s is read-only: no ✓, no un-tick, no Change', async (_name, fixture) => {
    const { actions } = day(fixture);
    const closed = { ok: false, reason: ROW_REFUSAL.closed_day };
    const { profilePublicId, day: on } = fixture;
    const workout = fixture.workouts[0]!;
    const item = workout.items[0]!;
    expect(
      await actions.logRow({
        clientId: newId(),
        profilePublicId,
        day: on,
        workoutPublicId: workout.workoutPublicId!,
        prescriptionPublicId: item.prescriptionPublicId!,
        set: 1,
        values: { quantities: [] },
      }),
    ).toEqual(closed);

    const logged = fixture.workouts
      .flatMap((w) => w.items.flatMap((i) => i.rows))
      .find((r) => r.logged);
    if (!logged?.logged) return; // a future day has no rows at all
    const { entryPublicId, values } = logged.logged;
    expect(await actions.untickRow({ profilePublicId, day: on, entryPublicId })).toEqual(closed);
    expect(await actions.amendRow({ profilePublicId, entryPublicId, values })).toEqual(closed);
  });
});

describe('the fake DayActions: un-tick, re-tick and Change', () => {
  /** Every type's first row is logged as prescribed in this fixture. */
  const loggedBench = () => {
    const { item } = itemOf(everyTypeOnce, 'DB bench press');
    const logged = item.rows[0]?.logged;
    if (!logged) throw new Error('the fixture logs the bench press');
    return logged;
  };
  const { profilePublicId, day: on } = everyTypeOnce;

  it('un-tick leaves no tomb, and answers with a token re-tick takes', async () => {
    const { actions, plan } = day(everyTypeOnce);
    const { entryPublicId, values } = loggedBench();
    const before = itemOf(everyTypeOnce, 'DB bench press').workout.progress.done;

    const unticked = succeeded(
      await actions.untickRow({ profilePublicId, day: on, entryPublicId }),
    );
    expect(unticked.values).toEqual(values);
    expect(hiddenAtSchema.safeParse(unticked.hiddenAt).success).toBe(true);
    let now = itemOf(plan(), 'DB bench press');
    expect(now.item.rows[0]).toMatchObject({ set: 1, logged: null });
    expect(now.workout.progress.done).toBe(before - 1);

    const reticked = await actions.retickRow({
      profilePublicId,
      day: on,
      entryPublicId,
      hiddenAt: unticked.hiddenAt!,
    });
    expect(reticked).toEqual({ ok: true, entryPublicId, values });
    now = itemOf(plan(), 'DB bench press');
    expect(now.item.rows[0]?.logged).toEqual(loggedBench());
    expect(now.workout.progress.done).toBe(before);
    expect(plan()).toEqual(everyTypeOnce);
  });

  it('a replayed un-tick answers with the same token', async () => {
    const { actions } = day(everyTypeOnce);
    const input = { profilePublicId, day: on, entryPublicId: loggedBench().entryPublicId };
    const first = await actions.untickRow(input);
    expect(await actions.untickRow(input)).toEqual(first);
  });

  it('🔴 un-tick and re-tick answer bad_value for input the schema refuses, and change nothing (C31)', async () => {
    const { actions, plan } = day(everyTypeOnce);
    const { entryPublicId, values } = loggedBench();
    const badValue = { ok: false, reason: ROW_REFUSAL.bad_value };
    // An id that is not a lower-case UUID never reaches the list of this athlete's entries.
    expect(
      await actions.untickRow({ profilePublicId, day: on, entryPublicId: 'not-an-id' }),
    ).toEqual(badValue);
    expect(itemOf(plan(), 'DB bench press').item.rows[0]?.logged?.entryPublicId).toBe(
      entryPublicId,
    );

    const unticked = succeeded(
      await actions.untickRow({ profilePublicId, day: on, entryPublicId }),
    );
    const retick = { profilePublicId, day: on, entryPublicId };
    // The right shape, but no real instant: the database's cast would throw on each.
    for (const hiddenAt of [
      '2026-02-30T00:00:00.000000Z',
      '2026-13-01T00:00:00.000000Z',
      '2026-11-17T24:00:00.000000Z',
      '2026-11-17T18:04:60.000000Z',
    ]) {
      expect(await actions.retickRow({ ...retick, hiddenAt }), hiddenAt).toEqual(badValue);
    }
    // Three fractional digits, as a token that went through a `Date`: the same answer.
    expect(await actions.retickRow({ ...retick, hiddenAt: '2026-11-14T15:04:05.123Z' })).toEqual(
      badValue,
    );
    // Nothing came back, and the true token still brings the entry back.
    expect(itemOf(plan(), 'DB bench press').item.rows[0]?.logged).toBeNull();
    expect(await actions.retickRow({ ...retick, hiddenAt: unticked.hiddenAt! })).toEqual({
      ok: true,
      entryPublicId,
      values,
    });
  });

  it('re-tick refuses another token; after a new ✓ the entry is already back, and it answers with it', async () => {
    const { actions } = day(everyTypeOnce);
    const { entryPublicId } = loggedBench();
    const unticked = succeeded(
      await actions.untickRow({ profilePublicId, day: on, entryPublicId }),
    );
    const retick = { profilePublicId, day: on, entryPublicId, hiddenAt: unticked.hiddenAt! };

    expect(await actions.retickRow({ ...retick, hiddenAt: '2026-11-14T00:00:00.000000Z' })).toEqual(
      { ok: false, reason: ROW_REFUSAL.not_found },
    );
    // A new ✓ on the set brings the same entry back (one entry per slot, plan D35), so the
    // re-tick that arrives late has nothing to restore and answers with the entry as it is now.
    const again = succeeded(
      await actions.logRow(
        tick(itemOnly(everyTypeOnce, 'DB bench press'), 'DB bench press', {
          reps: 9,
          quantities: [lb(30)],
        }),
      ),
    );
    expect(again.entryPublicId).toBe(entryPublicId);
    expect(await actions.retickRow(retick)).toEqual(again);
  });

  it('a new ✓ on an un-ticked set brings the same entry back with the new numbers: one entry per slot', async () => {
    const { actions, plan } = day(heavyASupersets);
    const first = tick(heavyASupersets, 'DB bench press', { reps: 8, quantities: [lb(25)] });
    const address = {
      profilePublicId: heavyASupersets.profilePublicId,
      day: heavyASupersets.day,
    };
    const made = succeeded(await actions.logRow(first));
    const before = itemOf(plan(), 'DB bench press');

    // Un-tick and ✓ again, five times over, each with another number and a new attempt.
    let latest = { ...first };
    for (const reps of [9, 10, 11, 12, 13]) {
      succeeded(await actions.untickRow({ ...address, entryPublicId: made.entryPublicId }));
      latest = { ...first, clientId: newId(), values: { reps, quantities: [lb(reps * 5)] } };
      const back = succeeded(await actions.logRow(latest));
      // The same entry every time, never a second one, holding what was just typed.
      expect(back.entryPublicId).toBe(made.entryPublicId);
      expect(back.values).toEqual({ reps, quantities: [lb(reps * 5)] });
    }
    const after = itemOf(plan(), 'DB bench press');
    expect(after.item.rows.map((r) => r.set)).toEqual(before.item.rows.map((r) => r.set));
    expect(after.workout.progress).toEqual(before.workout.progress);
    expect(after.item.rows[0]?.logged).toMatchObject({
      entryPublicId: made.entryPublicId,
      values: { reps: 13, quantities: [lb(65)] },
    });

    // A retry of the ✓ that brought it back answers as that ✓ did.
    expect(await actions.logRow(latest)).toMatchObject({
      ok: true,
      entryPublicId: made.entryPublicId,
      values: { reps: 13 },
    });
    // The ✓ it was FIRST logged under names nothing now: replayed, it is a ✓ on a logged set.
    expect(await actions.logRow(first)).toEqual({ ok: false, reason: ROW_REFUSAL.slot_taken });

    // Un-ticked once more, the entry's current ✓ answers `own_hidden`: a replay never revives.
    succeeded(await actions.untickRow({ ...address, entryPublicId: made.entryPublicId }));
    expect(await actions.logRow(latest)).toEqual({ ok: false, reason: ROW_REFUSAL.own_hidden });
    expect(itemOf(plan(), 'DB bench press').item.rows[0]?.logged).toBeNull();
  });

  it('a revived entry is what a new ✓ would have made: the numbers and the text of the prescription as it is now', async () => {
    // "Yesterday, after the program was edited": the bench press was logged as 4 × 8 @ 25 lb and
    // the prescription now reads 3 × 8 @ 30 lb.
    const { actions, plan } = day(yesterdayEditedAfterLogging);
    const { item } = itemOf(yesterdayEditedAfterLogging, 'DB bench press');
    const old = item.rows.find((r) => r.logged)!;
    expect(old.logged!.prescribedText).not.toBe(item.prescribedText);
    const address = {
      profilePublicId: yesterdayEditedAfterLogging.profilePublicId,
      day: yesterdayEditedAfterLogging.day,
    };
    succeeded(await actions.untickRow({ ...address, entryPublicId: old.logged!.entryPublicId }));

    // An empty ✓: the numbers come from the prescription as it is now, and so does the text.
    const fresh = succeeded(
      await actions.logRow({
        ...tick(itemOnly(yesterdayEditedAfterLogging, 'DB bench press'), 'DB bench press'),
        set: old.set,
      }),
    );
    expect(fresh.entryPublicId).toBe(old.logged!.entryPublicId);
    const row = itemOf(plan(), 'DB bench press').item.rows.find((r) => r.set === old.set)!;
    expect(row.logged).toEqual({
      entryPublicId: old.logged!.entryPublicId,
      values: { reps: item.target.reps, quantities: item.target.quantities },
      prescribedText: item.prescribedText,
    });
  });

  it('a ✓ that is refused leaves the un-ticked entry hidden and untouched', async () => {
    const { actions, plan } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press', { reps: 8, quantities: [lb(25)] });
    const address = {
      profilePublicId: heavyASupersets.profilePublicId,
      day: heavyASupersets.day,
    };
    const made = succeeded(await actions.logRow(write));
    const hidden = succeeded(
      await actions.untickRow({ ...address, entryPublicId: made.entryPublicId }),
    );

    // A number the type cannot hold, then a write that fails outright.
    expect(
      await actions.logRow({
        ...write,
        clientId: newId(),
        values: { reps: 8, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'sec', value: 5 }] },
      }),
    ).toEqual({ ok: false, reason: ROW_REFUSAL.bad_value });
    expect(
      itemOf(plan(), 'DB bench press').item.rows.find((r) => r.set === write.set)?.logged,
    ).toBeNull();
    // Still restorable under its token, with the numbers it had.
    expect(
      await actions.retickRow({
        ...address,
        entryPublicId: made.entryPublicId,
        hiddenAt: hidden.hiddenAt!,
      }),
    ).toEqual({ ok: true, entryPublicId: made.entryPublicId, values: made.values });
  });

  it('a clientId a revive replaced is forgotten: the known limit, pinned so closing it is deliberate', async () => {
    // The entry stores one `clientId`. After ✓(c1), un-tick, ✓(c2), the entry answers to c2 and
    // nothing remembers c1.
    const { actions, plan } = day(heavyASupersets);
    const c1 = tick(heavyASupersets, 'DB bench press', { reps: 8, quantities: [lb(25)] });
    const address = {
      profilePublicId: heavyASupersets.profilePublicId,
      day: heavyASupersets.day,
    };
    const made = succeeded(await actions.logRow(c1));
    succeeded(await actions.untickRow({ ...address, entryPublicId: made.entryPublicId }));
    const c2 = { ...c1, clientId: newId(), values: { reps: 9, quantities: [lb(30)] } };
    succeeded(await actions.logRow(c2));

    // While the set is logged, c1 replayed is a ✓ on a logged set.
    expect(await actions.logRow(c1)).toEqual({ ok: false, reason: ROW_REFUSAL.slot_taken });

    // Un-ticked again: c2, the entry's current id, never revives...
    succeeded(await actions.untickRow({ ...address, entryPublicId: made.entryPublicId }));
    expect(await actions.logRow(c2)).toEqual({ ok: false, reason: ROW_REFUSAL.own_hidden });
    // ...but c1 cannot be told from a new ✓, and brings the entry back with its old numbers.
    // ⚠️ This is the limit `rowWriteSchema` records (plan D35), not a wanted behaviour: the real
    // writer has nowhere to remember c1 either. If replaced ids are ever kept, this becomes
    // `own_hidden` and this test changes with it.
    expect(await actions.logRow(c1)).toEqual({
      ok: true,
      entryPublicId: made.entryPublicId,
      values: { reps: 8, quantities: [lb(25)] },
    });
    expect(itemOf(plan(), 'DB bench press').item.rows[0]?.logged?.values).toEqual({
      reps: 8,
      quantities: [lb(25)],
    });
  });

  it('two un-ticks in the same instant get different tokens', async () => {
    const { actions } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press');
    const address = {
      profilePublicId: heavyASupersets.profilePublicId,
      day: heavyASupersets.day,
    };
    const made = succeeded(await actions.logRow(write));
    const first = succeeded(
      await actions.untickRow({ ...address, entryPublicId: made.entryPublicId }),
    );
    succeeded(await actions.logRow({ ...write, clientId: newId() }));
    const second = succeeded(
      await actions.untickRow({ ...address, entryPublicId: made.entryPublicId }),
    );
    expect(second.hiddenAt).not.toBe(first.hiddenAt);
    // The first un-tick's token is dead: it must not restore what the second un-tick hid.
    expect(
      await actions.retickRow({
        ...address,
        entryPublicId: made.entryPublicId,
        hiddenAt: first.hiddenAt!,
      }),
    ).toEqual({ ok: false, reason: ROW_REFUSAL.not_found });
    expect(
      (
        await actions.retickRow({
          ...address,
          entryPublicId: made.entryPublicId,
          hiddenAt: second.hiddenAt!,
        })
      ).ok,
    ).toBe(true);
  });

  it('a ✓ brings back only the entry of its own set', async () => {
    const { actions } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press');
    const one = succeeded(await actions.logRow(write));
    succeeded(
      await actions.untickRow({
        profilePublicId: heavyASupersets.profilePublicId,
        day: heavyASupersets.day,
        entryPublicId: one.entryPublicId,
      }),
    );
    // Another set of the same item, and the same set of another item, are other slots.
    const otherSet = succeeded(
      await actions.logRow({ ...write, clientId: newId(), set: write.set + 1 }),
    );
    expect(otherSet.entryPublicId).not.toBe(one.entryPublicId);
    const another = heavyASupersets.workouts
      .flatMap((w) => w.items)
      .find(
        (i) =>
          i.name !== 'DB bench press' && i.prescriptionPublicId && i.rows.some((r) => !r.logged),
      );
    if (!another) throw new Error('the fixture has a second item with an open row');
    const otherItem = succeeded(await actions.logRow(tick(heavyASupersets, another.name)));
    expect(otherItem.entryPublicId).not.toBe(one.entryPublicId);
  });

  it('the values are judged before the set: a bad number on a logged set is bad_value, not slot_taken', async () => {
    // The real writer has no slot pre-check; it learns a set is taken at the insert (contract C10).
    const { actions } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press', { reps: 8, quantities: [lb(25)] });
    succeeded(await actions.logRow(write));
    const onTheSameSet = { ...write, clientId: newId() };
    expect(await actions.logRow(onTheSameSet)).toEqual({
      ok: false,
      reason: ROW_REFUSAL.slot_taken,
    });
    expect(
      await actions.logRow({
        ...onTheSameSet,
        values: { reps: 8, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'sec', value: 5 }] },
      }),
    ).toEqual({ ok: false, reason: ROW_REFUSAL.bad_value });
  });

  it('a slot named twice, and a value over the unit’s ceiling, are bad_value on ✓ and on Change', async () => {
    const { actions, plan } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press', { reps: 8, quantities: [lb(25)] });
    const refused = { ok: false, reason: ROW_REFUSAL.bad_value };
    expect(
      await actions.logRow({ ...write, values: { reps: 8, quantities: [lb(25), lb(30)] } }),
    ).toEqual(refused);
    expect(
      await actions.logRow({ ...write, values: { reps: 8, quantities: [lb(99_000)] } }),
    ).toEqual(refused);

    const made = succeeded(await actions.logRow(write));
    const amend = {
      profilePublicId: heavyASupersets.profilePublicId,
      entryPublicId: made.entryPublicId,
    };
    expect(
      await actions.amendRow({ ...amend, values: { reps: 8, quantities: [lb(25), lb(30)] } }),
    ).toEqual(refused);
    expect(
      await actions.amendRow({ ...amend, values: { reps: 8, quantities: [lb(99_000)] } }),
    ).toEqual(refused);
    // Nothing was changed by the refused amends: the row still holds what the ✓ wrote.
    expect(
      itemOf(plan(), 'DB bench press').item.rows.find((r) => r.set === write.set)?.logged,
    ).toMatchObject({
      entryPublicId: made.entryPublicId,
      values: { reps: 8, quantities: [lb(25)] },
    });
    expect(
      await actions.amendRow({ ...amend, values: { reps: 9, quantities: [lb(30)] } }),
    ).toMatchObject({ ok: true, values: { reps: 9, quantities: [lb(30)] } });
  });

  it('the ✓ that made an un-ticked row answers own_hidden while its entry is hidden', async () => {
    const { actions } = day(heavyASupersets);
    const write = tick(heavyASupersets, 'DB bench press');
    const { entryPublicId } = succeeded(await actions.logRow(write));
    await actions.untickRow({
      profilePublicId: heavyASupersets.profilePublicId,
      day: heavyASupersets.day,
      entryPublicId,
    });
    expect(await actions.logRow(write)).toEqual({ ok: false, reason: ROW_REFUSAL.own_hidden });
    // A new ✓ is a new attempt, and it brings that entry back; it does not make a second.
    expect(await actions.logRow({ ...write, clientId: newId() })).toMatchObject({
      ok: true,
      entryPublicId,
    });
  });

  it('a row whose item left the workout can be un-ticked and ticked back', async () => {
    const removed = yesterdayEditedAfterLogging.workouts
      .flatMap((w) => w.items)
      .find((i) => i.prescriptionPublicId === null);
    const logged = removed?.rows[0]?.logged;
    expect(logged, 'the fixture has a logged row whose prescription was removed').toBeTruthy();
    const { actions, plan } = day(yesterdayEditedAfterLogging);
    const ids = {
      profilePublicId: yesterdayEditedAfterLogging.profilePublicId,
      day: yesterdayEditedAfterLogging.day,
      entryPublicId: logged!.entryPublicId,
    };

    // Change is not offered on such a row.
    expect(await actions.amendRow({ ...ids, values: logged!.values })).toEqual({
      ok: false,
      reason: ROW_REFUSAL.program_changed,
    });

    const unticked = succeeded(await actions.untickRow(ids));
    // Its rows are in neither number of "6 of 10": the count is the same with the row un-ticked.
    expect(plan()).not.toEqual(yesterdayEditedAfterLogging);
    expect(plan().workouts.map((w) => w.progress)).toEqual(
      yesterdayEditedAfterLogging.workouts.map((w) => w.progress),
    );
    succeeded(await actions.retickRow({ ...ids, hiddenAt: unticked.hiddenAt! }));
    expect(plan()).toEqual(yesterdayEditedAfterLogging);
    // A replayed re-tick finds the row live and answers as the first did.
    expect((await actions.retickRow({ ...ids, hiddenAt: unticked.hiddenAt! })).ok).toBe(true);
  });

  it('a workout that left the week is read-only: no un-tick, no Change', async () => {
    const off = workoutLeftTheWeek.workouts.find((w) => !w.scheduled);
    const logged = off?.items.flatMap((i) => i.rows).find((r) => r.logged)?.logged;
    expect(logged, 'the off-week workout has a logged row').toBeTruthy();
    const { actions, plan } = day(workoutLeftTheWeek);
    const { profilePublicId, day: on } = workoutLeftTheWeek;
    const refused = { ok: false, reason: ROW_REFUSAL.not_scheduled };
    const { entryPublicId, values } = logged!;
    expect(await actions.untickRow({ profilePublicId, day: on, entryPublicId })).toEqual(refused);
    expect(await actions.amendRow({ profilePublicId, entryPublicId, values })).toEqual(refused);
    expect(plan()).toBe(workoutLeftTheWeek);
  });

  it('Change replaces a logged row’s numbers', async () => {
    const { actions, plan } = day(everyTypeOnce);
    const { entryPublicId } = loggedBench();
    const values = { reps: 5, quantities: [lb(35)] };
    expect(await actions.amendRow({ profilePublicId, entryPublicId, values })).toEqual({
      ok: true,
      entryPublicId,
      values,
    });
    expect(itemOf(plan(), 'DB bench press').item.rows[0]?.logged?.values).toEqual(values);
  });

  it('🔴 Change is judged in the unit the row was LOGGED in, not the item’s unit now (C28)', async () => {
    // The prescription's unit was edited from lb to kg after the bench press was logged in lb.
    const edited = structuredClone(everyTypeOnce);
    const bench = itemOf(edited, 'DB bench press').item;
    expect(bench.unit).toBe('lb');
    bench.unit = 'kg';
    const { actions, plan } = day(edited);
    const { entryPublicId } = loggedBench();
    const kg = (value: number) => ({ ...lb(value), unit: 'kg' as const });

    // A kg number would be stored on a row still labelled lb: refused, and nothing changes.
    expect(
      await actions.amendRow({
        profilePublicId,
        entryPublicId,
        values: { reps: 5, quantities: [kg(16)] },
      }),
    ).toEqual({ ok: false, reason: ROW_REFUSAL.bad_value });
    expect(plan()).toBe(edited);

    // The same row is still changed in lb.
    const values = { reps: 5, quantities: [lb(35)] };
    expect(await actions.amendRow({ profilePublicId, entryPublicId, values })).toEqual({
      ok: true,
      entryPublicId,
      values,
    });
    expect(itemOf(plan(), 'DB bench press').item.rows[0]?.logged?.values).toEqual(values);
  });

  it('a new ✓ on that item is still in the item’s unit now, beside a row logged in lb', async () => {
    // C28 is about a logged row only: a new ✓ follows the prescription as it reads today, and
    // the lb row beside it is left as it is.
    const edited = structuredClone(everyTypeOnce);
    const { item, workout } = itemOf(edited, 'DB bench press');
    item.unit = 'kg';
    item.target = { reps: null, quantities: [] };
    const open = item.rows.find((row) => !row.logged);
    if (!open) throw new Error('the bench press has a set still to log');
    const { actions, plan } = day(edited);
    const write = (unit: 'lb' | 'kg') =>
      actions.logRow({
        profilePublicId,
        day: on,
        clientId: newId(),
        workoutPublicId: workout.workoutPublicId!,
        prescriptionPublicId: item.prescriptionPublicId!,
        set: open.set,
        values: { reps: 5, quantities: [{ ...lb(20), unit }] },
      });
    expect(await write('lb')).toEqual({ ok: false, reason: ROW_REFUSAL.bad_value });
    expect((await write('kg')).ok).toBe(true);
    const rows = itemOf(plan(), 'DB bench press').item.rows;
    expect(rows[0]?.logged).toEqual(loggedBench());
    expect(rows.find((row) => row.set === open.set)?.logged?.values.quantities[0]?.unit).toBe('kg');
  });

  it('Change keeps the old number when the new one is blank or not a number', async () => {
    const { actions, plan } = day(everyTypeOnce);
    const { entryPublicId } = loggedBench();
    const refused = { ok: false, reason: ROW_REFUSAL.bad_value };
    // Blank: no reps, or no load. Unlike a ✓, there is no prescription to fall back on.
    expect(
      await actions.amendRow({ profilePublicId, entryPublicId, values: { quantities: [lb(35)] } }),
    ).toEqual(refused);
    expect(
      await actions.amendRow({
        profilePublicId,
        entryPublicId,
        values: { reps: 5, quantities: [] },
      }),
    ).toEqual(refused);
    expect(
      await actions.amendRow({
        profilePublicId,
        entryPublicId,
        values: { reps: Number.NaN, quantities: [lb(35)] },
      }),
    ).toEqual(refused);
    expect(plan()).toBe(everyTypeOnce);
  });
});

/** The same plan with one item's first row cleared, to build a ✓ for a row the fake has un-ticked. */
function itemOnly(plan: DayPlan, name: string): DayPlan {
  const copy = structuredClone(plan);
  const row = itemOf(copy, name).item.rows[0];
  if (row) row.logged = null;
  return copy;
}

describe('the fake DayActions: the switch and the program order', () => {
  it('failNext makes the next call fail once with retry, and changes nothing', async () => {
    const { actions, failNext, plan } = day(todayTwoPrograms);
    const open = todayTwoPrograms.workouts
      .flatMap((w) => w.items)
      .find((i) => i.prescriptionPublicId && i.rows.some((r) => !r.logged));
    expect(open, 'today has a row still to log').toBeDefined();
    const write = tick(todayTwoPrograms, open!.name);

    failNext();
    expect(await actions.logRow(write)).toEqual({ ok: false, reason: ROW_REFUSAL.retry });
    expect(plan()).toBe(todayTwoPrograms);
    // The retry reuses the clientId (plan D24) and goes through.
    expect((await actions.logRow(write)).ok).toBe(true);
  });

  it('reordering the programs gives the day the prototype shows: today-stretching-first', async () => {
    const { actions, plan } = day(todayTwoPrograms);
    const result = await actions.reorderPrograms({
      profilePublicId: todayTwoPrograms.profilePublicId,
      programPublicIds: todayTwoPrograms.currentPrograms.map((p) => p.programPublicId).reverse(),
    });
    expect(result).toEqual({ ok: true });
    expect(plan()).toEqual(todayStretchingFirst);
  });

  it('refuses an order that is not the athlete’s full list', async () => {
    const { actions } = day(todayTwoPrograms);
    const { profilePublicId } = todayTwoPrograms;
    const [first] = todayTwoPrograms.currentPrograms.map((p) => p.programPublicId);
    const invalid = { ok: false, reason: PROGRAM_REFUSAL.invalid };
    expect(await actions.reorderPrograms({ profilePublicId, programPublicIds: [first!] })).toEqual(
      invalid,
    );
    expect(
      await actions.reorderPrograms({ profilePublicId, programPublicIds: [first!, newId()] }),
    ).toEqual(invalid);
    expect(
      await actions.reorderPrograms({ profilePublicId, programPublicIds: [first!, first!] }),
    ).toEqual(invalid);
  });
});

// ── The program builder ─────────────────────────────────────────────────────────────────────────

function builder(seed: Partial<FakeProgramState> = {}) {
  const start: FakeProgramState = {
    programs: [...programsList],
    program: familyProgram,
    items: [...pickerOptions],
    ...seed,
  };
  let latest = start;
  const fake = createFakeProgramActions(start, (state) => void (latest = state));
  return { ...fake, state: () => latest, view: () => latest.program! };
}

const refusal = (reason: keyof typeof PROGRAM_REFUSAL) => ({ ok: false, reason });
const [heavyA, conditioning] = [
  familyProgram.workouts.find((w) => w.name === 'Heavy A')!,
  familyProgram.workouts.find((w) => w.name === 'Conditioning')!,
];

describe('the fake ProgramActions: programs', () => {
  it('a program is created by naming it, once per clientId', async () => {
    const { actions, state } = builder();
    const input = { clientId: newId(), name: 'Off season' };
    const created = await actions.createProgram(input);
    expect(created.ok).toBe(true);
    expect(await actions.createProgram(input)).toEqual(created);
    expect(state().programs.map((p) => p.name)).toEqual([
      ...programsList.map((p) => p.name),
      'Off season',
    ]);
  });

  it('refuses an empty name and a name another program has', async () => {
    const { actions } = builder();
    expect(await actions.createProgram({ clientId: newId(), name: '  ' })).toEqual(
      refusal('invalid'),
    );
    expect(await actions.createProgram({ clientId: newId(), name: familyProgram.name })).toEqual(
      refusal('name_taken'),
    );
  });

  it('a rename shows on the list, the page and the Put-on dialog, and not on a frozen "from"', async () => {
    const { actions, state, view } = builder();
    const { programPublicId } = familyProgram;
    await actions.copyWorkout({
      clientId: newId(),
      workoutPublicId: heavyA.workoutPublicId,
      toProgramPublicId: programPublicId,
      weekdays: [],
      label: null,
    });
    expect(await actions.renameProgram({ programPublicId, name: 'Winter block' })).toEqual({
      ok: true,
    });
    // Where the copy came from is the program's name on the day of the copy.
    expect(view().workouts.map((w) => w.copiedFrom?.programName ?? null)).toContain(
      familyProgram.name,
    );
    expect(view().candidates.map((c) => c.keeps)).toEqual(
      familyProgram.candidates.map((c) =>
        c.keeps.map((kept) => (kept === familyProgram.name ? 'Winter block' : kept)),
      ),
    );
    expect(view().name).toBe('Winter block');
    expect(state().programs.find((p) => p.programPublicId === programPublicId)?.name).toBe(
      'Winter block',
    );
    expect(view().candidates.flatMap((c) => c.keeps)).not.toContain(familyProgram.name);
    expect(programViewSchema.safeParse(view()).success).toBe(true);

    const other = programsList.find((p) => p.programPublicId !== programPublicId)!;
    expect(await actions.renameProgram({ programPublicId, name: other.name })).toEqual(
      refusal('name_taken'),
    );
    expect(await actions.renameProgram({ programPublicId: newId(), name: 'Nobody’s' })).toEqual(
      refusal('not_found'),
    );
  });
});

describe('the fake ProgramActions: workouts and the week', () => {
  it('saves a new workout once, however often the save is replayed', async () => {
    const { actions, view } = builder();
    const draft = { ...newWorkoutEmpty, name: 'Mobility' };
    const saved = await actions.saveWorkout(draft);
    expect(saved.ok).toBe(true);
    expect(await actions.saveWorkout(draft)).toEqual(saved);
    expect(view().workouts.filter((w) => w.name === 'Mobility')).toEqual([
      {
        workoutPublicId: saved.ok && saved.workoutPublicId,
        name: 'Mobility',
        itemCount: 0,
        usedOn: [],
        copiedFrom: null,
      },
    ]);
  });

  it('saves an edit in place', async () => {
    const { actions, view } = builder();
    const draft = { ...heavyADraft, name: 'Heavy day', items: heavyADraft.items.slice(0, 2) };
    expect(await actions.saveWorkout(draft)).toEqual({
      ok: true,
      workoutPublicId: heavyADraft.workoutPublicId,
    });
    expect(view().workouts).toHaveLength(familyProgram.workouts.length);
    expect(view().workouts.find((w) => w.workoutPublicId === heavyA.workoutPublicId)).toMatchObject(
      { name: 'Heavy day', itemCount: 2, usedOn: heavyA.usedOn },
    );
  });

  it('refuses a workout with no name, a name the program already has, and one it does not hold', async () => {
    const { actions } = builder();
    expect(await actions.saveWorkout(newWorkoutEmpty)).toEqual(refusal('invalid'));
    expect(await actions.saveWorkout({ ...newWorkoutEmpty, name: heavyA.name })).toEqual(
      refusal('name_taken'),
    );
    expect(await actions.saveWorkout({ ...heavyADraft, workoutPublicId: newId() })).toEqual(
      refusal('not_found'),
    );
    expect(await actions.saveWorkout({ ...heavyADraft, programPublicId: newId() })).toEqual(
      refusal('not_found'),
    );
  });

  it('refuses a save that breaks the sets rule, and changes nothing', async () => {
    // `saveWorkoutSchema`'s rule: a set count exactly when the item's type is logged set by set.
    const { actions, view } = builder();
    const [first, ...rest] = heavyADraft.items;
    expect(first.sets).not.toBeNull();
    expect(
      await actions.saveWorkout({ ...heavyADraft, items: [{ ...first, sets: null }, ...rest] }),
    ).toEqual(refusal('invalid'));
    const check = { ...first, trackingType: TRACKING_TYPE.check, sets: 3 };
    expect(await actions.saveWorkout({ ...heavyADraft, items: [check, ...rest] })).toEqual(
      refusal('invalid'),
    );
    const duration = { ...first, trackingType: TRACKING_TYPE.duration, sets: 3 };
    expect(await actions.saveWorkout({ ...heavyADraft, items: [duration, ...rest] })).toEqual(
      refusal('invalid'),
    );
    expect(view()).toEqual(familyProgram);
    // The same cards with the rule kept still save.
    const fixed = { ...check, sets: null };
    expect((await actions.saveWorkout({ ...heavyADraft, items: [fixed, ...rest] })).ok).toBe(true);
  });

  it('saves a week, and each workout says which days use it, Monday first', async () => {
    const { actions, view } = builder();
    const days = structuredClone(familyProgram.week);
    days[0] = [{ workoutPublicId: heavyA.workoutPublicId, label: 'Evening' }];
    expect(
      await actions.saveWeek({ programPublicId: familyProgram.programPublicId, days }),
    ).toEqual({ ok: true });
    expect(view().week[0]).toEqual(days[0]);
    expect(
      view().workouts.find((w) => w.workoutPublicId === heavyA.workoutPublicId)?.usedOn,
    ).toEqual([...heavyA.usedOn, 0]);
    expect(programViewSchema.safeParse(view()).success).toBe(true);
  });

  it('a workout runs at most once a day: once_per_day', async () => {
    const { actions, view } = builder();
    const days = structuredClone(familyProgram.week);
    const slot = { workoutPublicId: heavyA.workoutPublicId, label: null };
    days[0] = [slot, { ...slot, label: 'Evening' }];
    expect(
      await actions.saveWeek({ programPublicId: familyProgram.programPublicId, days }),
    ).toEqual(refusal('once_per_day'));
    expect(view()).toBe(familyProgram);
  });

  it('refuses a week that names a workout the program does not have', async () => {
    const { actions } = builder();
    const days = structuredClone(familyProgram.week);
    days[0] = [{ workoutPublicId: newId(), label: null }];
    expect(
      await actions.saveWeek({ programPublicId: familyProgram.programPublicId, days }),
    ).toEqual(refusal('not_found'));
  });

  it('a copy inside one program is renamed within the limit and says where it came from', async () => {
    const { actions, view } = builder();
    const long = 'A workout name of thirty chars';
    expect(long).toHaveLength(WORKOUT_NAME_MAX);
    await actions.saveWorkout({ ...heavyADraft, name: long });
    const copy = {
      clientId: newId(),
      workoutPublicId: heavyA.workoutPublicId,
      toProgramPublicId: familyProgram.programPublicId,
      weekdays: [0 as const, 3 as const],
      label: 'Evening',
    };
    const copied = await actions.copyWorkout(copy);
    expect(copied.ok).toBe(true);
    // A replay adds nothing.
    expect(await actions.copyWorkout(copy)).toEqual(copied);

    const made = view().workouts.filter((w) => w.copiedFrom);
    expect(made).toEqual([
      {
        workoutPublicId: copied.ok && copied.workoutPublicId,
        name: 'A workout name of thirt (copy)',
        itemCount: heavyA.itemCount,
        usedOn: [3, 0],
        copiedFrom: { programName: familyProgram.name, on: FIXTURE_TODAY },
      },
    ]);
    expect(made[0]?.name).toHaveLength(WORKOUT_NAME_MAX);
    expect(view().week[3].at(-1)).toEqual({
      workoutPublicId: made[0]?.workoutPublicId,
      label: 'Evening',
    });
    expect(programViewSchema.safeParse(view()).success).toBe(true);
  });

  it('a copy into another program answers with its id and leaves this page alone', async () => {
    const { actions, view } = builder();
    const [other] = familyProgram.otherPrograms;
    const copied = await actions.copyWorkout({
      clientId: newId(),
      workoutPublicId: conditioning.workoutPublicId,
      toProgramPublicId: other!.programPublicId,
      weekdays: [1],
      label: null,
    });
    expect(copied.ok).toBe(true);
    expect(view()).toEqual(familyProgram);
    expect(
      await actions.copyWorkout({
        clientId: newId(),
        workoutPublicId: conditioning.workoutPublicId,
        toProgramPublicId: newId(),
        weekdays: [],
        label: null,
      }),
    ).toEqual(refusal('not_found'));
  });

  it('a copy that would clash in another program is refused; with a name of its own it goes through', async () => {
    const { actions, view } = builder();
    const [other] = familyProgram.otherPrograms;
    const copy = (name?: string) => ({
      clientId: newId(),
      workoutPublicId: conditioning.workoutPublicId,
      toProgramPublicId: other!.programPublicId,
      weekdays: [],
      label: null,
      ...(name === undefined ? {} : { name }),
    });
    // The first copy lands under the workout's own name. A second would be a second workout of
    // that name in the other program: never (maintainer, 2026-11-16).
    expect((await actions.copyWorkout(copy())).ok).toBe(true);
    expect(await actions.copyWorkout(copy())).toEqual(refusal('name_taken'));
    // The dialog then asks for a name, and the copy goes through under it...
    const named = `${conditioning.name} (copy)`;
    expect((await actions.copyWorkout(copy(named))).ok).toBe(true);
    // ...once: that name is taken there now too, by its fold.
    expect(await actions.copyWorkout(copy(named.toUpperCase()))).toEqual(refusal('name_taken'));
    // Another program's names do not clash with this one's, and this page is untouched.
    const [, another] = familyProgram.otherPrograms;
    expect(another, 'the fixture has a second other program').toBeDefined();
    expect(
      (await actions.copyWorkout({ ...copy(), toProgramPublicId: another!.programPublicId })).ok,
    ).toBe(true);
    expect(view()).toEqual(familyProgram);
  });

  it('a refused copy is not remembered: the retry under the same attempt can still succeed', async () => {
    const { actions } = builder();
    const [other] = familyProgram.otherPrograms;
    const base = {
      workoutPublicId: conditioning.workoutPublicId,
      toProgramPublicId: other!.programPublicId,
      weekdays: [],
      label: null,
    };
    expect((await actions.copyWorkout({ ...base, clientId: newId() })).ok).toBe(true);
    const attempt = newId();
    expect(await actions.copyWorkout({ ...base, clientId: attempt })).toEqual(
      refusal('name_taken'),
    );
    // The same attempt, now with a name: it is a new request as far as the name goes.
    const renamed = await actions.copyWorkout({ ...base, clientId: attempt, name: 'Finisher' });
    expect(renamed.ok).toBe(true);
    // And replayed, it answers the same id.
    expect(await actions.copyWorkout({ ...base, clientId: attempt, name: 'Finisher' })).toEqual(
      renamed,
    );
  });
});

describe('the fake ProgramActions: items and athletes', () => {
  it('a new item joins the picker; an existing name selects that item, with its own type', async () => {
    const { actions, state } = builder();
    // Typed with spaces round it: the answer and the stored item hold the name without them.
    const made = await actions.newItem({
      name: '  Bear crawl ',
      trackingType: TRACKING_TYPE.distance,
    });
    expect(made).toMatchObject({
      ok: true,
      name: 'Bear crawl',
      trackingType: TRACKING_TYPE.distance,
      existed: false,
    });
    expect(state().items.at(-1)).toMatchObject({ name: 'Bear crawl', owner: 'household' });

    const pushUps = pickerOptions.find((o) => o.name === 'Push-ups')!;
    // The picker's "same movement" rule, not a name's fold: "push ups" is Push-ups.
    expect(
      await actions.newItem({ name: ' push ups ', trackingType: TRACKING_TYPE.check }),
    ).toEqual({
      ok: true,
      itemPublicId: pushUps.publicId,
      // The item's own name, not what was typed: the card shows "Push-ups".
      name: 'Push-ups',
      trackingType: pushUps.trackingType,
      existed: true,
    });
    expect(state().items).toHaveLength(pickerOptions.length + 1);
  });

  it('a typed alias selects the item it is another name for, and adds nothing', async () => {
    // No listed row answers to "RDL", so this seeds one library row that does, as the real picker
    // data will.
    const rdl = libraryRow({
      publicId: '019826b4-0000-7000-8000-0000000000d1',
      name: 'Romanian Deadlift',
      aliases: ['RDL'],
    });
    const { actions, state } = builder({ items: [...pickerOptions, rdl] });
    for (const typed of ['RDL', ' rdl ', 'romanian deadlifts']) {
      expect(
        await actions.newItem({ name: typed, trackingType: TRACKING_TYPE.check }),
        typed,
      ).toEqual({
        ok: true,
        itemPublicId: rdl.publicId,
        name: 'Romanian Deadlift',
        trackingType: TRACKING_TYPE.weight_reps,
        existed: true,
      });
    }
    expect(state().items).toHaveLength(pickerOptions.length + 1);
    // A name that only CONTAINS the alias is a new item: the alias rule is exact.
    expect(
      await actions.newItem({ name: 'RDL pause', trackingType: TRACKING_TYPE.weight_reps }),
    ).toMatchObject({ ok: true, name: 'RDL pause', existed: false });
  });

  it('a household item named after an alias is what that name means, as in the picker', async () => {
    // The picker lists a movement's own name before another movement's alias (CAT-3 spec P2,
    // contract change C30), so its guard offers the household's "RDL" for "rdl"; the answer must
    // be the same item, whichever order the list is in. (Until C30 both gave the catalog's.)
    const catalog = libraryRow({
      publicId: '019826b4-0000-7000-8000-0000000000d1',
      name: 'Romanian Deadlift',
      aliases: ['RDL'],
    });
    const stray: MovementOptionDTO = {
      publicId: '019826b4-0000-7000-8000-0000000000d2',
      name: 'RDL',
      trackingType: TRACKING_TYPE.check,
      owner: 'household',
      unitDefault: null,
      isBodyweight: false,
    };
    for (const items of [
      [stray, catalog],
      [catalog, stray],
    ]) {
      const { actions } = builder({ items });
      expect(
        await actions.newItem({ name: 'rdl', trackingType: TRACKING_TYPE.check }),
      ).toMatchObject({ itemPublicId: stray.publicId, name: 'RDL', existed: true });
      // The catalog's item is still itself by its own name.
      expect(
        await actions.newItem({ name: 'romanian deadlift', trackingType: TRACKING_TYPE.check }),
      ).toMatchObject({ itemPublicId: catalog.publicId, name: 'Romanian Deadlift', existed: true });
    }
  });

  it('an option list without the catalog flag is a type error, not a silent tie-break by name', () => {
    // Pinned here because this is the caller that holds `MovementOptionDTO`s. (When it was written
    // `pnpm typecheck` did not read the shared package's tests at all; #457 fixed that.)
    // @ts-expect-error — `MovementOptionDTO` has `owner`, not `isCatalog`; the caller maps it
    expect(existingItem([...pickerOptions], 'Push-ups')?.name).toBe('Push-ups');
  });

  it('a name with nothing to match on is refused, so it cannot be added twice', async () => {
    const { actions, state } = builder();
    for (const name of ['S', "S's", 's s']) {
      expect(await actions.newItem({ name, trackingType: TRACKING_TYPE.check }), name).toEqual(
        refusal('invalid'),
      );
    }
    expect(state().items).toHaveLength(pickerOptions.length);
  });

  it('take off ends a program after today: family-program-after-take-off', async () => {
    const { actions, view } = builder();
    const result = await actions.takeOff({
      programPublicId: familyProgram.programPublicId,
      profilePublicId: fixtureIds.athlete('a2'),
    });
    // They started before today, so they stay on through today; the answer says so.
    expect(result).toEqual({ ok: true, lastDay: FIXTURE_TODAY });
    expect(view()).toEqual(familyProgramAfterTakeOff);
  });

  it('Put on undoes a Take off whose last day is today: one stretch, no gap', async () => {
    const { actions, view } = builder();
    const { programPublicId } = familyProgram;
    const profilePublicId = fixtureIds.athlete('a2');
    const before = familyProgram.athletes.find((a) => a.profilePublicId === profilePublicId)!;
    expect(before.lastDay).toBeNull();

    expect(await actions.takeOff({ programPublicId, profilePublicId })).toEqual({
      ok: true,
      lastDay: FIXTURE_TODAY,
    });
    expect(view()).toEqual(familyProgramAfterTakeOff);

    // They are still `on` in the dialog's list, with a last day on the page: that is how the
    // dialog knows to offer them. Putting them on, from either day, clears the last day and
    // changes nothing else: the same `since`, the same place.
    for (const from of [FIXTURE_TODAY, addDays(FIXTURE_TODAY, 1)]) {
      await actions.takeOff({ programPublicId, profilePublicId });
      expect(view().candidates.find((c) => c.profilePublicId === profilePublicId)?.on).toBe(true);
      expect(
        await actions.putOn({ programPublicId, profilePublicIds: [profilePublicId], from }),
      ).toEqual({ ok: true });
      expect(view()).toEqual(familyProgram);
    }
  });

  it('a Put on from today is undone by Take off the same day: the start is removed', async () => {
    const { actions, state, view } = builder();
    const { programPublicId } = familyProgram;
    const off = familyProgram.candidates.find((c) => !c.on)!;
    expect(
      await actions.putOn({
        programPublicId,
        profilePublicIds: [off.profilePublicId],
        from: FIXTURE_TODAY,
      }),
    ).toEqual({ ok: true });
    expect(view().athletes.find((a) => a.profilePublicId === off.profilePublicId)).toMatchObject({
      since: FIXTURE_TODAY,
      lastDay: null,
    });

    // Nothing is logged under a start in this fake, so today's start is removed, not ended:
    // `lastDay: null`, and the page and the list are as they were before the Put on.
    expect(
      await actions.takeOff({ programPublicId, profilePublicId: off.profilePublicId }),
    ).toEqual({ ok: true, lastDay: null });
    expect(view()).toEqual(familyProgram);
    expect(
      state().programs.find((p) => p.programPublicId === programPublicId)?.athletes,
    ).not.toContain(off.name);
  });

  it('put on starts today or tomorrow, skips whoever is on it, and needs someone picked', async () => {
    const { actions, state, view } = builder();
    const { programPublicId } = familyProgram;
    const off = familyProgram.candidates.find((c) => !c.on)!;
    const on = familyProgram.candidates.find((c) => c.on)!;
    const tomorrow = addDays(FIXTURE_TODAY, 1);

    expect(await actions.putOn({ programPublicId, profilePublicIds: [], from: tomorrow })).toEqual(
      refusal('invalid'),
    );
    expect(
      await actions.putOn({
        programPublicId,
        profilePublicIds: [off.profilePublicId],
        from: addDays(FIXTURE_TODAY, 2),
      }),
    ).toEqual(refusal('invalid'));
    expect(
      await actions.putOn({ programPublicId, profilePublicIds: [newId()], from: tomorrow }),
    ).toEqual(refusal('not_found'));

    expect(
      await actions.putOn({
        programPublicId,
        profilePublicIds: [off.profilePublicId, on.profilePublicId],
        from: tomorrow,
      }),
    ).toEqual({ ok: true });
    expect(view().athletes).toEqual([
      ...familyProgram.athletes,
      {
        profilePublicId: off.profilePublicId,
        name: off.name,
        since: tomorrow,
        lastDay: null,
        alsoOn: off.keeps,
      },
    ]);
    // The Family program is first in the household's order, so it leads what they keep.
    expect(view().candidates.find((c) => c.profilePublicId === off.profilePublicId)).toEqual({
      ...off,
      on: true,
      keeps: [familyProgram.name, ...off.keeps],
    });
    expect(state().programs.find((p) => p.programPublicId === programPublicId)?.athletes).toContain(
      off.name,
    );

    // Taken off before they start, they simply leave, on the page and on the list.
    expect(
      await actions.takeOff({ programPublicId, profilePublicId: off.profilePublicId }),
    ).toEqual({ ok: true, lastDay: null });
    expect(view()).toEqual(familyProgram);
    expect(state().programs).toEqual(programsList);
  });

  it('failNext makes the next call fail once with retry', async () => {
    const { actions, failNext, state } = builder();
    const input = { clientId: newId(), name: 'Off season' };
    failNext();
    expect(await actions.createProgram(input)).toEqual(refusal('retry'));
    expect(state().programs).toHaveLength(programsList.length);
    expect((await actions.createProgram(input)).ok).toBe(true);
  });
});

describe('the fakes: rules found in review', () => {
  describe('an id is one id in either case (C25)', () => {
    // The fixtures' ids are all digits, so the ids here are the ones a client mints. Postgres reads
    // the two spellings as one uuid; the schemas hand the fakes one spelling, so they do too.
    // Each replay is sent both ways round, and every action gets a client id of its own: a fake
    // that read the raw id would pass one order by luck.
    const lettered = (n: number) =>
      `0193a2b4-7c5d-7e8f-9a0b-1c2d3e4f5a${String(n).padStart(2, '0')}`;
    const ORDERS: Array<[string, (id: string) => string, (id: string) => string]> = [
      ['lower case, then upper', (id) => id, (id) => id.toUpperCase()],
      ['upper case, then lower', (id) => id.toUpperCase(), (id) => id],
    ];

    it('the two spellings differ', () => {
      expect(lettered(1).toUpperCase()).not.toBe(lettered(1));
      expect(lettered(1)).not.toBe(lettered(2));
    });

    it.each(ORDERS)(
      'createProgram replays under the other spelling: %s',
      async (_, first, then) => {
        const { actions, state } = builder();
        const clientId = lettered(1);
        const created = await actions.createProgram({
          clientId: first(clientId),
          name: 'Off season',
        });
        expect(created.ok).toBe(true);
        // The second call is the first one again, not a second program of that name (`name_taken`).
        expect(
          await actions.createProgram({ clientId: then(clientId), name: 'Off season' }),
        ).toEqual(created);
        expect(state().programs.filter((p) => p.name === 'Off season')).toHaveLength(1);
      },
    );

    it.each(ORDERS)('saveWorkout replays a new workout: %s', async (_, first, then) => {
      const { actions, view } = builder();
      const workoutClientId = lettered(2);
      const draft = { ...newWorkoutEmpty, name: 'Mobility' };
      const saved = await actions.saveWorkout({
        ...draft,
        workoutClientId: first(workoutClientId),
      });
      expect(saved.ok).toBe(true);
      // A replay, not a second workout of that name (`name_taken`).
      expect(
        await actions.saveWorkout({ ...draft, workoutClientId: then(workoutClientId) }),
      ).toEqual(saved);
      expect(view().workouts.filter((w) => w.name === 'Mobility')).toHaveLength(1);
    });

    it.each(ORDERS)('copyWorkout replays a copy: %s', async (_, first, then) => {
      const { actions, view } = builder();
      const clientId = lettered(3);
      const copy = {
        workoutPublicId: heavyA.workoutPublicId,
        toProgramPublicId: familyProgram.programPublicId,
        weekdays: [],
        label: null,
      };
      const copied = await actions.copyWorkout({ ...copy, clientId: first(clientId) });
      expect(copied.ok).toBe(true);
      // A replay, not a second copy under the default name (`name_taken`).
      expect(await actions.copyWorkout({ ...copy, clientId: then(clientId) })).toEqual(copied);
      expect(view().workouts).toHaveLength(familyProgram.workouts.length + 1);
    });

    it.each(ORDERS)('logRow replays a ✓: %s', async (_, first, then) => {
      const { actions, plan } = day(heavyASupersets);
      const write = tick(heavyASupersets, 'DB bench press');
      const clientId = lettered(4);
      const logged = succeeded(await actions.logRow({ ...write, clientId: first(clientId) }));
      // The first answer again, not a second ✓ on a set that is taken (`slot_taken`).
      expect(await actions.logRow({ ...write, clientId: then(clientId) })).toEqual(logged);
      expect(itemOf(plan(), 'DB bench press').item.rows.filter((r) => r.logged)).toHaveLength(1);
    });

    it('saveWorkout refuses two cards under one id spelled two ways', async () => {
      const { actions } = builder();
      const [first, second] = heavyADraft.items;
      if (!first || !second) throw new Error('heavy-a-draft needs two cards');
      const cards = (a: string, b: string) => ({
        ...heavyADraft,
        items: [
          { ...first, prescriptionClientId: a },
          { ...second, prescriptionClientId: b },
        ],
      });
      expect(await actions.saveWorkout(cards(lettered(5), lettered(5).toUpperCase()))).toEqual(
        refusal('invalid'),
      );
      expect((await actions.saveWorkout(cards(lettered(5), lettered(6).toUpperCase()))).ok).toBe(
        true,
      );
    });

    it('saveWeek answers once_per_day for one workout spelled two ways, and saves an upper-case week', async () => {
      // The fake's view holds the fixture's ids, which are all digits; give them letters first.
      const spell = <T>(value: T, letters: string): T =>
        JSON.parse(
          JSON.stringify(value).replaceAll(
            '"00000000-0000-7000-8000-',
            `"${letters}-0000-7000-8000-`,
          ),
        ) as T;
      const page = spell(familyProgram, 'abcdef00');
      expect(page.programPublicId).not.toBe(page.programPublicId.toUpperCase());
      const { actions, view } = builder({
        programs: spell([...programsList], 'abcdef00'),
        program: page,
      });
      const workoutPublicId = page.workouts[0]?.workoutPublicId;
      if (!workoutPublicId) throw new Error('the family program has no workout');

      const twice = structuredClone(page.week);
      twice[0] = [
        { workoutPublicId, label: null },
        { workoutPublicId: workoutPublicId.toUpperCase(), label: 'Evening' },
      ];
      expect(
        await actions.saveWeek({ programPublicId: page.programPublicId, days: twice }),
      ).toEqual(refusal('once_per_day'));

      // A week whose every id is upper case names the page's own workouts: it saves.
      const shouted = spell(familyProgram.week, 'ABCDEF00');
      expect(shouted).not.toEqual(page.week);
      expect(
        await actions.saveWeek({
          programPublicId: page.programPublicId.toUpperCase(),
          days: shouted,
        }),
      ).toEqual({ ok: true });
      expect(view().week).toEqual(page.week);
    });
  });

  it('a name is taken whatever its case or spacing: "heavy a" beside "Heavy A"', async () => {
    const { actions } = builder();
    const { programPublicId } = familyProgram;
    // A workout, in its program.
    expect(await actions.saveWorkout({ ...newWorkoutEmpty, name: 'heavy a' })).toEqual(
      refusal('name_taken'),
    );
    expect(await actions.saveWorkout({ ...newWorkoutEmpty, name: 'Héavy  A' })).toEqual(
      refusal('name_taken'),
    );
    // Saving Heavy A under its own name, re-cased, is not a clash with itself.
    expect((await actions.saveWorkout({ ...heavyADraft, name: 'HEAVY A' })).ok).toBe(true);
    // A program, in the household: created and renamed.
    expect(
      await actions.createProgram({ clientId: newId(), name: familyProgram.name.toUpperCase() }),
    ).toEqual(refusal('name_taken'));
    const other = programsList.find((p) => p.programPublicId !== programPublicId)!;
    expect(
      await actions.renameProgram({ programPublicId, name: other.name.toLowerCase() }),
    ).toEqual(refusal('name_taken'));
  });

  it('"+ Add set" may skip a number, makes no row nobody logged, and only a set type has a second row', async () => {
    const { actions, plan } = day(heavyASupersets);
    const before = itemOf(heavyASupersets, 'DB bench press');
    const sets = before.item.rows.length;

    // The screen keeps an un-ticked row for the visit, so its next number can be two past the rows
    // the data lists. That is a valid ✓, and it adds ONE row: the logged one.
    succeeded(await actions.logRow({ ...tick(heavyASupersets, 'DB bench press'), set: sets + 2 }));
    const after = itemOf(plan(), 'DB bench press');
    expect(after.item.rows.map((r) => r.set)).toEqual([
      ...Array.from({ length: sets }, (_, i) => i + 1),
      sets + 2,
    ]);
    expect(after.item.rows.at(-1)?.logged).not.toBeNull();
    expect(after.workout.progress).toEqual({
      done: before.workout.progress.done + 1,
      total: before.workout.progress.total + 1,
    });
    expect(dayPlanSchema.safeParse(plan()).success).toBe(true);

    const check = heavyASupersets.workouts
      .flatMap((w) => w.items)
      .find((i) => i.trackingType === TRACKING_TYPE.check)!;
    expect(await actions.logRow({ ...tick(heavyASupersets, check.name), set: 2 })).toEqual({
      ok: false,
      reason: ROW_REFUSAL.bad_value,
    });
  });

  it('two added sets un-ticked in turn: the later one can be logged again with a new number', async () => {
    const { actions, plan } = day(heavyASupersets);
    const sets = itemOf(heavyASupersets, 'DB bench press').item.rows.length;
    const add = (set: number) =>
      actions.logRow({ ...tick(heavyASupersets, 'DB bench press'), clientId: newId(), set });
    const address = { profilePublicId: heavyASupersets.profilePublicId, day: heavyASupersets.day };

    const fifth = succeeded(await add(sets + 1));
    const sixth = succeeded(await add(sets + 2));
    succeeded(await actions.untickRow({ ...address, entryPublicId: sixth.entryPublicId }));
    succeeded(await actions.untickRow({ ...address, entryPublicId: fifth.entryPublicId }));
    expect(itemOf(plan(), 'DB bench press').item.rows).toHaveLength(sets);

    // The screen still shows both rows un-ticked; a changed number on the later one is a new ✓.
    succeeded(await add(sets + 2));
    // And "+ Add set" from there is one past the highest the screen shows.
    succeeded(await add(sets + 3));
    expect(itemOf(plan(), 'DB bench press').item.rows.map((r) => r.set)).toEqual([
      ...Array.from({ length: sets }, (_, i) => i + 1),
      sets + 2,
      sets + 3,
    ]);
    expect(dayPlanSchema.safeParse(plan()).success).toBe(true);
  });

  it('an added set is a row only while it is logged: un-tick removes it, re-tick returns it', async () => {
    const { actions, plan } = day(heavyASupersets);
    const before = itemOf(heavyASupersets, 'DB bench press');
    const sets = before.item.rows.length;
    const add = (set: number) =>
      actions.logRow({ ...tick(heavyASupersets, 'DB bench press'), clientId: newId(), set });

    const fourth = succeeded(await add(sets + 1));
    const fifth = succeeded(await add(sets + 2));
    expect(itemOf(plan(), 'DB bench press').item.rows.map((r) => r.set)).toEqual(
      Array.from({ length: sets + 2 }, (_, i) => i + 1),
    );

    // Un-tick the first added set: the row goes, leaving a gap, and the total follows it.
    const hidden = succeeded(
      await actions.untickRow({
        profilePublicId: heavyASupersets.profilePublicId,
        day: heavyASupersets.day,
        entryPublicId: fourth.entryPublicId,
      }),
    );
    const gapped = itemOf(plan(), 'DB bench press');
    expect(gapped.item.rows.map((r) => r.set)).toEqual([
      ...Array.from({ length: sets }, (_, i) => i + 1),
      sets + 2,
    ]);
    expect(gapped.workout.progress).toEqual({
      done: before.workout.progress.done + 1,
      total: before.workout.progress.total + 1,
    });
    expect(dayPlanSchema.safeParse(plan()).success).toBe(true);

    // The row count plus one names the set that is still there; the next NEW set is one past the
    // highest set shown.
    expect(await add(sets + 2)).toEqual({ ok: false, reason: ROW_REFUSAL.slot_taken });
    succeeded(await add(sets + 3));

    // Re-tick puts the row back where its number belongs.
    const retick = {
      profilePublicId: heavyASupersets.profilePublicId,
      day: heavyASupersets.day,
      entryPublicId: fourth.entryPublicId,
      hiddenAt: hidden.hiddenAt!,
    };
    succeeded(await actions.retickRow(retick));
    const back = itemOf(plan(), 'DB bench press');
    expect(back.item.rows.map((r) => r.set)).toEqual(
      Array.from({ length: sets + 3 }, (_, i) => i + 1),
    );
    expect(back.item.rows.every((r) => r.set <= sets || r.logged)).toBe(true);
    expect(fifth.entryPublicId).not.toBe(fourth.entryPublicId);
  });

  it('a gap an un-ticked added set left can be logged again, and it is the same entry', async () => {
    const { actions, plan } = day(heavyASupersets);
    const sets = itemOf(heavyASupersets, 'DB bench press').item.rows.length;
    const add = (set: number) =>
      actions.logRow({ ...tick(heavyASupersets, 'DB bench press'), clientId: newId(), set });
    const address = {
      profilePublicId: heavyASupersets.profilePublicId,
      day: heavyASupersets.day,
    };

    const fourth = succeeded(await add(sets + 1));
    succeeded(await add(sets + 2));
    const hidden = succeeded(
      await actions.untickRow({ ...address, entryPublicId: fourth.entryPublicId }),
    );

    // A changed number on the un-ticked set is a new ✓ for the same set number, and it brings the
    // set's own entry back (plan D35): the row returns where its number belongs.
    const again = succeeded(await add(sets + 1));
    expect(again.entryPublicId).toBe(fourth.entryPublicId);
    expect(itemOf(plan(), 'DB bench press').item.rows.map((r) => r.set)).toEqual(
      Array.from({ length: sets + 2 }, (_, i) => i + 1),
    );
    // The re-tick that arrives late finds the entry live and answers with it.
    expect(
      await actions.retickRow({
        ...address,
        entryPublicId: fourth.entryPublicId,
        hiddenAt: hidden.hiddenAt!,
      }),
    ).toEqual(again);
    expect(dayPlanSchema.safeParse(plan()).success).toBe(true);
  });

  it('a prescribed set stays a row when it is un-ticked', async () => {
    const { actions, plan } = day(heavyASupersets);
    const before = itemOf(heavyASupersets, 'DB bench press');
    const first = succeeded(await actions.logRow(tick(heavyASupersets, 'DB bench press')));
    succeeded(
      await actions.untickRow({
        profilePublicId: heavyASupersets.profilePublicId,
        day: heavyASupersets.day,
        entryPublicId: first.entryPublicId,
      }),
    );
    const after = itemOf(plan(), 'DB bench press');
    expect(after.item.rows).toHaveLength(before.item.rows.length);
    expect(after.workout.progress).toEqual(before.workout.progress);
  });

  it('a number the type has no field for is bad_value, never dropped', async () => {
    const { actions } = day(heavyASupersets);
    const bad = { ok: false, reason: ROW_REFUSAL.bad_value };
    const distance = { slot: QUANTITY_SLOT.distance, unit: 'm' as const, value: 40 };
    expect(
      await actions.logRow(tick(heavyASupersets, 'DB bench press', { quantities: [distance] })),
    ).toEqual(bad);
    const check = heavyASupersets.workouts
      .flatMap((w) => w.items)
      .find((i) => i.trackingType === TRACKING_TYPE.check)!;
    expect(
      await actions.logRow(tick(heavyASupersets, check.name, { reps: 3, quantities: [] })),
    ).toEqual(bad);
  });

  it('an empty ✓ asks for a number the prescription cannot give', async () => {
    // Reps written as text ("10 per side") give no whole number to copy (plan D13).
    const noReps = structuredClone(heavyASupersets);
    itemOf(noReps, 'DB bench press').item.target.reps = null;
    const { actions } = day(noReps);
    const write = tick(noReps, 'DB bench press');
    expect(await actions.logRow(write)).toEqual({ ok: false, reason: ROW_REFUSAL.bad_value });
    expect(
      succeeded(await actions.logRow({ ...write, values: { reps: 9, quantities: [] } })).values,
    ).toEqual({ reps: 9, quantities: [lb(25)] });
  });

  it('a reorder leaves a workout that left the week last', async () => {
    const { actions, plan } = day(workoutLeftTheWeek);
    const ids = workoutLeftTheWeek.currentPrograms.map((p) => p.programPublicId);
    expect(ids.length, 'the fixture athlete is on two programs').toBeGreaterThan(1);
    expect(
      await actions.reorderPrograms({
        profilePublicId: workoutLeftTheWeek.profilePublicId,
        programPublicIds: ids.toReversed(),
      }),
    ).toEqual({ ok: true });
    expect(
      plan()
        .workouts.map((w) => w.scheduled)
        .lastIndexOf(true),
    ).toBe(plan().workouts.filter((w) => w.scheduled).length - 1);
    expect(plan().workouts.at(-1)?.name).toBe(workoutLeftTheWeek.workouts.at(-1)?.name);
    expect(plan().programs.map((p) => p.programPublicId)).toEqual(ids.toReversed());
    expect(dayPlanSchema.safeParse(plan()).success).toBe(true);
  });

  it('put on lists athletes in the household’s order, on the page and on the list', async () => {
    // Only Adult One is on their program; Athlete Two comes before them in the household.
    const { actions, state, view } = builder({ program: adultProgramWithCopy });
    const { programPublicId } = adultProgramWithCopy;
    const two = adultProgramWithCopy.candidates.find((c) => c.name === 'Athlete Two')!;
    expect(two.on).toBe(false);
    expect(
      await actions.putOn({
        programPublicId,
        profilePublicIds: [two.profilePublicId],
        from: FIXTURE_TODAY,
      }),
    ).toEqual({ ok: true });
    const household = adultProgramWithCopy.candidates.map((c) => c.name);
    const inOrder = (names: string[]) => household.filter((name) => names.includes(name));
    const onPage = view().athletes.map((a) => a.name);
    expect(onPage).toContain('Athlete Two');
    expect(onPage[0]).toBe('Athlete Two');
    expect(onPage).toEqual(inOrder(onPage));
    const onList = state().programs.find((p) => p.programPublicId === programPublicId)!.athletes;
    expect(onList).toEqual(onPage);
    // They keep their other programs, and this one takes its place in the household's order: last.
    expect(view().candidates.find((c) => c.name === 'Athlete Two')?.keeps).toEqual([
      ...two.keeps,
      adultProgramWithCopy.name,
    ]);
    expect(programViewSchema.safeParse(view()).success).toBe(true);
  });

  it('a second copy inside one program meets the name the first took', async () => {
    const { actions, view } = builder();
    const copy = () => ({
      clientId: newId(),
      workoutPublicId: heavyA.workoutPublicId,
      toProgramPublicId: familyProgram.programPublicId,
      weekdays: [],
      label: null,
    });
    expect((await actions.copyWorkout(copy())).ok).toBe(true);
    expect(await actions.copyWorkout(copy())).toEqual(refusal('name_taken'));
    expect(view().workouts.filter((w) => w.copiedFrom)).toHaveLength(1);
  });

  it('a repeat copy takes the name the person gave it, and a taken name is still refused', async () => {
    const { actions, view } = builder();
    const copy = (name?: string) => ({
      clientId: newId(),
      workoutPublicId: heavyA.workoutPublicId,
      toProgramPublicId: familyProgram.programPublicId,
      weekdays: [],
      label: null,
      ...(name === undefined ? {} : { name }),
    });
    // The default first; then a second copy needs a name of its own.
    expect((await actions.copyWorkout(copy())).ok).toBe(true);
    expect((await actions.copyWorkout(copy('Heavy A, deload'))).ok).toBe(true);
    expect(
      view()
        .workouts.filter((w) => w.copiedFrom)
        .map((w) => w.name),
    ).toEqual(['Heavy A (copy)', 'Heavy A, deload']);
    // A given name is held to the same rule as any workout name in the program, by its fold.
    expect(await actions.copyWorkout(copy('heavy a'))).toEqual(refusal('name_taken'));
    expect(await actions.copyWorkout(copy('  HEAVY A, DELOAD '))).toEqual(refusal('name_taken'));
    // ...and to the name schema: empty, too long, or nothing to read.
    expect(await actions.copyWorkout(copy(''))).toEqual(refusal('invalid'));
    expect(await actions.copyWorkout(copy('x'.repeat(WORKOUT_NAME_MAX + 1)))).toEqual(
      refusal('invalid'),
    );
    expect(view().workouts.filter((w) => w.copiedFrom)).toHaveLength(2);
  });

  it('refuses a week that is not a week, and one for a program that is not on screen', async () => {
    const { actions } = builder();
    const { programPublicId, week } = familyProgram;
    expect(
      await actions.saveWeek({ programPublicId, days: { 0: [] } as unknown as typeof week }),
    ).toEqual(refusal('invalid'));
    const [other] = familyProgram.otherPrograms;
    expect(await actions.saveWeek({ programPublicId: other!.programPublicId, days: week })).toEqual(
      refusal('not_found'),
    );
  });

  it('failNext fails every member once, before it looks at what was sent', async () => {
    const dayFake = createFakeDayActions(todayTwoPrograms);
    for (const [name, action] of Object.entries(dayFake.actions)) {
      dayFake.failNext();
      const failed = await (action as (input: unknown) => Promise<unknown>)({});
      expect(failed, name).toEqual({ ok: false, reason: ROW_REFUSAL.retry });
      const next = await (action as (input: unknown) => Promise<unknown>)({});
      expect(next, `${name}, the call after`).not.toEqual(failed);
    }
    const programs = builder();
    for (const [name, action] of Object.entries(programs.actions)) {
      programs.failNext();
      const failed = await (action as (input: unknown) => Promise<unknown>)({});
      expect(failed, name).toEqual(refusal('retry'));
      const next = await (action as (input: unknown) => Promise<unknown>)({});
      expect(next, `${name}, the call after`).toEqual(refusal('invalid'));
    }
  });
});

// ── Containment ─────────────────────────────────────────────────────────────────────────────────

describe('the fakes stay on the preview route', () => {
  /**
   * A production route passes the real actions it has, never a fake (plan §6). So no module outside
   * the preview route's own directory may import this one. Fixtures are held the same way: they are
   * preview and test data.
   */
  const outside = appSources().filter((file) => !file.startsWith(`${WEB_DIR}/app/design/program/`));

  it('finds the sources (an empty glob would pass the scan below)', () => {
    expect(outside.length).toBeGreaterThan(100);
  });

  /**
   * A path that ends in the fakes, the picker fixture or the contract's fixtures, however it is
   * spelled: by the alias, by the package subpath, or relatively. A sibling under `app/design/`
   * reaches the fakes as `./program/fakes`, with no `design/` in the path at all.
   */
  const IMPORTS_PREVIEW_DATA = /(^|\/)program\/(fakes|picker-options|fixtures)\b/;

  it('the matcher sees every spelling of the import', () => {
    for (const source of [
      `import { createFakeDayActions } from '@/app/design/program/fakes';`,
      `import { createFakeDayActions } from './program/fakes';`,
      `import { createFakeDayActions } from '../program/fakes';`,
      `import { pickerOptions } from '../design/program/picker-options';`,
      `import { familyProgram } from '@mat-plan/shared/program/fixtures';`,
      `import { familyProgram } from '../../packages/shared/src/program/fixtures/index';`,
      `const fakes = await import('./program/fakes');`,
    ]) {
      expect(IMPORTS_PREVIEW_DATA.test(source), source).toBe(true);
    }
    for (const source of [
      `import { DayScreen } from '@/components/day/day-screen';`,
      `import type { DayPlan } from '@mat-plan/shared';`,
      `import { listPrograms } from '@/lib/dal/program/programs';`,
      `import { previewHref } from './program/preview-registry';`,
    ]) {
      expect(IMPORTS_PREVIEW_DATA.test(source), source).toBe(false);
    }
  });

  it('nothing outside app/design/program imports the fakes or the fixtures', () => {
    const importers = outside.filter((file) => IMPORTS_PREVIEW_DATA.test(code(file)));
    expect(importers.map((file) => file.slice(WEB_DIR.length + 1))).toEqual([]);
  });
});
