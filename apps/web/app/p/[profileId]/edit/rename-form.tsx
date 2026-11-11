'use client';

import {
  foldName,
  PROFILE_KIND_LABELS,
  PROFILE_NAME_MAX,
  type ProfileKind,
} from '@mat-plan/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { renameAthleteAction } from '@/app/p/profile-actions';
import {
  ATHLETE_FORM_COPY,
  CHOICE_BUTTON_CLASS,
  INPUT_CLASS,
  NAME_ERROR_ID,
  NAME_WRAP_CLASS,
  NAV_LINK_CLASS,
  SAVING_LABEL,
} from '@/lib/constants';

import { INITIAL_ACTION_STATE } from '../action-state';

const NAME_INPUT_ID = 'athlete-name';

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
 * settles — including on `{ ok: false }`** (`write-path.md` → Traps, the uncontrolled-fields bullet), so an uncontrolled
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
  kind,
  from,
  fallbackPath,
}: {
  profileId: string;
  /** The stored name, from the server. The field seeds from it and the parent edits from there. */
  name: string;
  /**
   * This athlete's kind. ⚠️ **Only used to gate the "both will show as" line** (a-1d-ren): a picker
   * tile shows name AND kind, so a Child and an Adult sharing a name are already distinguishable and
   * that advice would be false. Not rendered — the edit page shows the kind itself.
   */
  kind: ProfileKind;
  /** The allowlisted in-app referrer, or `null` when this page was reached from outside the app. */
  from: string | null;
  /** Where to go when there is no in-app referrer. The athlete's own day page. */
  fallbackPath: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(renameAthleteAction, INITIAL_ACTION_STATE);
  const [name, setName] = useState(initialName);
  const nameRef = useRef<HTMLInputElement>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  /**
   * 🔴 **Shown only while the typed name still FOLDS to what the warning was issued for.** `state`
   * persists in `useActionState` until the next submit, so editing past the match would otherwise
   * leave a warning about somebody the parent has stopped typing — and, because the primary submit
   * is unmounted while it shows, a stale callout would also hold the Enter key hostage.
   */
  const duplicate =
    state.duplicate && foldName(name) === state.duplicate.folded ? state.duplicate : null;

  const duplicateMessageId = `${NAME_INPUT_ID}-duplicate`;
  /**
   * "Both will show as X" is true only when the two tiles really would be identical — same spelling
   * AND same kind. `collapseWhitespace` is not needed here: `initialName` and the field both pass
   * through the same schema, and the comparison is against the STORED match name.
   */
  const showDisambiguation = Boolean(
    duplicate &&
    !duplicate.match.archived &&
    name.trim() === duplicate.match.name &&
    kind === duplicate.match.kind,
  );

  const nameErrors = state.fieldErrors?.name;
  const invalid = (nameErrors?.length ?? 0) > 0;

  /**
   * 🔴 **The warning is APPENDED to the field's description, not merely rendered below it.** A
   * screen-reader user hears the callout once, on the focus move; the moment they Shift+Tab back
   * here to change the spelling — which is exactly what the advice asks of them — this association
   * is the only thing that still speaks. Shipped on the add form after a review found three
   * artifacts describing a wiring that no element actually had.
   *
   * Composed here rather than inline: an attribute list is no place for the reasoning, and a `//`
   * comment among JSX attributes is non-standard enough that `tsc` and `esbuild` disagree about it.
   */
  const describedBy =
    [invalid ? NAME_ERROR_ID : null, duplicate ? duplicateMessageId : null]
      .filter(Boolean)
      .join(' ') || undefined;
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
    // 🔴 A refusal returns focus to the thing that is wrong. `disabled={pending}` blurs the submit
    // button when it disables, so focus is on `<body>` by the time the alert renders: the next Tab
    // would start from the top of the document, past the error, and a screen-reader user would hear
    // the alert with no way back but a blind Tab hunt. D7 promised this (A11Y-2) and the first
    // version did not build it.
    //
    // 🔴 **Keyed on `[state]` ALONE, and it reads `state.duplicate` rather than the derived
    // `duplicate` above.** That derived value depends on TYPING, so a dependency on it would mean a
    // parent who backspaces "Ada B" back to "Ada " re-matches, the callout remounts, and focus is
    // yanked out of the field mid-edit — on a phone that also drops the keyboard under their thumb.
    // The add form documents the same rule for the same reason.
    //
    // Order matters: a duplicate answer carries no `fieldErrors`, and the error block below only
    // exists on `state.error`, so the three arms are mutually exclusive by construction.
    if (state.duplicate) calloutRef.current?.focus();
    else if (invalid) nameRef.current?.focus();
    // ⚠️ **The page-level refusal needs its own target, and the add form's fix does not transfer.**
    // There, focus returns to the callout; here the callout has UNMOUNTED by the time this answer
    // arrives (the envelope carries no `duplicate`), so there is nothing to return to and focus
    // would sit on `<body>`.
    else if (state.error) errorRef.current?.focus();
  }, [state, invalid]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* 🔴 **The implicit-submission sentinel, FIRST in the form and before any other submit.**
          While the callout shows, the primary "Save name" is unmounted, so without this the
          callout's "Save anyway" — which carries the acknowledgement — becomes the form's DEFAULT
          button, and HTML activates the default on EVERY implicit submission: Enter in the field,
          Enter on a focused control, a soft keyboard's Go, an IME confirm. A parent fixing the name
          and pressing Go would silently save the collision they were being warned about.
          It carries NO `acknowledgedDuplicate`, so it re-posts the plain rename, the server re-warns
          and nothing is written. `hidden` already removes it from the a11y tree and the tab order;
          `aria-hidden` and `tabIndex` are belt-and-braces. A DISABLED default button blocks implicit
          submission outright, which is what `disabled={pending}` buys while one is in flight.
          ⚠️ jsdom implements no implicit submission, so only the e2e can prove the behaviour — the
          unit test pins the STRUCTURE (first submit, unacknowledged). `write-path.md` invariant 4. */}
      {duplicate ? (
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} disabled={pending}>
          {ATHLETE_FORM_COPY.save}
        </button>
      ) : null}

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
          aria-describedby={describedBy}
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

      {duplicate ? (
        <Callout
          ref={calloutRef}
          messageId={duplicateMessageId}
          message={
            <>
              <span className={NAME_WRAP_CLASS}>
                {duplicate.match.archived
                  ? ATHLETE_FORM_COPY.renameDuplicateArchived(
                      duplicate.match.name,
                      PROFILE_KIND_LABELS[duplicate.match.kind],
                    )
                  : ATHLETE_FORM_COPY.renameDuplicateLive(
                      duplicate.match.name,
                      PROFILE_KIND_LABELS[duplicate.match.kind],
                    )}
              </span>
              {showDisambiguation ? (
                <>
                  {' '}
                  <span className={NAME_WRAP_CLASS}>
                    {ATHLETE_FORM_COPY.duplicateDisambiguate(duplicate.match.name)}
                  </span>
                </>
              ) : null}{' '}
              {/* 🔴 **The routes OUT, named with what they preserve.** One button is not a dead end,
                  but only if the alternatives are stated: the field is directly above, and going
                  back leaves this athlete's name exactly as it is — which is the reassuring fact a
                  parent needs and which the add form had no equivalent of. */}
              <span className={NAME_WRAP_CLASS}>
                {ATHLETE_FORM_COPY.renameDuplicateRoutes(initialName)}
              </span>
            </>
          }
        >
          {/* ONE choice, `outline`. "Save anyway" is the action that CREATES the ambiguity — the
              same class as the add form's "Add another", which U10 made secondary — so a filled
              primary as the only button on screen is what would produce the dead-end look.
              The acknowledgement rides on the SUBMITTER, so it exists only on the request this
              click produces and a stale value is impossible by construction. */}
          <Button
            type="submit"
            size="lg"
            variant="outline"
            disabled={pending}
            name="acknowledgedDuplicate"
            value={duplicate.folded}
            className={CHOICE_BUTTON_CLASS}
          >
            {ATHLETE_FORM_COPY.saveAnyway}
          </Button>
        </Callout>
      ) : null}

      <div className="flex flex-col gap-3">
        {/* `w-fit`, following the prototype (`index.html:2164`, `style="width:fit-content"`): a
            full-width primary button on a one-field form reads as the end of a long flow.
            🔴 **Hidden while the callout shows**, so "Save name" and "Save anyway" are never visible
            together — two near-identical submits is the state a parent misreads, and leaving this
            one mounted would also put it in the Enter-key path beside the sentinel. */}
        {duplicate ? null : (
          <Button type="submit" size="lg" disabled={pending} className="w-fit text-base">
            {pending ? SAVING_LABEL : ATHLETE_FORM_COPY.save}
          </Button>
        )}

        {/* Mounted in BOTH states with `message=''` until there is one — a live region that mounts
            together with its text is never announced. VISIBLE, because without JavaScript this line
            is the confirmation a sighted parent gets; with JavaScript the day page's `<h1>` is.
            ⚠️ **No `empty:hidden`, and that is the point of this comment.** It was here until
            2026-11-08, and `:empty` → `display:none` takes the region OUT of the accessibility tree
            while it is silent — so when the text arrives the region re-enters *with* its text, which
            is precisely the never-announced case the comment above describes. `announcer.tsx` rule 3
            now states it. Reserving the line also removes the layout shift the hidden version caused
            when the message appeared. */}
        <Announcer
          message={saved ? ATHLETE_FORM_COPY.saved : ''}
          className="text-muted-foreground min-h-5 text-sm"
        />

        {/* The page-level refusal — no session, rate-limited, or no such athlete. Separate from the
            field error above: there is nothing in the form to correct, so it gets a way out rather
            than an `aria-invalid` on an input that is fine. */}
        {state.error ? (
          // `tabIndex={-1}` so the effect above can move focus here: the callout has unmounted by
          // now, so there is nothing else to return to and focus would otherwise sit on `<body>`.
          <div ref={errorRef} tabIndex={-1} className="flex flex-col gap-1 outline-none">
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
