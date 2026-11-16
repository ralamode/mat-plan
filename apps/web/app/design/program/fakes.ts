import {
  addDays,
  assignDraftSchema,
  copyDraftSchema,
  createProgramSchema,
  foldName,
  hasStarted,
  MONDAY_FIRST,
  existingItem,
  fillRowValues,
  newId,
  newItemSchema,
  PROGRAM_REFUSAL,
  programOrderSchema,
  renameProgramSchema,
  ROW_REFUSAL,
  rowAmendSchema,
  rowRetickSchema,
  rowUntickSchema,
  rowWriteSchema,
  saveWorkoutSchema,
  takeOffSchema,
  hasSetRows,
  weekDraftSchema,
  WORKOUT_NAME_MAX,
  type DayActions,
  type DayItem,
  type DayPlan,
  type DayRow,
  type DayWorkout,
  type ProgramActions,
  type ProgramList,
  type ProgramRefusal,
  type ProgramView,
  type RowRefusal,
  type RowResult,
  type WeekDraft,
} from '@mat-plan/shared';

import type { MovementOptionDTO } from '@/lib/movements/movement-option';

/**
 * In-memory fakes of the contract's two actions objects (FAM-1 plan §4, §6), so a screen is fully
 * clickable on the preview route before any table exists.
 *
 * 🔴 **For the preview route and tests only. Nothing in production imports this module**
 * (`fakes.test.ts` scans for it). A production route passes the real actions it has, never a mix.
 *
 * Each fake holds a copy of the fixture it was made from, changes it by the accepted prototype's
 * rules (`docs/prototypes/beta-0/index.html`), answers with the contract's result types, and hands
 * the changed copy to `onChange`. That call stands in for the re-render a real action causes with
 * `revalidatePath`: the preview passes the new data back to the screen as props.
 *
 * **Thin on purpose.** A fake knows the one fixture it was given. It does not model a household,
 * so a write that names something outside the fixture answers `not_found`, and a rule that needs
 * the database (a unit's ceiling, an edit made by someone else) is the real writer's alone.
 *
 * `failNext()` makes the next call resolve `retry` and change nothing: the "✓ that fails" state.
 */

type Logged = NonNullable<DayRow['logged']>;

/** The switch every fake has: the next call fails once, then calls succeed again. */
function failSwitch() {
  let armed = false;
  return {
    failNext: () => void (armed = true),
    /** True once per `failNext()`. */
    failed: () => {
      const was = armed;
      armed = false;
      return was;
    },
  };
}

/** Put a row where its set number belongs: rows are listed in set order, gaps allowed. */
function insertBySet(rows: DayRow[], row: DayRow): void {
  const at = rows.findIndex((r) => r.set > row.set);
  rows.splice(at === -1 ? rows.length : at, 0, row);
}

/**
 * A hide token in `hiddenAtSchema`'s format: UTC text with six fractional digits. The last three
 * count the tokens made, so two un-ticks in the same millisecond never share one (the real token
 * is a transaction's microsecond start time). Shared a token, the first un-tick's would have
 * restored an entry the second un-tick hid.
 */
let tokensMade = 0;
const hideToken = () =>
  new Date().toISOString().replace('Z', `${String(tokensMade++ % 1000).padStart(3, '0')}Z`);

export type FakeDay = {
  /** Every member, the optional ones included. */
  actions: Required<DayActions>;
  failNext(): void;
};

