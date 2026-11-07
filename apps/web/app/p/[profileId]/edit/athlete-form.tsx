'use client';

import { PROFILE_NAME_MAX } from '@mat-plan/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { Announcer } from '@/components/announcer';
import { Button } from '@/components/ui/button';
import { renameAthleteAction } from '@/app/p/profile-actions';
import { ATHLETE_FORM_COPY, INPUT_CLASS, SAVING_LABEL } from '@/lib/constants';

import { INITIAL_ACTION_STATE } from '../action-state';
import { useOnActionSuccess } from '../use-on-action-success';

const NAME_INPUT_ID = 'athlete-name';
const NAME_ERROR_ID = 'athlete-name-error';

/**
 * The rename form (PROF-1 a-r). Colocated with its route, not in `components/` — islands live beside
 * the page they belong to (PROF-1 D9); a-1's add form is the second consumer and imports it from here.
 *
 * ## Controlled, not uncontrolled, and that is a correctness fix not a preference
 *
 * `name` is React state (D7, UX1 B1). **React 19 resets an uncontrolled field when a form action
 * settles — including on `{ ok: false }`** (`docs/features/write-path.md:341`), so an uncontrolled
 * input would EMPTY the name underneath its own "Enter a name." error, leaving the parent staring at
 * a blank field that says it is blank.
 *
 * ## Navigation on success (D6)
 *
 * The action returns `{ ok: true }`; it does not redirect. "Go back where the parent came from"
 * is a *history* question, and a server redirect cannot answer it without pushing a duplicate entry
 * (`[day, edit]` would become `[day, edit, day]`; `replace` would make it `[day, day]`). So the
 * island navigates, in an **effect** — never during render, which is what `useOnActionSuccess`'s own
 * comment forbids — using `router.back()` when there is somewhere to go back to and
 * `router.replace(fallbackPath)` when there is not (a parent who typed the URL or opened a bookmark
 * has `history.length === 1`, and `back()` would take them out of the app).
 *
 * ⚠️ **`?from=` is deliberately absent in a-r**, though PROF-1 D6 describes it: today there is
 * exactly ONE in-app entry to this screen (the athlete's day page), so the param would have a single
 * legal value and the page's allowlist would be a list of one. PROF-1 b adds `/settings` as the
 * second entry and adds the param with it — at which point the allowlist has a job.
 *
 * ## Without JavaScript
 *
 * A no-JS submit posts the form, the action runs, and the page re-renders with the status line
 * VISIBLE (the `Announcer`'s overridden class) plus the back link above it. There is no navigation
 * and none is needed: the `<h1>` already shows the new name, which is the confirmation.
 */
export function AthleteForm({
  profileId,
  name: initialName,
  fallbackPath,
}: {
  profileId: string;
  /** The stored name, from the server. The field seeds from it and the parent edits from there. */
  name: string;
  /** Where to go after a save when there is no history to go back to. The athlete's own day page. */
  fallbackPath: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(renameAthleteAction, INITIAL_ACTION_STATE);
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(false);

  // During-render transition tracking, single-sourced (`useOnActionSuccess`). It only flips a flag —
  // the navigation is in the effect below, because calling `router` during render is the thing that
  // hook's docblock says this pattern is legal only without.
  useOnActionSuccess(state, () => setSaved(true));

  useEffect(() => {
    if (!saved) return;
    // `history.length > 1` is the only signal available for "did they arrive from inside the app".
    // It is conservative in the safe direction: a false negative lands them on the athlete's own
    // page, which is where they were going; a false positive would leave the app entirely.
    if (window.history.length > 1) router.back();
    else router.replace(fallbackPath);
  }, [saved, router, fallbackPath]);

  const nameErrors = state.fieldErrors?.name;
  const invalid = !saved && (nameErrors?.length ?? 0) > 0;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="profileId" value={profileId} readOnly />

      <div className="flex flex-col gap-2">
        <label htmlFor={NAME_INPUT_ID} className="text-sm font-medium">
          {ATHLETE_FORM_COPY.nameLabel}
        </label>
        {/* The phone-keyboard attributes, which the UX panel asked for by name (U14):
              - `autoCapitalize="words"` — a name is capitalised; the default sentence-case gets the
                first word right and every later one wrong ("Mary ann").
              - `autoComplete="off"` — the prototype's own attribute. A name field will otherwise be
                offered the DEVICE OWNER's name, which on a shared family phone is the wrong person.
              - `spellCheck={false}` — every name is a misspelling to a dictionary; the red underline
                is noise that says the input is wrong.
              - `enterKeyHint="done"` — the keyboard's action key submits a one-field form; "go" or
                "next" imply somewhere else to be.
            `w-full` because `INPUT_CLASS` carries no width (U14) — unset, a text input is its
            browser-default ~20ch, which at 360px leaves the field narrower than the names it holds. */}
        <input
          id={NAME_INPUT_ID}
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={PROFILE_NAME_MAX}
          autoCapitalize="words"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? NAME_ERROR_ID : undefined}
          className={`${INPUT_CLASS} w-full`}
        />
        {/* `role="alert"` and not the Announcer: a refusal is something the parent must act on
            before the form will save, which is the one case that is allowed to interrupt. */}
        {invalid ? (
          <p id={NAME_ERROR_ID} role="alert" className="text-destructive text-sm">
            {nameErrors!.join(' ')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {/* `w-fit`, following the prototype (`index.html:2164`, `style="width:fit-content"`): a
            full-width primary button on a one-field form reads as the end of a long flow. */}
        <Button type="submit" size="lg" disabled={pending} className="w-fit text-base">
          {pending ? SAVING_LABEL : ATHLETE_FORM_COPY.save}
        </Button>

        {/* 🔴 Mounted in BOTH states, with `message=''` until there is one — a live region that
            mounts together with its text is never announced. VISIBLE rather than `sr-only` because
            with JavaScript off this line is the only confirmation a sighted parent gets (D6). */}
        <Announcer
          message={saved ? ATHLETE_FORM_COPY.saved : ''}
          className="text-muted-foreground text-sm"
        />

        {/* The page-level refusal — no session, rate-limited, or no such athlete. Separate from the
            field error above: there is nothing in the form to correct, so it gets a way out rather
            than an `aria-invalid` on an input that is fine. */}
        {state.error ? (
          <div className="flex flex-col gap-1">
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
            <Link
              href={fallbackPath}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 w-fit items-center rounded-sm text-sm outline-none focus-visible:ring-3"
            >
              ← Back
            </Link>
          </div>
        ) : null}
      </div>
    </form>
  );
}
