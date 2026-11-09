'use client';

import { PROFILE_KIND, PROFILE_NAME_MAX, type ProfileKind } from '@mat-plan/shared';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { addAthleteAction } from '@/app/p/profile-actions';
import { Button } from '@/components/ui/button';
import { ATHLETE_FORM_COPY, INPUT_CLASS } from '@/lib/constants';

import { INITIAL_ACTION_STATE } from '../[profileId]/action-state';

/**
 * The add-athlete form (PROF-1 a-1u) — the client island of `/p/new`.
 *
 * Colocated with its route, not in `components/` (PROF-1 D9), and **not** a parametrised
 * `AthleteForm` shared with the rename screen. `rename-form.tsx`'s own docblock names the three
 * differences in the parts that matter: it hard-wires `renameAthleteAction`, carries a hidden
 * `profileId`, and navigates from the client. This one has no `profileId`, carries a `kind` radio
 * group and a `clientId`, and navigates by a **server** `redirect(…, RedirectType.replace)`. Sharing
 * the component would mean parametrising all three. `ATHLETE_FORM_COPY` is the piece that really is
 * shared.
 *
 * ## The kind fieldset sits ABOVE the name, and that is an interaction decision
 *
 * A parent types a name and taps the phone's Go key — `enterKeyHint="go"` on a text input submits.
 * With the radios *below* the field, their first experience of this screen would be the refusal
 * "Choose Child or Adult.", because nothing is pre-checked. Putting the one-way choice first also
 * means it is the thing read before the thing under the thumb.
 *
 * ## Nothing is pre-checked, deliberately
 *
 * `kind` is set once and the app cannot change it afterwards _(maintainer, 2026-11-07)_. A default
 * radio is invisible state with no undo: a parent who never looks at the fieldset would create an
 * athlete of whichever kind we guessed. So the form refuses instead, and `ATHLETE_FORM_COPY`'s
 * `kindPermanence` states the consequence **before** the choice rather than after it.
 *
 * ## Controlled `name`, for the reason the rename form documents
 *
 * **React 19 resets an uncontrolled field when a form action settles — including on `{ ok: false }`**
 * (`docs/features/write-path.md:341`). Uncontrolled, a kind-only refusal would empty the name the
 * parent had just typed and leave them re-typing it to fix a different field.
 *
 * ## No `<Announcer>`, and no `useOnActionSuccess`
 *
 * Success here is a server `redirect`, so there is no success state to announce — the component is
 * gone by the time one could render. The only runtime message is a refusal, which is `role="alert"`
 * because it must be acted on before the form will save. ⚠️ What a screen reader hears *after* the
 * add is Next's route announcer reading the day page's title, and that page sets none — a
 * pre-existing defect recorded in `docs/tech-debt.md`, not this chunk's to fix.
 */