/**
 * `DayActions` over one `DayPlan` fixture. The prototype's rules:
 *
 * - ✓ logs a row. An empty ✓ on a prescribed row logs the prescription; a value that is not a number
 *   (anything `rowWriteSchema` refuses) is `bad_value`, and so is a number the prescription cannot
 *   supply. A set past the prescribed ones is "+ Add set".
 * - A retry under the same `clientId` answers as the first call did; once its row is un-ticked that
 *   `clientId` answers `own_hidden`.
 * - Un-tick leaves no tomb: the row is simply not logged, and the answer carries the `hiddenAt`
 *   token. Re-tick under that token puts the same entry back.
 * - **A slot holds at most one entry** (plan D35): a new ✓ on a set whose entry was un-ticked brings
 *   THAT entry back, as a new ✓ would have made it but for its id, and the entry answers to the new
 *   `clientId` from then on. A `clientId` an earlier revive replaced is forgotten, as the real
 *   writer forgets it (the entry stores one): see `rowWriteSchema` for what a replay of one does.
 *   So a re-tick that arrives afterwards finds its entry live and answers with it. (`slot_taken` on
 *   a re-tick is the real writer's answer for a slot another entry holds, which the fake, starting
 *   from a fixture with no hidden entries, cannot reach.)
 * - Change replaces a logged row's numbers; a blank or a non-number keeps the old ones (`bad_value`).
 * - A day that is not writable refuses every row write (`closed_day`), and so does a workout that
 *   has left the week (`not_scheduled`): both show their logged rows, read-only.
 * - A row whose item has left the workout can be un-ticked and ticked back, not changed
 *   (`program_changed`).
 * - Reorder takes the full order, and the day's workouts follow it.
 */
