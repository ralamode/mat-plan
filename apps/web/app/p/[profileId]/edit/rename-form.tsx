'use client';

import { PROFILE_NAME_MAX } from '@mat-plan/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { renameAthleteAction } from '@/app/p/profile-actions';
import { ATHLETE_FORM_COPY, INPUT_CLASS, NAV_LINK_CLASS, SAVING_LABEL } from '@/lib/constants';

import { INITIAL_ACTION_STATE } from '../action-state';

const NAME_INPUT_ID = 'athlete-name';
const NAME_ERROR_ID = 'athlete-name-error';

/**
 * The rename form (PROF-1 a-r). Colocated with its route, not in `components/` — islands live beside
 * the page they belong to (PROF-1 D9).
 *
 * ⚠️ **`RenameForm`, not `AthleteForm`, and a-1's add form will NOT import it.** It hard-wires
 * `renameAthleteAction`, carries a hidden `profileId`, and navigates from the client. a-1's add form
 * has no `profileId`, carries a `kind` radio and a `clientId`, and navigates by a SERVER
 * `redirect(…, RedirectType.replace)` (D6) — three differences in the parts that matter, so sharing
 * the component would mean parametrising all three. `ATHLETE_FORM_COPY` is the piece that really is
 * shared. Named for what it is, per AGENTS.md → File organization.
 *
 * ## Controlled, not uncontrolled — a correctness fix, not a preference
 *
 * `name` is React state (D7, UX1 B1). **React 19 resets an uncontrolled field when a form action
 * settles — including on `{ ok: false }`** (`docs/features/write-path.md:341`), so an uncontrolled
 * input would EMPTY the name underneath its own "Enter a name." error, leaving the parent staring at
 * a blank field that says it is blank. `e2e/athletes.spec.ts` asserts the field keeps what was typed.
 *
 * ## Two things a review found, both stated here because the first version got them wrong
 *
 * 🔴 **1. `saved` is `state.ok`, NOT a `useOnActionSuccess` transition.** That hook seeds
 * `useState(state)`, so on the FIRST render `state === seen` and `onSuccess` never fires — which is
 * exactly the render a **no-JavaScript** submit produces (the server re-renders with the action's
 * result already in `useActionState`). The first version used the hook and claimed in this docblock
 * that a no-JS submit showed a visible "Name saved." line: **it rendered an empty `<p>`**. Reading
 * `state.ok` directly is correct in both modes — `useActionState` returns a fresh object per submit
 * and `ok` is only ever true after a real save.
 *
 * 🔴 **2. `?from=` is BUILT, and `history.length` alone was not a safe signal.** The first version
 * dropped the param on the grounds that one in-app entry exists today so the allowlist would have one
 * member — which answers what `from` POINTS AT and ignores what it SIGNALS: *that the parent arrived
 * from inside the app at all*. `window.history.length > 1` is true in almost every real phone tab
 * (Safari reuses tabs; a pasted link or a bookmark lands on top of whatever was there), so
 * `back()` would have ejected a parent who typed the URL — the case the comment called "the unsafe
 * direction" is the common one. With `from`: present ⇒ in-app ⇒ `back()` (no duplicate history
 * entry); absent ⇒ `replace(fallbackPath)`. PR b appends `SETTINGS_PATH` to the page's allowlist and
 * this island does not change.
 *
 * ## What the parent actually sees on success
 *
 * **With JavaScript:** they land back on the athlete's day page, whose `<h1>` is the new name. That
 * is the confirmation (UX round 2, U9: _"a pure rename's confirmation is the new `<h1>`"_), not the
 * status line — Next's route announcer is `aria-live="assertive"`, so it pre-empts this polite region
 * on the way out. **Without JavaScript:** no navigation, and the visible "Name saved." line plus the
 * re-rendered `<h1>` above it are the whole confirmation. The region is mounted in both states so a
 * screen reader hears the change rather than a region that appeared with its text already in it.
 */
