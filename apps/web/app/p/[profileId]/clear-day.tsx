'use client';

import {
  CLEAR_DAY_CONFIRM_MAX,
  CLEAR_DAY_CONFIRM_WORD,
  DAY_CLEAR_REFUSAL,
  normalizeClearConfirm,
  type DayClearRefusal,
} from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { pinDayBeforeWrite } from '@/components/day/day-screen';
import { Sheet } from '@/components/ui/sheet';
import { SheetFormFooter } from '@/components/ui/sheet-form-footer';
import { claim, expire } from '@/lib/a11y/focus-handoff';
import { prefersFineFocus } from '@/lib/a11y/pointer';
import {
  CLEAR_DAY_COPY,
  CLEAR_DAY_OUTCOME_ID,
  INPUT_CLASS,
  NAME_WRAP_CLASS,
  NAV_LINK_CLASS,
  RESTORE_ALL_ID,
} from '@/lib/constants';
import { formatDayShort } from '@/lib/date';
import type { ClearDaySummary } from '@/lib/entries/clear-summary';
import type { RestoreDeadline } from '@/lib/entries/restore-deadline';
import { cn } from '@/lib/utils';

import { clearDayAction } from './clear-day-actions';
import { clearDayKey, reportClearOutcome } from './clear-day-outcome';

const SHEET_ID = 'clear-day-confirm';
/** How long after Enter armed Clear day a submit is ignored: a held key's auto-repeat, not a tap. */
const ENTER_REPEAT_GUARD_MS = 600;
const FORM_ID = 'clear-day-form';

/** The summary's pieces, in the Amendment's order: workouts, then bodyweight, practice, the rest. */
function summaryParts(summary: ClearDaySummary): string[] {
  return [
    ...summary.workouts.map((w) => CLEAR_DAY_COPY.summaryWorkout(w.name, w.count)),
    ...(summary.weighIns ? [CLEAR_DAY_COPY.summaryWeighIns(summary.weighIns)] : []),
    ...(summary.practices ? [CLEAR_DAY_COPY.summaryPractices(summary.practices)] : []),
    ...(summary.other ? [CLEAR_DAY_COPY.summaryOther(summary.other)] : []),
  ];
}

/**
 * **Clear this day** (V1-9b B2-ii; plan `v1-9b-delete-and-restore.md` § "B2 as amended"): the trigger
 * at the foot of the day and its type-to-confirm dialog.
 *
 * 🔴 **Mounted on every day it can act on (today, a live athlete), even with nothing live**, keyed by
 * athlete and day by the page. The clear empties the day, so the revalidated page would otherwise
 * unmount the island that owns the dialog, its focus return and its report, mid-answer. Only the
 * trigger button depends on `summary` (null when nothing is live).
 *
 * - **Focus on open:** the title on a touch screen, the input with a fine pointer (maintainer,
 *   2026-11-19): on a phone the keyboard would otherwise hide the consequence or the buttons.
 * - **Enter or Done never clears.** With the word typed it moves focus to Clear day (the keyboard drops
 *   and the footer re-pins), so the destructive step is a visible tap. The footer's action is a
 *   submit, so the input's Enter is intercepted before the form's implicit submission, and a held
 *   Enter's auto-repeat that lands on the button within `ENTER_REPEAT_GUARD_MS` is ignored.
 * - **The dialog does not close while the clear is in flight**: its answer is reported from
 *   `onReturned`, which a close mid-flight would have spent with nothing to say.
 * - **The word resets on every open**, so a reopened dialog is never armed.
 * - **`pinDayBeforeWrite` runs on the trigger's tap, before the Sheet opens**: it replaces the
 *   history entry, which the open Sheet owns.
 * - **After the answer**, from `onReturned`: `count > 0` hands focus to the banner's Restore all
 *   (`focus-handoff.ts`, in either commit order); `count: 0` reports "Nothing was left to clear." on
 *   the banner's outcome line and focuses it. `count` is the day's newest clear's, never "this tap
 *   hid n", so no line says that.
 */