export function createFakeDayActions(
  fixture: DayPlan,
  onChange?: (plan: DayPlan) => void,
): FakeDay {
  const plan = structuredClone(fixture);
  const { failNext, failed } = failSwitch();
  /** `clientId` → the entry that ✓ made. */
  const attempts = new Map<string, string>();
  /** Un-ticked entries, by id, with the row each came from. */
  const hidden = new Map<
    string,
    { hiddenAt: string; logged: Logged; workout: DayWorkout; item: DayItem; row: DayRow }
  >();

  /**
   * The rows "+ Add set" made in this fake: sets past the prescribed ones. The contract lists such a
   * row only while it is logged (`dayItemSchema.rows`), so un-ticking one takes the row away and
   * ticking it back returns it. A set that was already past the prescription in the fixture cannot
   * be told from a prescribed one (a `DayItem` does not carry the prescribed set count), so the fake
   * keeps that row when it is un-ticked; the real read drops it.
   */
  const added = new WeakSet<DayRow>();

  const refuse = (reason: RowRefusal): RowResult => ({ ok: false, reason });
  const done = (logged: Logged, hiddenAt?: string): RowResult => ({
    ok: true,
    entryPublicId: logged.entryPublicId,
    values: logged.values,
    ...(hiddenAt && { hiddenAt }),
  });
  const changed = () => onChange?.(structuredClone(plan));
  const mine = (input: { profilePublicId: string; day?: string }) =>
    input.profilePublicId === plan.profilePublicId &&
    (input.day === undefined || input.day === plan.day);

  function live(entryPublicId: string) {
    for (const workout of plan.workouts) {
      for (const item of workout.items) {
        const row = item.rows.find((r) => r.logged?.entryPublicId === entryPublicId);
        if (row?.logged) return { workout, item, row, logged: row.logged };
      }
    }
    return null;
  }
  /** The athlete's un-ticked entry on one set of an item, if there is one. */
  const hiddenOn = (item: DayItem, set: number) =>
    [...hidden.values()].find((gone) => gone.item === item && gone.row.set === set);
  /** "6 of 10" counts live items only: a removed prescription's rows are in neither number. */
  const count = (workout: DayWorkout, item: DayItem, by: 1 | -1) => {
    if (item.prescriptionPublicId) workout.progress.done += by;
  };

  return {
    failNext,
    actions: {
      async logRow(input) {
        if (failed()) return refuse(ROW_REFUSAL.retry);
        const parsed = rowWriteSchema.safeParse(input);
        if (!parsed.success) return refuse(ROW_REFUSAL.bad_value);
        const write = parsed.data;
        if (!mine(write)) return refuse(ROW_REFUSAL.not_found);
        if (!plan.writable) return refuse(ROW_REFUSAL.closed_day);

        const earlier = attempts.get(write.clientId);
        if (earlier) {
          const found = live(earlier);
          return found ? done(found.logged) : refuse(ROW_REFUSAL.own_hidden);
        }

        const workout = plan.workouts.find((w) => w.workoutPublicId === write.workoutPublicId);
        const item = workout?.items.find(
          (i) => i.prescriptionPublicId === write.prescriptionPublicId,
        );
        if (!workout || !item) return refuse(ROW_REFUSAL.program_changed);
        if (!workout.scheduled) return refuse(ROW_REFUSAL.not_scheduled);
        // The values before the slot, as the real writer has it (plan step 11b): it has no slot
        // pre-check, and learns a set is taken from the database's arbiter at the insert. So a bad
        // number on a set that is already logged answers `bad_value`, not `slot_taken`.
        const values = fillRowValues(item, write.values, item.target);
        if (!values) return refuse(ROW_REFUSAL.bad_value);
        let row = item.rows.find((r) => r.set === write.set);
        if (row?.logged) return refuse(ROW_REFUSAL.slot_taken);

        if (!row) {
          // "+ Add set": only a type logged set by set has a second row. Any set number the schema
          // allows may be logged if it has no logged row: the screen numbers an added set past the
          // highest it SHOWS, and it keeps an un-ticked row for the page visit, so its numbers can
          // run ahead of the rows listed here. The row is made because it is being logged; none is
          // made for a set nobody logged (`dayItemSchema.rows`), so the numbers may have gaps.
          if (!hasSetRows(item.trackingType)) return refuse(ROW_REFUSAL.bad_value);
          row = { set: write.set, previous: null, logged: null };
          added.add(row);
          insertBySet(item.rows, row);
          workout.progress.total += 1;
        }
        // One entry per slot (plan D35): the athlete's own un-ticked entry on this set comes back
        // with this ✓'s numbers; only a set that never had one gets a new entry.
        const revived = hiddenOn(item, write.set);
        if (revived) {
          hidden.delete(revived.logged.entryPublicId);
          // The entry answers to this ✓ from now on; the ✓ it was first logged under names nothing.
          for (const [clientId, entry] of attempts) {
            if (entry === revived.logged.entryPublicId) attempts.delete(clientId);
          }
        }
        // A revived entry is what a new ✓ would have made, numbers and the text it is frozen
        // against, with one difference: it keeps its id.
        row.logged = {
          entryPublicId: revived ? revived.logged.entryPublicId : newId(),
          values,
          prescribedText: item.prescribedText,
        };
        count(workout, item, 1);
        attempts.set(write.clientId, row.logged.entryPublicId);
        changed();
        return done(row.logged);
      },

      async untickRow(input) {
        if (failed()) return refuse(ROW_REFUSAL.retry);
        const parsed = rowUntickSchema.safeParse(input);
        if (!parsed.success || !mine(parsed.data)) return refuse(ROW_REFUSAL.not_found);
        if (!plan.writable) return refuse(ROW_REFUSAL.closed_day);
        const { entryPublicId } = parsed.data;

        const already = hidden.get(entryPublicId);
        if (already) return done(already.logged, already.hiddenAt);
        const found = live(entryPublicId);
        if (!found) return refuse(ROW_REFUSAL.not_found);
        if (!found.workout.scheduled) return refuse(ROW_REFUSAL.not_scheduled);

        const hiddenAt = hideToken();
        hidden.set(entryPublicId, { hiddenAt, ...found });
        found.row.logged = null;
        count(found.workout, found.item, -1);
        if (added.has(found.row)) {
          // An added set that is no longer logged is no longer a row.
          found.item.rows.splice(found.item.rows.indexOf(found.row), 1);
          found.workout.progress.total -= 1;
        }
        changed();
        return done(found.logged, hiddenAt);
      },

      async retickRow(input) {
        if (failed()) return refuse(ROW_REFUSAL.retry);
        const parsed = rowRetickSchema.safeParse(input);
        if (!parsed.success || !mine(parsed.data)) return refuse(ROW_REFUSAL.not_found);
        if (!plan.writable) return refuse(ROW_REFUSAL.closed_day);
        const { entryPublicId, hiddenAt } = parsed.data;

        const gone = hidden.get(entryPublicId);
        if (!gone) {
          const found = live(entryPublicId);
          return found ? done(found.logged) : refuse(ROW_REFUSAL.not_found);
        }
        if (gone.hiddenAt !== hiddenAt) return refuse(ROW_REFUSAL.not_found);
        // A ✓ on this set since the un-tick would have brought this very entry back (`logRow`), so
        // an entry still hidden here has an un-logged set: its own row, or none (an added set).
        const holder = gone.item.rows.find((r) => r.set === gone.row.set);

        if (!holder) {
          // An added set comes back as a row, in set order.
          insertBySet(gone.item.rows, gone.row);
          gone.workout.progress.total += 1;
        }
        gone.row.logged = gone.logged;
        hidden.delete(entryPublicId);
        count(gone.workout, gone.item, 1);
        changed();
        return done(gone.logged);
      },

      async amendRow(input) {
        if (failed()) return refuse(ROW_REFUSAL.retry);
        const parsed = rowAmendSchema.safeParse(input);
        if (!parsed.success) return refuse(ROW_REFUSAL.bad_value);
        if (!mine(parsed.data)) return refuse(ROW_REFUSAL.not_found);
        const found = live(parsed.data.entryPublicId);
        if (!found) return refuse(ROW_REFUSAL.not_found);
        if (!plan.writable) return refuse(ROW_REFUSAL.closed_day);
        if (!found.workout.scheduled) return refuse(ROW_REFUSAL.not_scheduled);
        // A row whose item left the workout can be un-ticked and ticked back, nothing more.
        if (!found.item.prescriptionPublicId) return refuse(ROW_REFUSAL.program_changed);
        // No prescription to fall back on: a blank keeps the number that is there.
        const values = fillRowValues(found.item, parsed.data.values, null);
        if (!values) return refuse(ROW_REFUSAL.bad_value);

        found.logged.values = values;
        changed();
        return done(found.logged);
      },

      async reorderPrograms(input) {
        if (failed()) return { ok: false, reason: PROGRAM_REFUSAL.retry };
        const parsed = programOrderSchema.safeParse(input);
        if (!parsed.success) return { ok: false, reason: PROGRAM_REFUSAL.invalid };
        if (!mine(parsed.data)) return { ok: false, reason: PROGRAM_REFUSAL.not_found };
        const ids = parsed.data.programPublicIds;
        const current = plan.currentPrograms;
        const ordered = ids.flatMap((id) => current.filter((p) => p.programPublicId === id));
        if (ordered.length !== current.length || ids.length !== current.length) {
          return { ok: false, reason: PROGRAM_REFUSAL.invalid };
        }

        // The athlete's order, then each program's own week order; what left the week stays last.
        const place = (id: string | null) => (id && ids.includes(id) ? ids.indexOf(id) : null);
        const last = ids.length;
        plan.currentPrograms = ordered;
        plan.programs = plan.programs
          .map((p) => ({ ...p, order: place(p.programPublicId) }))
          .sort((a, b) => (a.order ?? last) - (b.order ?? last));
        const rank = (w: DayWorkout) =>
          w.scheduled ? (place(w.programPublicId) ?? last) : last + 1;
        plan.workouts.sort((a, b) => rank(a) - rank(b));
        changed();
        return { ok: true };
      },
    },
  };
}