export function RenameForm({
  profileId,
  name: initialName,
  from,
  fallbackPath,
}: {
  profileId: string;
  /** The stored name, from the server. The field seeds from it and the parent edits from there. */
  name: string;
  /** The allowlisted in-app referrer, or `null` when this page was reached from outside the app. */
  from: string | null;
  /** Where to go when there is no in-app referrer. The athlete's own day page. */
  fallbackPath: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(renameAthleteAction, INITIAL_ACTION_STATE);
  const [name, setName] = useState(initialName);
  const nameRef = useRef<HTMLInputElement>(null);

  const nameErrors = state.fieldErrors?.name;
  const invalid = (nameErrors?.length ?? 0) > 0;
  // Derived, never a transition — see the docblock. True on a no-JS re-render too.
  const saved = state.ok;

  useEffect(() => {
    if (!saved) return;
    // `from` is the in-app signal; `history.length > 1` only says the TAB has history, which is
    // nearly always true. Both, or `replace` — `back()` must never be able to leave the app.
    if (from && window.history.length > 1) router.back();
    else router.replace(from ?? fallbackPath);
  }, [saved, from, router, fallbackPath]);

  useEffect(() => {
    // 🔴 A refusal returns focus to the field that is wrong. `disabled={pending}` blurs the submit
    // button when it disables, so focus is on `<body>` by the time the alert renders: the next Tab
    // would start from the top of the document, past the error, and a screen-reader user would hear
    // the alert with no way back to the input but a blind Tab hunt. D7 promised this (A11Y-2) and
    // the first version did not build it. Keyed on `state` identity, so a second refusal re-focuses.
    if (invalid) nameRef.current?.focus();
  }, [state, invalid]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="profileId" value={profileId} readOnly />

      <div className="flex flex-col gap-2">
        <label htmlFor={NAME_INPUT_ID} className="text-sm font-medium">
          {ATHLETE_FORM_COPY.nameLabel}
        </label>
        {/* The phone-keyboard attributes (UX panel, U14):
              - `autoCapitalize="words"` — a name is capitalised; the default sentence-case gets the
                first word right and every later one wrong ("Mary ann").
              - `autoComplete="off"` — the prototype's own attribute. A name field is otherwise
                offered the DEVICE OWNER's name, which on a shared family phone is the wrong person.
              - `spellCheck={false}` — every name is a misspelling to a dictionary; the red underline
                says the input is wrong when it is not.
              - `enterKeyHint="go"` — this one-field form SUBMITS on the return key. "done" reads on
                iOS as "dismiss the keyboard", which is not what the key does here.
            `w-full` because `INPUT_CLASS` carries no width (U14) — unset, a text input is its
            browser-default ~20ch, narrower at 360px than the names it holds. */}
        <input
          ref={nameRef}
          id={NAME_INPUT_ID}
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={PROFILE_NAME_MAX}
          autoCapitalize="words"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? NAME_ERROR_ID : undefined}
          className={`${INPUT_CLASS} w-full`}
        />
        {/* `role="alert"`, not the Announcer: a refusal is something the parent must act on before
            the form will save, which is the one case allowed to interrupt. */}
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

        {/* Mounted in BOTH states with `message=''` until there is one — a live region that mounts
            together with its text is never announced. VISIBLE, because without JavaScript this line
            is the confirmation a sighted parent gets; with JavaScript the day page's `<h1>` is. */}
        <Announcer
          message={saved ? ATHLETE_FORM_COPY.saved : ''}
          className="text-muted-foreground text-sm empty:hidden"
        />

        {/* The page-level refusal — no session, rate-limited, or no such athlete. Separate from the
            field error above: there is nothing in the form to correct, so it gets a way out rather
            than an `aria-invalid` on an input that is fine. */}
        {state.error ? (
          <div className="flex flex-col gap-1">
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
            <Link href={fallbackPath} className={NAV_LINK_CLASS}>
              ← Back
            </Link>
          </div>
        ) : null}
      </div>
    </form>
  );
}