export function ClearDay({
  profileId,
  athleteName,
  day,
  today,
  summary,
  deadline,
}: {
  profileId: string;
  athleteName: string;
  day: string;
  today: string;
  summary: ClearDaySummary | null;
  deadline: RestoreDeadline;
}) {
  const router = useRouter();
  const key = clearDayKey(profileId, day);
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const after = useRef<{ target: string; report?: string } | null>(null);
  // When Enter last moved focus to Clear day: a held Enter's auto-repeat must not then press it.
  const armedByEnter = useRef(0);
  const bodyId = useId();
  const messageId = useId();
  const armed = normalizeClearConfirm(word) === CLEAR_DAY_CONFIRM_WORD;

  // A claim this island made must not outlive it (`focus-handoff.ts`).
  useEffect(() => () => expire(key), [key]);

  function openDialog() {
    pinDayBeforeWrite({ day, today });
    after.current = null;
    setWord('');
    setMessage('');
    setOpen(true);
  }

  function actionButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`button[type="submit"][form="${FORM_ID}"]`);
  }

  /** Close the dialog, and land focus on the outcome line once it is back (from `onReturned`). */
  function close() {
    if (!pending) setOpen(false);
  }

  function refused(reason: DayClearRefusal) {
    if (reason === DAY_CLEAR_REFUSAL.retry) return setMessage(CLEAR_DAY_COPY.refused.retry);
    // The day closed (midnight, an archive), or the page is stale: close, say why on the banner's
    // line, and re-read. 🔴 The report goes NOW, not from `onReturned`: the re-read can unmount this
    // island (the day no longer clearable), and the banner, keyed the same, survives it.
    reportClearOutcome(key, CLEAR_DAY_COPY.refused[reason]);
    after.current = { target: CLEAR_DAY_OUTCOME_ID };
    setOpen(false);
    if (reason === DAY_CLEAR_REFUSAL.closed_day) {
      // Past midnight the bare URL would re-resolve to the NEW today, a different key, and the report
      // would land on nobody. Stay on the day the person meant; it renders read-only, with the reason.
      router.replace(`${window.location.pathname}?d=${day}`);
    } else {
      router.refresh();
    }
  }

  async function clear() {
    if (pending) return;
    if (Date.now() - armedByEnter.current < ENTER_REPEAT_GUARD_MS) return;
    if (!armed) {
      setMessage(CLEAR_DAY_COPY.confirmFirst(CLEAR_DAY_CONFIRM_WORD));
      input.current?.focus();
      return;
    }
    setPending(true);
    setMessage('');
    let result: Awaited<ReturnType<typeof clearDayAction>>;
    try {
      result = await clearDayAction({ profilePublicId: profileId, day, confirm: word });
    } catch {
      // A dropped connection or a server error: say so, keep the word, and let them try again. A
      // replay is safe (the clear is keyed on state, plan Decision 6).
      setPending(false);
      return setMessage(CLEAR_DAY_COPY.failed);
    }
    setPending(false);
    if (!result.ok) return refused(result.reason);
    after.current =
      result.count > 0
        ? { target: RESTORE_ALL_ID }
        : { target: CLEAR_DAY_OUTCOME_ID, report: CLEAR_DAY_COPY.nothingLeft };
    setOpen(false);
  }

  return (
    <>
      {summary ? (
        <button
          ref={trigger}
          type="button"
          className={NAV_LINK_CLASS}
          aria-haspopup="dialog"
          onClick={openDialog}
        >
          {CLEAR_DAY_COPY.trigger}
        </button>
      ) : null}
      <Sheet
        id={SHEET_ID}
        variant="dialog"
        open={open}
        onOpenChange={(next) => (next ? openDialog() : close())}
        title={CLEAR_DAY_COPY.title(formatDayShort(day))}
        returnFocusTo={trigger}
        initialFocus={prefersFineFocus() ? input : undefined}
        onReturned={() => {
          const next = after.current;
          after.current = null;
          if (!next) return;
          if (next.report) reportClearOutcome(key, next.report);
          claim(key, next.target, trigger.current);
        }}
        footer={
          <SheetFormFooter
            formId={FORM_ID}
            messageId={messageId}
            message={message}
            action={pending ? CLEAR_DAY_COPY.pending : CLEAR_DAY_COPY.action}
            inactive={!armed || pending}
            variant="destructive"
            onCancel={close}
          />
        }
      >
        <form
          id={FORM_ID}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void clear();
          }}
        >
          {summary ? (
            <div id={bodyId} className={cn('flex flex-col gap-2 text-sm', NAME_WRAP_CLASS)}>
              <p>
                {CLEAR_DAY_COPY.body(
                  athleteName,
                  summaryParts(summary),
                  CLEAR_DAY_COPY.deadline[deadline],
                )}
              </p>
              {summary.workouts.length || summary.other ? (
                <p className="text-muted-foreground">{CLEAR_DAY_COPY.sessionStays}</p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <label htmlFor={`${FORM_ID}-word`} className="text-sm font-medium">
              {CLEAR_DAY_COPY.confirmLabel.before}
              <strong>{CLEAR_DAY_CONFIRM_WORD}</strong>
              {CLEAR_DAY_COPY.confirmLabel.after}
            </label>
            <input
              ref={input}
              id={`${FORM_ID}-word`}
              className={cn(INPUT_CLASS, 'w-full')}
              value={word}
              maxLength={CLEAR_DAY_CONFIRM_MAX}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-describedby={summary ? `${bodyId} ${messageId}` : messageId}
              aria-invalid={
                message === CLEAR_DAY_COPY.confirmFirst(CLEAR_DAY_CONFIRM_WORD) || undefined
              }
              onChange={(event) => {
                setWord(event.target.value);
                if (message) setMessage('');
              }}
              // On a phone the keyboard shrinks the viewport and the Sheet goes compact: keep the
              // field the person is typing in visible.
              onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: 'nearest' })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                // Never the form's implicit submit: Enter only moves to the armed button.
                event.preventDefault();
                if (event.repeat) return;
                if (!armed) return setMessage(CLEAR_DAY_COPY.confirmFirst(CLEAR_DAY_CONFIRM_WORD));
                armedByEnter.current = Date.now();
                actionButton()?.focus();
              }}
            />
          </div>
        </form>
      </Sheet>
    </>
  );
}