/** What the program builder's screens read, held by the fake between calls. */
export type FakeProgramState = {
  /** The Programs list. */
  programs: ProgramList;
  /**
   * The one program whose page or editor is on screen, or `null` on the Programs list. Its `today`
   * is the fake's clock: the day a copy is stamped with, and the first day a program can start.
   */
  program: ProgramView | null;
  /** The item picker's options. */
  items: MovementOptionDTO[];
};

export type FakePrograms = {
  /** Every member, the optional ones included. */
  actions: Required<ProgramActions>;
  failNext(): void;
};

/**
 * Two names a person would read as the same one (plan D5): compared by `foldName`, as the writers
 * compare them, never by `===`. "heavy a" is "Heavy A".
 */
const sameName = (a: string, b: string) => foldName(a) === foldName(b);

/** A copy made inside one program is renamed, and the name still fits `WORKOUT_NAME_MAX`. */
const COPY_SUFFIX = ' (copy)';
const copyName = (name: string) =>
  `${name.slice(0, WORKOUT_NAME_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`;

/** A draft that fails `weekDraftSchema` because a day names one workout twice. */
function repeatsAWorkout(draft: WeekDraft): boolean {
  return Object.values(draft?.days ?? {}).some(
    (slots) =>
      Array.isArray(slots) &&
      new Set(slots.map((slot) => slot?.workoutPublicId)).size !== slots.length,
  );
}

