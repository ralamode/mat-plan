'use client';

import {
  copyName,
  foldName,
  MONDAY_FIRST,
  newId,
  PROGRAM_REFUSAL,
  slotLabelSchema,
  WORKOUT_NAME_MAX,
  workoutNameSchema,
  type ProgramActions,
  type ProgramResult,
  type ProgramView,
  type Weekday,
} from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type RefObject } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Sheet } from '@/components/ui/sheet';
import { INPUT_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';

import {
  cleanName,
  COPY_COPY,
  copiedText,
  copyRefusal,
  copyTakenElsewhereText,
  copyTakenText,
  copyTitle,
  dayIsFull,
  doubleText,
  putOnInsteadText,
  targetPeopleText,
  programIsFull,
  skippedFullText,
  thisProgramFullOption,
  thisProgramOption,
  WEEK_COPY,
} from './builder-text';
import { FieldLabel } from './field-label';
import { NameField } from './name-field';
import { workoutPath } from './routes';
import { SheetFormFooter } from './sheet-form-footer';
import { focusField, useAttempt } from './use-attempt';
import { DaysFieldset, SlotLabelField } from './week-editor/days-label-fields';

const SHEET_ID = 'copy-workout';
const FORM_ID = 'copy-workout-form';
const TO_ID = 'copy-workout-to';
const NAME_ID = 'copy-workout-name';

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
 * The rules are the guide's invariant 18 (`docs/features/program-builder.md`).
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
  // What the label holds because it was prefilled, so a change of To replaces only that.
  const [prefilled, setPrefilled] = useState('');
  const [labelError, setLabelError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  // The other program that refused this copy's name: the Name field shows for it from then on.
  const [refusedIn, setRefusedIn] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  // A `limit_reached` is said on To (the program, or a day of it, is full), as well as in the footer.
  const [toRefused, setToRefused] = useState(false);
  const [pending, setPending] = useState(false);
  // One attempt's id, reused on a retry; a new opening is a new attempt.
  const [clientId, setClientId] = useState(newId);
  // A changed draft is a new attempt: a retry reuses the id only for the very same copy, or a
  // replay would answer for the old one (a dropped connection after it landed).
  const changed = () => setClientId(newId());
  const said = useRef<{ text: string; focus: string | null } | null>(null);
  const { begin, isCurrent, cancel } = useAttempt();
  const ids = useId();
  const messageId = `${ids}-message`;
  const peopleId = `${ids}-people`;

  /** The label for a program: this program's slot label, or none (another program's slots differ). */
  const prefillFor = (programId: string) =>
    workout && programId === program.programPublicId
      ? labelIn(program, workout.workoutPublicId)
      : '';

  // A new workout opens a fresh dialog: nothing chosen, a new attempt.
  const [seen, setSeen] = useState<Workout | null>(null);
  if (workout !== seen) {
    setSeen(workout);
    if (workout) {
      const first =
        only === program.programPublicId ? labelIn(program, workout.workoutPublicId) : '';
      setTo(only);
      setDays(new Set());
      setLabel(first);
      setPrefilled(first);
      setLabelError(null);
      setName(copyName(workout.name));
      setNameError(null);
      setRefusedIn(null);
      setMessage('');
      setToRefused(false);
      setPending(false);
      setClientId(newId());
    }
  }

  const same = to === program.programPublicId;
  // Within this program its full days can't be picked (7b-i); another program's week isn't read.
  const fullHere = new Set(MONDAY_FIRST.filter((d) => dayIsFull(program.week[d].length)));
  const full = same ? fullHere : new Set<Weekday>();
  const target = options.find((o) => o.programPublicId === to);
  // The Name field: always for a copy here (C15), and for another program once it refused the name.
  const naming = same || (!!refusedIn && refusedIn === to);
  const current = new Set(program.athletes.filter((a) => !a.lastDay).map((a) => a.profilePublicId));
  const people = !target
    ? []
    : same
      ? program.athletes.filter((a) => !a.lastDay).map((a) => a.name)
      : program.candidates.filter((c) => c.keeps.includes(target.name)).map((c) => c.name);
  // Someone on both programs who already does this workout on a picked day (not for a copy here).
  const doubles =
    !workout || same || !target
      ? []
      : program.candidates
          .filter((c) => current.has(c.profilePublicId) && c.keeps.includes(target.name))
          .map((c) => ({
            name: c.name,
            on: workout.usedOn.filter((d) => days.has(d as Weekday)),
          }))
          .filter((d) => d.on.length);

  function choose(next: string) {
    setTo(next);
    changed();
    setMessage('');
    setToRefused(false);
    setNameError(null);
    // A full day of this program, ticked for another one, is not picked here.
    if (next === program.programPublicId)
      setDays((d) => new Set([...d].filter((x) => !fullHere.has(x))));
    // Replace the label only if it is still the prefill: what the person typed stays theirs.
    if (label === '' || label === prefilled) {
      const fill = prefillFor(next);
      setLabel(fill);
      setPrefilled(fill);
    }
  }

  async function attempt(
    draft: Parameters<typeof copyWorkout>[0],
  ): Promise<ProgramResult<{ workoutPublicId: string }>> {
    try {
      return await copyWorkout(draft);
    } catch {
      // A dropped connection is a retry, as the week editor's saves.
      return { ok: false, reason: PROGRAM_REFUSAL.retry };
    }
  }

  async function copy() {
    if (!workout || pending) return;
    if (!target) {
      setMessage(COPY_COPY.chooseFirst);
      return focusField(document.getElementById(TO_ID));
    }
    const named = naming ? workoutNameSchema.safeParse(name) : null;
    if (named && !named.success) {
      // Fixed sentences, never the schema's own message (written for a developer).
      setNameError(cleanName(name) ? COPY_COPY.nameInvalid : COPY_COPY.nameMissing);
      return focusField(document.getElementById(NAME_ID));
    }
    const copyAs = named?.success ? named.data : workout.name;
    if (same && program.workouts.some((w) => foldName(w.name) === foldName(copyAs))) {
      setNameError(copyTakenText(copyAs));
      return focusField(document.getElementById(NAME_ID));
    }
    const parsed = slotLabelSchema.safeParse(days.size ? label : '');
    if (!parsed.success) {
      setLabelError(WEEK_COPY.labelInvalid);
      return focusField(document.getElementById(`${ids}-label`));
    }
    // A day of this program that filled while the dialog was open is not sent.
    const weekdays = MONDAY_FIRST.filter((d) => days.has(d) && !full.has(d));
    const skipped = MONDAY_FIRST.filter((d) => days.has(d) && full.has(d));
    const mine = begin();
    setPending(true);
    setMessage('');
    setToRefused(false);
    const result = await attempt({
      clientId,
      workoutPublicId: workout.workoutPublicId,
      toProgramPublicId: target.programPublicId,
      ...(named?.success ? { name: named.data } : {}),
      weekdays,
      label: parsed.data,
    });
    if (!isCurrent(mine)) return;
    setPending(false);
    if (!result.ok) {
      if (result.reason === PROGRAM_REFUSAL.retry) return setMessage(COPY_COPY.failed);
      if (result.reason === PROGRAM_REFUSAL.limit_reached) {
        // The page is not stale: say which cap, on To, and leave the choice to the person.
        setMessage(
          copyRefusal(result.reason, {
            sameProgram: same,
            dayPicked: weekdays.length > 0,
            target: target.name,
          }),
        );
        setToRefused(true);
        requestAnimationFrame(() => focusField(document.getElementById(TO_ID)));
        return;
      }
      if (result.reason === PROGRAM_REFUSAL.name_taken) {
        // The field shows, prefilled, with what was refused said on it; Copy is pressed again.
        if (!same) setRefusedIn(target.programPublicId);
        setNameError(same ? copyTakenText(copyAs) : copyTakenElsewhereText(target.name, copyAs));
        requestAnimationFrame(() => focusField(document.getElementById(NAME_ID)));
        return;
      }
      said.current = { text: COPY_COPY.stale, focus: null };
      onClose();
      router.refresh();
      return;
    }
    said.current = {
      text: [copiedText(copyAs, target.name, weekdays, same), skippedFullText(skipped)]
        .filter(Boolean)
        .join(' '),
      focus: same ? workoutPath(program.programPublicId, result.workoutPublicId) : null,
    };
    onClose();
  }

  const close = () => {
    cancel();
    onClose();
  };

  return (
    <Sheet
      id={SHEET_ID}
      open={!!workout}
      onOpenChange={(next) => {
        if (!next) close();
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
        <SheetFormFooter
          formId={FORM_ID}
          messageId={messageId}
          message={message}
          action={pending ? COPY_COPY.copying : COPY_COPY.copy}
          inactive={!target || pending}
          onCancel={close}
        />
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
            aria-invalid={toRefused || undefined}
            aria-describedby={
              [target ? peopleId : null, toRefused ? messageId : null].filter(Boolean).join(' ') ||
              undefined
            }
            className={`${INPUT_CLASS} w-full min-w-0`}
          >
            <option value="" disabled>
              {COPY_COPY.chooseProgram}
            </option>
            {options.map((o) => (
              <option key={o.programPublicId} value={o.programPublicId}>
                {o.programPublicId !== program.programPublicId
                  ? o.name
                  : programIsFull(program.workouts.length)
                    ? thisProgramFullOption(o.name)
                    : thisProgramOption(o.name)}
              </option>
            ))}
          </select>
          {target ? (
            <p id={peopleId} className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
              {targetPeopleText(target.name, people)}
            </p>
          ) : null}
        </div>
        {naming ? (
          <NameField
            id={NAME_ID}
            label={COPY_COPY.name}
            value={name}
            max={WORKOUT_NAME_MAX}
            onChange={(next) => {
              setName(next);
              setNameError(null);
              changed();
            }}
            error={nameError}
          />
        ) : null}
        <DaysFieldset
          idPrefix={ids}
          days={days}
          full={full}
          onDays={(next) => {
            setDays(next);
            setMessage('');
            setToRefused(false);
            changed();
          }}
          legend={
            <>
              {COPY_COPY.days}{' '}
              <span className="text-muted-foreground font-normal">{COPY_COPY.optional}</span>
            </>
          }
          hint={null}
        />
        {/* Heard as well as seen: the warning that matters most here. */}
        <Announcer
          message={
            workout
              ? doubles.map((d) => doubleText(d.name, workout.name, d.on, program.name)).join(' ')
              : ''
          }
          className={doubles.length ? `text-sm font-medium ${NAME_WRAP_CLASS}` : 'h-0'}
        />
        {days.size ? (
          <SlotLabelField
            id={`${ids}-label`}
            label={label}
            onLabel={(next) => {
              setLabel(next);
              setLabelError(null);
              changed();
            }}
            error={labelError}
            hint={COPY_COPY.labelHint}
          />
        ) : null}
        <div className="text-muted-foreground flex flex-col gap-2 text-sm">
          <p>{COPY_COPY.separate}</p>
          <p>{COPY_COPY.permanent}</p>
          {target && !same && putOnWired ? <p>{putOnInsteadText(program.name)}</p> : null}
        </div>
      </form>
    </Sheet>
  );
}
