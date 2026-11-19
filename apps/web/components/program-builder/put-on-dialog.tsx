'use client';

import {
  addDays,
  localWeekday,
  PROGRAM_REFUSAL,
  type ProgramActions,
  type ProgramView,
  type Weekday,
} from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { APP_HOME_PATH, FOCUS_TARGET_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { deviceToday } from '@/lib/date';
import { cn } from '@/lib/utils';

import {
  candidateOnLabel,
  fromText,
  keepLabel,
  keepsText,
  lastDayText,
  orderHintText,
  PUT_ON_COPY,
  putOnTitle,
  backOnText,
  sameTargetsText,
  startedText,
  startEffectText,
  startingNamesText,
  startLabel,
  stayOnEitherWayText,
  switchHintText,
} from './builder-text';
import { BuilderLink } from './route-link';
import { SheetFormFooter } from './sheet-form-footer';
import { useAttempt } from './use-attempt';

const SHEET_ID = 'put-on';
const FORM_ID = 'put-on-form';

type When = 'today' | 'tomorrow';

const NONE: ReadonlySet<string> = new Set();

/** The program's workouts on a day, in the week's order. */
function workoutsOn(program: ProgramView, day: string): string[] {
  const names = new Map(program.workouts.map((w) => [w.workoutPublicId, w.name]));
  return program.week[localWeekday(day) as Weekday].map((s) => names.get(s.workoutPublicId) ?? '');
}

/** The first day from `day` (within a week) the program has a workout on. */
function firstWorkoutDay(program: ProgramView, day: string) {
  for (let i = 1; i < 7; i++) {
    const next = addDays(day, i);
    const workouts = workoutsOn(program, next);
    if (workouts.length) return { day: next, workouts };
  }
  return null;
}

/**
 * "Put someone on this program" (FAM-1 step 10b; the prototype's `openStart`), in the shared
 * Sheet. The trigger and the dialog show only when the route supplies `putOn` (step 15 wires it).
 *
 * - **Who:** a fieldset of the household's candidates, each with what they keep (stacked under the
 *   name, never squeezed beside it at 360px). Someone already on it is ticked and inactive, "on
 *   it"; someone taken off reads their last day instead (UX panel, 2026-11-16).
 * - **Starting:** two radios, Today or Tomorrow, with a line saying what that day changes, from the
 *   program's own week. A start today is undoable the same day _(maintainer, 2026-11-16)_.
 * - **Start** names its count, and is inactive until someone new is ticked; a tap then says why.
 * - Its own refusals are said in the footer, seen and heard; the success line goes to the page's
 *   bar from `onReturned`, once focus is back (the bar is hidden while the sheet is open).
 *
 * Honest on real data (step 15): "Starting: names" above the footer confirms who, by name; someone
 * taken off today is kept on ("They stay on, with no gap.", "Keep n on …"), whatever day is picked;
 * someone joining a program others are on is told the targets are shared; a household with no
 * athlete is sent Home. **Who was just put on is held locally** (`justPutOn`), so the trigger and
 * where focus returns are decided in the same render as the close, not when the page's refresh lands.
 */
export function PutOn({
  program,
  putOn,
  takeOffWired,
  onStatus,
}: {
  program: ProgramView;
  putOn: NonNullable<ProgramActions['putOn']>;
  /** Whether Take off is wired: the "to switch instead" line names it. */
  takeOffWired: boolean;
  onStatus: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<When>('today');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const said = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const everyoneOn = useRef<HTMLParagraphElement>(null);
  // Who this dialog just put on, until the page's data changes: by then the data says so itself.
  const [justPutOn, setJustPutOn] = useState<{ for: ProgramView; ids: ReadonlySet<string> }>();
  const held = justPutOn?.for === program ? justPutOn.ids : NONE;
  const { begin, isCurrent, cancel } = useAttempt();
  const ids = useId();
  const messageId = `${ids}-message`;
  const effectId = `${ids}-effect`;

  const lastDays = new Map(program.athletes.map((a) => [a.profilePublicId, a.lastDay]));
  // Someone on it with a last day (taken off) can be put back on: that undoes the Take off (C15).
  const offered = (c: ProgramView['candidates'][number]) =>
    !held.has(c.profilePublicId) && (!c.on || !!lastDays.get(c.profilePublicId));
  const addable = program.candidates.filter(offered);
  const ticked = program.candidates.filter((c) => picked.has(c.profilePublicId));
  // Ticked and on it (taken off today): putting them on keeps them on, from today (C15).
  const back = ticked.filter((c) => c.on).map((c) => c.name);
  const fresh = ticked.filter((c) => !c.on).map((c) => c.name);
  const onlyBack = ticked.length > 0 && fresh.length === 0;
  const keeps = [
    ...new Set(ticked.flatMap((c) => c.keeps).filter((name) => name !== program.name)),
  ];
  const tomorrow = addDays(program.today, 1);
  const from = when === 'today' ? program.today : tomorrow;
  const effectWorkouts = workoutsOn(program, from);

  function openDialog() {
    setPicked(new Set());
    setWhen('today');
    setMessage('');
    setOpen(true);
  }

  function close(next: boolean) {
    if (next) return;
    cancel();
    setPending(false);
    setOpen(false);
  }

  async function start() {
    if (pending) return;
    if (!ticked.length) return setMessage(PUT_ON_COPY.pickSomeone);
    const mine = begin();
    setPending(true);
    setMessage('');
    let result: Awaited<ReturnType<typeof putOn>>;
    try {
      result = await putOn({
        programPublicId: program.programPublicId,
        profilePublicIds: ticked.map((c) => c.profilePublicId),
        from,
      });
    } catch {
      // A dropped connection is a retry, as the week editor's saves.
      result = { ok: false, reason: PROGRAM_REFUSAL.retry };
    }
    if (!isCurrent(mine)) return;
    setPending(false);
    if (!result.ok) {
      if (result.reason === PROGRAM_REFUSAL.retry) return setMessage(PUT_ON_COPY.failed);
      // `invalid`: a page loaded before midnight sends a start that is now yesterday, and a retry
      // would send it again. The page's today is stale: fetch it, as a stale program is.
      said.current =
        result.reason === PROGRAM_REFUSAL.invalid ? PUT_ON_COPY.dayChanged : PUT_ON_COPY.stale;
      setOpen(false);
      router.refresh();
      return;
    }
    // Someone taken off and put back on never left: they are not said to start (C15). The start's
    // day is named against the device's today NOW: the page's `today` is stale past midnight, and
    // Put on's answer carries no day.
    const today = deviceToday();
    said.current = [
      fresh.length ? startedText(fresh, program.name, from, today) : '',
      back.length ? backOnText(back, program.name) : '',
    ]
      .filter(Boolean)
      .join(' ');
    // In the same render as the close: if no one is left to add, the trigger becomes the line now,
    // and focus returns to it, rather than to a trigger the refresh is about to remove.
    setJustPutOn({
      for: program,
      ids: new Set([...held, ...ticked.map((c) => c.profilePublicId)]),
    });
    setOpen(false);
  }

  return (
    <>
      {/* The Sheet stays mounted when the last person is put on: only the trigger becomes a line,
          so the sheet closes (and pops its history entry) and focus has somewhere to return. */}
      {program.candidates.length === 0 ? (
        <p
          ref={everyoneOn}
          tabIndex={-1}
          className={`text-muted-foreground rounded-sm text-sm ${FOCUS_TARGET_CLASS}`}
        >
          {PUT_ON_COPY.addAthleteBefore}
          <BuilderLink
            href={APP_HOME_PATH}
            className="focus-visible:ring-ring text-foreground inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 outline-none focus-visible:ring-3"
          >
            {PUT_ON_COPY.addAthleteLink}
          </BuilderLink>
          {PUT_ON_COPY.addAthleteAfter}
        </p>
      ) : addable.length ? (
        <Button
          ref={trigger}
          type="button"
          variant={program.athletes.length ? 'outline' : 'default'}
          className="h-auto min-h-11 whitespace-normal"
          aria-haspopup="dialog"
          onClick={openDialog}
        >
          {PUT_ON_COPY.open}
        </Button>
      ) : (
        <p
          ref={everyoneOn}
          tabIndex={-1}
          className={`text-muted-foreground rounded-sm text-sm ${FOCUS_TARGET_CLASS}`}
        >
          {PUT_ON_COPY.everyoneOn}
        </p>
      )}
      <Sheet
        id={SHEET_ID}
        open={open}
        onOpenChange={close}
        title={putOnTitle(program.name)}
        returnFocusTo={addable.length ? trigger : everyoneOn}
        onReturned={() => {
          if (said.current) onStatus(said.current);
          said.current = null;
        }}
        footer={
          <SheetFormFooter
            formId={FORM_ID}
            messageId={messageId}
            message={message}
            lead={
              fresh.length ? (
                <p className={`text-sm font-medium ${NAME_WRAP_CLASS}`}>
                  {startingNamesText(fresh)}
                </p>
              ) : null
            }
            action={
              pending
                ? PUT_ON_COPY.startPending
                : onlyBack
                  ? keepLabel(ticked.length, program.name)
                  : startLabel(ticked.length, program.name)
            }
            inactive={!ticked.length || pending}
            onCancel={() => close(false)}
          />
        }
      >
        <form
          id={FORM_ID}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <p className="text-muted-foreground text-sm">{PUT_ON_COPY.intro}</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{PUT_ON_COPY.who}</legend>
            {program.candidates.map((c) => {
              const lastDay = lastDays.get(c.profilePublicId);
              const fixed = !offered(c);
              // Just put on (the refresh not landed yet): on it, as the data will say.
              const hint = held.has(c.profilePublicId)
                ? PUT_ON_COPY.onIt
                : c.on
                  ? lastDay
                    ? lastDay === program.today
                      ? PUT_ON_COPY.lastDayToday
                      : lastDayText(lastDay)
                    : PUT_ON_COPY.onIt
                  : keepsText(c.keeps.filter((name) => name !== program.name));
              return (
                <label
                  key={c.profilePublicId}
                  className={cn(
                    'flex min-h-11 items-start gap-3 rounded-lg border px-3 py-2',
                    fixed && 'text-muted-foreground',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 aria-disabled:opacity-50"
                    checked={fixed || picked.has(c.profilePublicId)}
                    aria-disabled={fixed || undefined}
                    // Its name is the person; what they keep is its description, read after.
                    aria-label={fixed ? candidateOnLabel(c.name, hint) : undefined}
                    aria-labelledby={fixed ? undefined : `${ids}-${c.profilePublicId}-name`}
                    aria-describedby={fixed ? undefined : `${ids}-${c.profilePublicId}`}
                    onChange={() => {
                      if (fixed) return;
                      const next = new Set(picked);
                      if (next.has(c.profilePublicId)) next.delete(c.profilePublicId);
                      else next.add(c.profilePublicId);
                      setPicked(next);
                      setMessage('');
                    }}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      id={`${ids}-${c.profilePublicId}-name`}
                      className={`font-medium ${NAME_WRAP_CLASS}`}
                    >
                      {c.name}
                    </span>
                    <span
                      id={`${ids}-${c.profilePublicId}`}
                      className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}
                    >
                      {hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <fieldset className="flex flex-col gap-2" aria-describedby={effectId}>
            <legend className="mb-2 text-sm font-medium">{PUT_ON_COPY.starting}</legend>
            {/* Everyone ticked was taken off today: the day picked would be ignored (C15). */}
            {onlyBack ? (
              <p id={effectId} className="text-muted-foreground text-sm">
                {PUT_ON_COPY.stayOnNoGap}
              </p>
            ) : null}
            {onlyBack
              ? null
              : (['today', 'tomorrow'] as const).map((option) => (
                  <label
                    key={option}
                    className="flex min-h-11 items-center gap-3 rounded-lg border px-3"
                  >
                    <input
                      type="radio"
                      name="put-on-from"
                      className="size-4 shrink-0"
                      checked={when === option}
                      onChange={() => setWhen(option)}
                    />
                    {fromText(option, option === 'today' ? program.today : tomorrow)}
                  </label>
                ))}
            {onlyBack ? null : (
              <p id={effectId} className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
                {startEffectText(
                  when,
                  effectWorkouts,
                  effectWorkouts.length ? null : firstWorkoutDay(program, from),
                )}
                {back.length ? ` ${stayOnEitherWayText(back)}` : null}
              </p>
            )}
          </fieldset>
          {fresh.length > 0 && program.athletes.length > 0 ? (
            <p className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
              {sameTargetsText(program.name)}
            </p>
          ) : null}
          {keeps.length ? (
            <div className={`text-muted-foreground flex flex-col gap-2 text-sm ${NAME_WRAP_CLASS}`}>
              <p>{orderHintText(program.name)}</p>
              {takeOffWired ? <p>{switchHintText(keeps)}</p> : null}
            </div>
          ) : null}
        </form>
      </Sheet>
    </>
  );
}