/**
 * `ProgramActions` over the fixtures of one builder screen. The prototype's rules:
 *
 * - Every input is parsed by the contract's own schema; a failure is `invalid` (an empty name, no
 *   athlete picked, a start day that is not today or tomorrow).
 * - A program's name is its own in the household, and a workout's in its program: `name_taken`.
 *   Names are compared folded (`foldName`), so a change of case or spacing is still the same name.
 * - A replayed create, save or copy (the same client id) answers as the first call did and adds
 *   nothing.
 * - A week names a workout at most once a day: `once_per_day`.
 * - A copy made inside one program is renamed `… (copy)` within the name's limit; where it came
 *   from is the program's name on the day of the copy, frozen.
 * - A new item whose name matches an existing one (folded, likewise) selects that item, with its
 *   own type.
 * - Put on starts today or tomorrow and skips whoever is already on it. Take off ends after today;
 *   someone who had not started yet simply leaves.
 */
export function createFakeProgramActions(
  seed: FakeProgramState,
  onChange?: (state: FakeProgramState) => void,
): FakePrograms {
  const state = structuredClone(seed);
  const { failNext, failed } = failSwitch();
  /** Client id → the id its first call minted. */
  const minted = new Map<string, string>();
  /** The names of the workouts this fake has copied into each OTHER program. */
  const copiedInto = new Map<string, string[]>();

  const refuse = (reason: ProgramRefusal) => ({ ok: false, reason }) as const;
  const changed = () => onChange?.(structuredClone(state));
  const listed = (programPublicId: string) =>
    state.programs.find((p) => p.programPublicId === programPublicId);
  /** The program on screen, when it is the one this write names. */
  const shown = (programPublicId: string) =>
    state.program?.programPublicId === programPublicId ? state.program : null;
  /** Monday first: the order `ProgramView.workouts[].usedOn` lists weekdays in. */
  const usedOn = (view: ProgramView, workoutPublicId: string) =>
    MONDAY_FIRST.filter((k) => view.week[k].some((s) => s.workoutPublicId === workoutPublicId));

  return {
    failNext,
    actions: {
      async createProgram(input) {
        if (failed()) return refuse(PROGRAM_REFUSAL.retry);
        const parsed = createProgramSchema.safeParse(input);
        if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
        const { clientId, name } = parsed.data;
        const replayed = minted.get(clientId);
        if (replayed) return { ok: true, programPublicId: replayed };
        if (state.programs.some((p) => sameName(p.name, name))) {
          return refuse(PROGRAM_REFUSAL.name_taken);
        }

        const programPublicId = newId();
        minted.set(clientId, programPublicId);
        state.programs.push({ programPublicId, name, athletes: [] });
        changed();
        return { ok: true, programPublicId };
      },

      async renameProgram(input) {
        if (failed()) return refuse(PROGRAM_REFUSAL.retry);
        const parsed = renameProgramSchema.safeParse(input);
        if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
        const { programPublicId, name } = parsed.data;
        const entry = listed(programPublicId);
        if (!entry) return refuse(PROGRAM_REFUSAL.not_found);
        if (state.programs.some((p) => p !== entry && sameName(p.name, name))) {
          return refuse(PROGRAM_REFUSAL.name_taken);
        }

        const was = entry.name;
        entry.name = name;
        const view = shown(programPublicId);
        if (view) {
          view.name = name;
          // "Put someone on" names the programs each athlete keeps. A copy's "from" stays frozen.
          for (const c of view.candidates) c.keeps = c.keeps.map((k) => (k === was ? name : k));
        }
        changed();
        return { ok: true };
      },

      async saveWorkout(draft) {
        if (failed()) return refuse(PROGRAM_REFUSAL.retry);
        const parsed = saveWorkoutSchema.safeParse(draft);
        if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
        const saved = parsed.data;
        if (!listed(saved.programPublicId)) return refuse(PROGRAM_REFUSAL.not_found);
        const view = shown(saved.programPublicId);
        const known = saved.workoutPublicId ?? minted.get(saved.workoutClientId) ?? null;
        const existing = view?.workouts.find((w) => w.workoutPublicId === known);
        if (view && saved.workoutPublicId && !existing) return refuse(PROGRAM_REFUSAL.not_found);
        if (view?.workouts.some((w) => w !== existing && sameName(w.name, saved.name))) {
          return refuse(PROGRAM_REFUSAL.name_taken);
        }

        const workoutPublicId = known ?? newId();
        minted.set(saved.workoutClientId, workoutPublicId);
        const summary = { name: saved.name, itemCount: saved.items.length };
        if (existing) Object.assign(existing, summary);
        else view?.workouts.push({ workoutPublicId, ...summary, usedOn: [], copiedFrom: null });
        changed();
        return { ok: true, workoutPublicId };
      },

      async saveWeek(draft) {
        if (failed()) return refuse(PROGRAM_REFUSAL.retry);
        const parsed = weekDraftSchema.safeParse(draft);
        if (!parsed.success) {
          return refuse(
            repeatsAWorkout(draft) ? PROGRAM_REFUSAL.once_per_day : PROGRAM_REFUSAL.invalid,
          );
        }
        const view = shown(parsed.data.programPublicId);
        const known = new Set(view?.workouts.map((w) => w.workoutPublicId));
        const slots = Object.values(parsed.data.days).flat();
        if (!view || slots.some((slot) => !known.has(slot.workoutPublicId))) {
          return refuse(PROGRAM_REFUSAL.not_found);
        }

        view.week = parsed.data.days;
        for (const workout of view.workouts) workout.usedOn = usedOn(view, workout.workoutPublicId);
        changed();
        return { ok: true };
      },

      async copyWorkout(draft) {
        if (failed()) return refuse(PROGRAM_REFUSAL.retry);
        const parsed = copyDraftSchema.safeParse(draft);
        if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
        const copy = parsed.data;
        const view = state.program;
        const source = view?.workouts.find((w) => w.workoutPublicId === copy.workoutPublicId);
        if (!view || !source || !listed(copy.toProgramPublicId)) {
          return refuse(PROGRAM_REFUSAL.not_found);
        }
        const replayed = minted.get(copy.clientId);
        if (replayed) return { ok: true, workoutPublicId: replayed };

        const workoutPublicId = newId();
        // A copy into another program lands on that program's page, which is not on screen.
        if (copy.toProgramPublicId === view.programPublicId) {
          const name = copy.name ?? copyName(source.name);
          if (view.workouts.some((w) => sameName(w.name, name))) {
            return refuse(PROGRAM_REFUSAL.name_taken);
          }
          minted.set(copy.clientId, workoutPublicId);
          for (const k of copy.weekdays) view.week[k].push({ workoutPublicId, label: copy.label });
          view.workouts.push({
            workoutPublicId,
            name,
            itemCount: source.itemCount,
            usedOn: usedOn(view, workoutPublicId),
            copiedFrom: { programName: view.name, on: view.today },
          });
        } else {
          // Another program's workouts are not in this fake's state, so it knows that program's
          // names only by what it has copied there: a second copy under a name already copied in
          // is the clash, and the dialog then asks for a name (maintainer, 2026-11-16).
          const name = copy.name ?? source.name;
          const there = copiedInto.get(copy.toProgramPublicId) ?? [];
          if (there.some((taken) => sameName(taken, name))) {
            return refuse(PROGRAM_REFUSAL.name_taken);
          }
          copiedInto.set(copy.toProgramPublicId, [...there, name]);
          minted.set(copy.clientId, workoutPublicId);
        }
        changed();
        return { ok: true, workoutPublicId };
      },

      async newItem(input) {
        if (failed()) return refuse(PROGRAM_REFUSAL.retry);
        const parsed = newItemSchema.safeParse(input);
        if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
        const { name, trackingType } = parsed.data;
        // An item is "the same movement" by the picker's rule (`existingItem`), which is looser than
        // a name's fold: "push ups" is Push-ups, and a catalog item's alias ("RDL") is that item.
        const existing = existingItem(
          // The catalog flag is the picker's tie-break (`movement-picker.tsx` maps it the same way).
          state.items.map((item) => ({ ...item, isCatalog: item.owner === 'catalog' })),
          name,
        );
        if (existing) {
          const { publicId: itemPublicId, name: itsName, trackingType: itsType } = existing;
          return { ok: true, itemPublicId, name: itsName, trackingType: itsType, existed: true };
        }

        const itemPublicId = newId();
        state.items.push({
          publicId: itemPublicId,
          name,
          trackingType,
          owner: 'household',
          unitDefault: null,
          isBodyweight: false,
        });
        changed();
        return { ok: true, itemPublicId, name, trackingType, existed: false };
      },

      async putOn(draft) {
        if (failed()) return refuse(PROGRAM_REFUSAL.retry);
        const parsed = assignDraftSchema.safeParse(draft);
        if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
        const { programPublicId, profilePublicIds, from } = parsed.data;
        const view = shown(programPublicId);
        if (!view) return refuse(PROGRAM_REFUSAL.not_found);
        if (from !== view.today && from !== addDays(view.today, 1)) {
          return refuse(PROGRAM_REFUSAL.invalid);
        }
        const picked = profilePublicIds.map((id) =>
          view.candidates.find((c) => c.profilePublicId === id),
        );
        if (picked.some((c) => !c)) return refuse(PROGRAM_REFUSAL.not_found);

        // The new program takes its place in the household's order among the ones they keep.
        const rank = (name: string) => state.programs.findIndex((p) => p.name === name);
        for (const candidate of picked) {
          if (!candidate) continue;
          if (candidate.on) {
            // On it already. If Take off gave them a last day, Put on undoes that: they stay on
            // with no gap, one stretch, whichever day was picked (maintainer, 2026-11-16).
            const athlete = view.athletes.find(
              (a) => a.profilePublicId === candidate.profilePublicId,
            );
            if (athlete) athlete.lastDay = null;
            continue;
          }
          const { profilePublicId, name, keeps } = candidate;
          view.athletes.push({ profilePublicId, name, since: from, lastDay: null, alsoOn: keeps });
          const later = keeps.findIndex((kept) => rank(kept) > rank(view.name));
          const at = later < 0 ? keeps.length : later;
          candidate.keeps = [...keeps.slice(0, at), view.name, ...keeps.slice(at)];
          candidate.on = true;
          listed(programPublicId)?.athletes.push(name);
        }
        // Who's on it reads in the household's order, which is the candidates', on the page and the list.
        const place = view.candidates.map((c) => c.profilePublicId);
        view.athletes.sort(
          (a, b) => place.indexOf(a.profilePublicId) - place.indexOf(b.profilePublicId),
        );
        const names = view.candidates.map((c) => c.name);
        listed(programPublicId)?.athletes.sort((a, b) => names.indexOf(a) - names.indexOf(b));
        changed();
        return { ok: true };
      },

      async takeOff(input) {
        if (failed()) return refuse(PROGRAM_REFUSAL.retry);
        const parsed = takeOffSchema.safeParse(input);
        if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
        const { programPublicId, profilePublicId } = parsed.data;
        const view = shown(programPublicId);
        const athlete = view?.athletes.find((a) => a.profilePublicId === profilePublicId);
        if (!view || !athlete) return refuse(PROGRAM_REFUSAL.not_found);

        // A start that has not begun, or that begins today, is removed: nothing says they were ever
        // on it. ⚠️ The real writer removes a start dated today only when nothing is logged under it
        // (`takeOffSchema`); this fake holds no logged rows, so for it a start dated today never has
        // any.
        const removed = !hasStarted(athlete, view.today) || athlete.since === view.today;
        if (removed) {
          view.athletes = view.athletes.filter((a) => a !== athlete);
          const candidate = view.candidates.find((c) => c.profilePublicId === profilePublicId);
          if (candidate) {
            candidate.on = false;
            candidate.keeps = candidate.keeps.filter((kept) => kept !== view.name);
          }
          const entry = listed(programPublicId);
          if (entry) entry.athletes = entry.athletes.filter((name) => name !== athlete.name);
        } else {
          // They stay listed until the end of today, with today as their last day.
          athlete.lastDay = view.today;
        }
        changed();
        return { ok: true, lastDay: removed ? null : view.today };
      },
    },
  };
}
