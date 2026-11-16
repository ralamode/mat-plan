'use client';

import {
  foldName,
  MONDAY_FIRST,
  newId,
  PROGRAM_REFUSAL,
  slotLabelSchema,
  type ProgramActions,
  type ProgramView,
  type Weekday,
} from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type RefObject } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { INPUT_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import {
  BUILDER_COPY,
  COPY_COPY,
  copiedText,
  copyName,
  copyTakenText,
  copyTitle,
  doubleText,
  PENDING_CLASS,
  putOnInsteadText,
  targetPeopleText,
  thisProgramOption,
  WEEK_COPY,
} from './builder-text';
import { FieldLabel } from './field-label';
import { workoutPath } from './routes';
import { useAttempt } from './use-attempt';
import { DaysFieldset, SlotLabelField } from './week-editor/days-label-fields';

const SHEET_ID = 'copy-workout';
const FORM_ID = 'copy-workout-form';
const TO_ID = 'copy-workout-to';

type Workout = ProgramView['workouts'][number];

/** The label a workout has in this program's week, Monday first; '' if none. */
function labelIn(program: ProgramView, workoutPublicId: string): string {
  for (const day of MONDAY_FIRST) {
    const slot = program.week[day].find((s) => s.workoutPublicId === workoutPublicId);
    if (slot?.label) return slot.label;
  }
  return '';
}

/**
 * "Copy to…" (FAM-1 step 10b; the prototype's `openCopy`): one Sheet for every workout row, opened
 * on the one tapped, with focus returned to that row's button. It makes an independent workout.
 *
 * - **To starts on "Choose a program"** unless only one is offered (UX panel, 2026-11-16, as the
 *   week editor's workout select): a copy cannot be deleted, so nothing is chosen for the parent.
 *   Under it, who is on that program and will see it.
 * - **Days are optional**; the label shows once a day is ticked, prefilled from this program's week
 *   only when the copy stays in it (another program's slots mean other things).
 * - **A copy into this program** is named "Heavy A (copy)"; when that name is taken it says so and
 *   Copy stays inactive (no name field until the contract's `CopyDraft` has one).
 * - Someone on both programs who already does this workout on a picked day is named.
 * - One `clientId` per attempt, reused on a retry. Refusals are said in the footer; the success
 *   line goes to the page's bar from `onReturned`, and a copy into this program takes focus.
 */
export function CopyWorkout({
  program,
  copyWorkout,
  putOnWired,
  onStatus,
  workout,
  returnFocusTo,
  onClose,
}: {
  program: ProgramView;
  copyWorkout: ProgramActions['copyWorkout'];
  /** Whether "Put someone on" is wired: the hint that names it shows only then. */
  putOnWired: boolean;
  onStatus: (message: string) => void;
  /** The workout being copied; `null` while closed. */
  workout: Workout | null;
  returnFocusTo: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const router = useRouter();
  const options = [
    ...program.otherPrograms,
    { programPublicId: program.programPublicId, name: program.name },
  ];
  const only = options.length === 1 ? options[0]!.programPublicId : '';
  const [to, setTo] = useState(only);
  const [days, setDays] = useState<Set<Weekday>>(new Set());
  const [label, setLabel] = useState('');
  const [labelError, setLabelError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  // One attempt's id, reused on a retry; a new workout opened is a new attempt.
  const [clientId, setClientId] = useState(newId);
  const said = useRef<{ text: string; focus: string | null } | null>(null);
  const { begin, isCurrent, cancel } = useAttempt();
  const ids = useId();
  const messageId = `${ids}-message`;
  const peopleId = `${ids}-people`;

  // A new workout opens a fresh dialog: nothing chosen, a new attempt.
  const [seen, setSeen] = useState<Workout | null>(null);
  if (workout !== seen) {
    setSeen(workout);
    if (workout) {
      setTo(only);
      setDays(new Set());
      setLabel(only === program.programPublicId ? labelIn(program, workout.workoutPublicId) : '');
      setLabelError(null);
      setMessage('');
      setPending(false);
      setClientId(newId());
    }
  }

  const same = to === program.programPublicId;
  const target = options.find((o) => o.programPublicId === to);
  const name = workout ? copyName(workout.name) : '';
  // The writers' own name rule (plan D5): two names a person would read as the same one.
  const taken = same && program.workouts.some((w) => foldName(w.name) === foldName(name));
  const people = !target
    ? []
    : same
      ? program.athletes.map((a) => a.name)
      : program.candidates.filter((c) => c.keeps.includes(target.name)).map((c) => c.name);
  // Someone on both programs who already does this workout on a picked day (not for a copy here).
  const doubles =
    !workout || same || !target
      ? []
      : program.candidates
          .filter((c) => c.on && c.keeps.includes(target.name))
          .map((c) => ({
            name: c.name,
            on: MONDAY_FIRST.filter(
              (d) =>
                days.has(d) &&
                program.week[d].some((s) => s.workoutPublicId === workout.workoutPublicId),
            ),
          }))
          .filter((d) => d.on.length);

  function choose(next: string) {
    setTo(next);
    setMessage('');
    // The prefill belongs to this program's week; another program's slots mean other things.
    if (workout && !label) {
      setLabel(next === program.programPublicId ? labelIn(program, workout.workoutPublicId) : '');
    }
  }

  async function copy() {
    if (!workout || pending) return;
    if (!target) {
      setMessage(COPY_COPY.chooseFirst);
      return document.getElementById(TO_ID)?.focus();
    }
    if (taken) return setMessage(copyTakenText(name));
    const parsed = slotLabelSchema.safeParse(days.size ? label : '');
    if (!parsed.success) {
      setLabelError(WEEK_COPY.labelInvalid);
      return document.getElementById(`${ids}-label`)?.focus();
    }
    const weekdays = MONDAY_FIRST.filter((d) => days.has(d));
    const mine = begin();
    setPending(true);
    setMessage('');
    const result = await copyWorkout({
      clientId,
      workoutPublicId: workout.workoutPublicId,
      toProgramPublicId: target.programPublicId,
      weekdays,
      label: parsed.data,
    });
    if (!isCurrent(mine)) return;
    setPending(false);
    if (!result.ok) {
      if (result.reason === PROGRAM_REFUSAL.retry) return setMessage(COPY_COPY.failed);
      if (result.reason === PROGRAM_REFUSAL.name_taken) return setMessage(copyTakenText(name));
      said.current = { text: COPY_COPY.stale, focus: null };
      onClose();
      router.refresh();
      return;
    }
    said.current = {
      text: copiedText(workout.name, target.name, weekdays, same),
      focus: same ? workoutPath(program.programPublicId, result.workoutPublicId) : null,
    };
    onClose();
  }

  return (
    <Sheet
      id={SHEET_ID}
      open={!!workout}
      onOpenChange={(next) => {
        if (next) return;
        cancel();
        onClose();
      }}
      title={workout ? copyTitle(workout.name) : ''}
      returnFocusTo={returnFocusTo}
      onReturned={() => {
        const done = said.current;
        said.current = null;
        if (!done) return;
        // A copy into this program: focus its new row, the one the parent will edit next.
        if (done.focus) document.querySelector<HTMLElement>(`a[href="${done.focus}"]`)?.focus();
        onStatus(done.text);
      }}
      footer={
        <div className="flex flex-col gap-2">
          <Announcer
            id={messageId}
            message={message}
            className={cn('text-sm font-medium', message ? 'min-h-5' : 'h-0')}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="submit"
              form={FORM_ID}
              size="lg"
              className={`w-full text-base ${PENDING_CLASS}`}
              aria-disabled={!target || taken || pending || undefined}
              aria-describedby={messageId}
            >
              {pending ? COPY_COPY.copying : COPY_COPY.copy}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full text-base"
              onClick={() => {
                cancel();
                onClose();
              }}
            >
              {BUILDER_COPY.cancel}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={FORM_ID}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void copy();
        }}
      >
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={TO_ID}>{COPY_COPY.to}</FieldLabel>
          <select
            id={TO_ID}
            value={to}
            onChange={(event) => choose(event.target.value)}
            aria-describedby={target ? peopleId : undefined}
            className={`${INPUT_CLASS} w-full min-w-0`}
          >
            <option value="" disabled>
              {COPY_COPY.chooseProgram}
            </option>
            {options.map((o) => (
              <option key={o.programPublicId} value={o.programPublicId}>
                {o.programPublicId === program.programPublicId ? thisProgramOption(o.name) : o.name}
              </option>
            ))}
          </select>
          {target ? (
            <p id={peopleId} className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
              {taken ? copyTakenText(name) : targetPeopleText(target.name, people)}
            </p>
          ) : null}
        </div>
        <DaysFieldset
          idPrefix={ids}
          days={days}
          onDays={(next) => {
            setDays(next);
            setMessage('');
          }}
          legend={
            <>
              {COPY_COPY.days}{' '}
              <span className="text-muted-foreground font-normal">{COPY_COPY.optional}</span>
            </>
          }
          hint={null}
        />
        {doubles.map((d) => (
          <p key={d.name} className={`text-sm font-medium ${NAME_WRAP_CLASS}`}>
            {doubleText(d.name, workout!.name, d.on, program.name)}
          </p>
        ))}
        {days.size ? (
          <SlotLabelField
            id={`${ids}-label`}
            label={label}
            onLabel={(next) => {
              setLabel(next);
              setLabelError(null);
            }}
            error={labelError}
            hint={COPY_COPY.labelHint}
          />
        ) : null}
        <div className="text-muted-foreground flex flex-col gap-2 text-sm">
          <p>{COPY_COPY.separate}</p>
          {target && !same && putOnWired ? <p>{putOnInsteadText(program.name)}</p> : null}
        </div>
      </form>
    </Sheet>
  );
}