export function AddAthleteForm({
  clientId,
  programsAnything,
}: {
  /**
   * The idempotency key, minted **once per mount** by the server component so a double submit, a
   * replayed pre-hydration POST and a back-then-resubmit all collapse onto one athlete. Minting it
   * here in a `useState` initialiser would be a second source of truth for the same key.
   */
  clientId: string;
  /**
   * Whether this household programs anything at all. The "on the household's program" consequence is
   * only true when it does — a first-run household has no program, and `a-g`'s day page already
   * branches on exactly this boolean rather than claiming one exists.
   */
  programsAnything: boolean;
}) {
  const [state, formAction, pending] = useActionState(addAthleteAction, INITIAL_ACTION_STATE);
  const [name, setName] = useState('');
  /**
   * 🔴 **`kind` is CONTROLLED for the same reason `name` is, and the first version of this form got
   * it wrong.** React 19 resets an uncontrolled field when a form action settles — including on
   * `{ ok: false }` (`docs/features/write-path.md:341`). With the radios uncontrolled, a parent who
   * chose "Adult" and left the name blank got the name refusal **and a silently cleared kind**: the
   * one choice on this screen that feels irreversible, wiped by an error about a different field. If
   * they did not notice, their next submit earned a SECOND refusal, this time about the kind —
   * exactly the "first experience is a refusal" problem the fieldset ordering exists to prevent.
   *
   * `null` rather than a default, because nothing is pre-checked (see the docblock).
   * `e2e/athletes.spec.ts` is what caught this, by asserting the radio is still checked after a
   * name-only refusal.
   */
  const [kind, setKind] = useState<ProfileKind | null>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const kindGroupRef = useRef<HTMLDivElement>(null);

  // `useId` rather than module constants: this form is mounted once today, but ids that collide are
  // the classic cost of hard-coded ones, and `aria-describedby` below composes several.
  const uid = useId();
  const nameId = `${uid}-name`;
  const nameHintId = `${uid}-name-hint`;
  const kindHintId = `${uid}-kind-hint`;
  const errorId = `${uid}-error`;

  const nameErrors = state.fieldErrors?.name;
  const kindErrors = state.fieldErrors?.kind;
  const nameInvalid = (nameErrors?.length ?? 0) > 0;
  const kindInvalid = (kindErrors?.length ?? 0) > 0;

  useEffect(() => {
    // 🔴 **Re-assert the chosen radio after an action settles, because React 19's form reset wins
    // otherwise — and `checked` in state is not enough on its own.**
    //
    // React 19 calls `form.reset()` when a form action completes, including on `{ ok: false }`. For
    // the controlled TEXT field React re-syncs the DOM from its own value on the next commit, so the
    // typed name survives. For a radio it does NOT: React tracks `checked` separately, and when its
    // rendered value has not changed there is no patch to re-apply, so the browser's reset sticks.
    // The result was a parent who chose "Adult", left the name blank, and got the name error with
    // their kind silently cleared — then a SECOND refusal about the kind if they did not notice.
    //
    // ⚠️ **Controlling the radio was the first fix and it was insufficient** — `e2e/athletes.spec.ts`
    // stayed red through it, which is how this was found rather than assumed. The state is still the
    // source of truth; this only repairs the DOM when the reset has diverged from it.
    if (!kind) return;
    const chosen = kindGroupRef.current?.querySelector<HTMLInputElement>(`input[value="${kind}"]`);
    if (chosen && !chosen.checked) chosen.checked = true;
  }, [state, kind]);

  useEffect(() => {
    // A refusal puts focus on the input that is wrong, and `kind` is checked first because it is the
    // one a parent is most likely to have skipped. `disabled={pending}` blurs the submit button when
    // it disables, so without this focus sits on `<body>` when the alert renders and the next Tab
    // starts from the top of the document, past the error. The rename form's effect, generalised.
    if (kindInvalid) firstRadioRef.current?.focus();
  }, [state, kindInvalid]);

  /**
   * ⚠️ **44px belongs on the LABEL, not the input.** `INPUT_CLASS` is for the name field: on an
   * `<input type="radio">` its `h-11 px-3 border` yields a 44px-tall, 13px-wide bordered dot. The
   * theme toggle sets the precedent — the tappable thing is the label, so the label carries the
   * height.
   *
   * 🔴 **`flex-wrap` + `min-w-32`, never `grid-cols-2`.** Two fixed tracks need ≈384px at 200% text
   * against 328px usable at 360px, and the page scrolls sideways. Wrapping stacks them instead.
   */
  const kindLabelClass =
    'border-input bg-background has-checked:border-foreground has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-3 flex min-h-11 min-w-32 flex-1 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-base';

  const kindOptions = [
    { value: PROFILE_KIND.kid, label: 'Child', consequence: ATHLETE_FORM_COPY.kidConsequence },
    { value: PROFILE_KIND.adult, label: 'Adult', consequence: ATHLETE_FORM_COPY.adultConsequence },
  ] as const;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* Hidden, server-minted, and `readOnly` so React does not treat it as an uncontrolled input
          it should reset. A malformed or missing value is a PAGE-level refusal, never a field error:
          there is nothing here for a person to correct. */}
      <input type="hidden" name="clientId" value={clientId} readOnly />

      {/* 🔴 **`role="radiogroup"` + `aria-invalid` on the FIELDSET, never on the radios.**
          `aria-invalid` is not a supported attribute of `role="radio"` — a single radio is not
          individually valid or invalid; the GROUP is. `eslint-plugin-jsx-a11y`'s
          `role-supports-aria-props` caught it on this file's first draft. A `<fieldset>` carries no
          implicit radiogroup role, so the role is declared to give the attribute something to attach
          to, and `aria-describedby` on the group carries the hint and the error. */}
      <fieldset
        role="radiogroup"
        aria-invalid={kindInvalid || undefined}
        aria-describedby={`${kindHintId}${kindInvalid ? ` ${errorId}` : ''}`}
        className="flex flex-col gap-2"
      >
        <legend className="text-sm font-medium">{ATHLETE_FORM_COPY.legend}</legend>

        {/* The permanence, before the choice. `text-foreground` not muted: it is the one sentence on
            this screen a parent must read, and the muted token sits on the AA floor at 4.74:1. */}
        <p id={kindHintId} className="max-w-prose text-sm">
          {ATHLETE_FORM_COPY.kindPermanence}
        </p>

        <div ref={kindGroupRef} className="flex flex-wrap gap-2">
          {kindOptions.map((option, i) => (
            <label
              key={option.value}
              // A plain conditional class, not an `aria-invalid:` variant: the attribute lives on the
              // group above, and a `<label>` is not a form control that could carry it anyway.
              className={`${kindLabelClass}${kindInvalid ? ' border-destructive' : ''}`}
            >
              <input
                ref={i === 0 ? firstRadioRef : undefined}
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="size-4 shrink-0"
              />
              <span>
                {option.label}
                {/* The consequence rides beside its OWN option, not in a paragraph under both — a
                    parent choosing between two things needs the difference at the point of choice.
                    ⚠️ The program clause renders only when the household actually programs
                    something; claiming a program a first-run household has not got would be false. */}
                {option.value === PROFILE_KIND.kid && !programsAnything ? null : (
                  <span className="text-muted-foreground"> — {option.consequence}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor={nameId} className="text-sm font-medium">
          {ATHLETE_FORM_COPY.nameLabel}
        </label>
        <p id={nameHintId} className="text-muted-foreground text-sm">
          {ATHLETE_FORM_COPY.nameHint}
        </p>
        {/* The phone-keyboard attributes are the rename form's, for the reasons its comment gives:
            `autoCapitalize="words"` (a name is capitalised per word), `autoComplete="off"` (a name
            field is otherwise offered the DEVICE OWNER's name, which on a shared family phone is the
            wrong person), `spellCheck={false}` (every name is a misspelling to a dictionary), and
            `enterKeyHint="go"` because the return key submits. `w-full` because `INPUT_CLASS`
            carries no width. */}
        <input
          id={nameId}
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
          aria-invalid={nameInvalid || undefined}
          aria-describedby={`${nameHintId}${nameInvalid ? ` ${errorId}` : ''}`}
          className={`${INPUT_CLASS} w-full`}
        />
      </div>

      {/* ONE alert for both fields, whose id joins each input's `aria-describedby`. Two regions would
          mean a screen-reader user hearing one and having to hunt for the other; the action returns
          at most one field's errors per submit in practice, and joining the messages keeps the
          reading order the same as the visual one. */}
      {nameInvalid || kindInvalid ? (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {[...(kindErrors ?? []), ...(nameErrors ?? [])].join(' ')}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {/* `w-fit`, as on the rename form: a full-width primary button reads as the end of a long
            flow, and this is two questions. */}
        <Button type="submit" size="lg" disabled={pending} className="w-fit text-base">
          {pending ? ATHLETE_FORM_COPY.adding : ATHLETE_FORM_COPY.add}
        </Button>

        {/* The page-level refusal — no session, rate-limited, a spent `clientId`, or the household at
            its cap. There is nothing in the form to correct, so it gets no `aria-invalid`; the way
            out is the page's own "← All athletes" link, already above this form. */}
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
