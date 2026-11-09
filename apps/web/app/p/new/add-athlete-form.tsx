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
 * Colocated with its route (PROF-1 D9), and **not** a parametrised `AthleteForm` shared with the
 * rename screen: `rename-form.tsx`'s docblock names the three differences in the parts that matter
 * (it hard-wires `renameAthleteAction`, carries a hidden `profileId`, and navigates from the client;
 * this has no `profileId`, carries a `kind` radio group and a `clientId`, and navigates by a SERVER
 * `redirect`). `ATHLETE_FORM_COPY` is the piece that really is shared.
 *
 * ## The kind fieldset sits ABOVE the name
 *
 * A text field in a `<form>` submits on the return key — `enterKeyHint="go"` only labels the key. So
 * with the radios below the name, a parent would type a name, reach for Go, and be told about a
 * control they had not scrolled to. Putting the one-way choice first also means it is read before
 * the thing under the thumb.
 *
 * ## Nothing is pre-checked
 *
 * `kind` is set once and the app cannot change it afterwards _(maintainer, 2026-11-07)_. A default
 * radio is invisible state with no undo: a parent who never looked at the fieldset would create an
 * athlete of whichever kind we guessed. The form refuses instead, and the permanence is stated
 * **before** the choice rather than discovered after it.
 *
 * ## 🔴 Both fields survive a refusal, and the radio needed a DIFFERENT fix from the text input
 *
 * **React 19 resets fields in a `<form action>` when the action settles, including on
 * `{ ok: false }`** — `write-path.md` → "Traps", the ⚠️ bullet on uncontrolled fields. The guide
 * already records that *controlling a `<select>` is not enough*, because the reset is a native
 * `form.reset()` and React keeps a controlled input's `value` attribute in sync but never a select's
 * `defaultSelected`. **A radio is the same family:** React freezes a controlled radio's
 * `defaultChecked` at mount, so `form.reset()` returns it to unchecked no matter what `checked` says.
 *
 * So `name` is controlled (its `value` attribute is synced, so it survives), and `kind` uses
 * **`defaultChecked` driven by state** — which React updates in the same mutation phase, before the
 * reset reads it. Probed, three ways:
 *
 * | radio written as                        | after a refusal settles |
 * | --------------------------------------- | ----------------------- |
 * | `checked={kind === v}`                  | ❌ unchecked — wiped     |
 * | `defaultChecked={kind === v}`           | ✅ still checked         |
 * | `checked` + a `useEffect` re-assert     | ✅ (what this file did first) |
 *
 * ⚠️ **The effect version worked and was still the wrong fix** — it poked `.checked` on the DOM after
 * React had committed, which paints one frame of unchecked radios and fights the renderer for no
 * gain. `defaultChecked` is the whole fix. What found the bug in the first place was
 * `e2e/athletes.spec.ts`, which stayed red through *controlling* the radio.
 *
 * ## No `<Announcer>`, and no `useOnActionSuccess`
 *
 * Success is a server `redirect`, so there is no success state to announce — this component is gone
 * before one could render. The only runtime messages are refusals, which are `role="alert"` because
 * they must be acted on before the form will save.
 */
export function AddAthleteForm({
  clientId,
  programsAnything,
}: {
  /**
   * The idempotency key, minted by the server **once per request**, so a double tap and a retry after
   * a refusal collapse onto one athlete. `page.tsx` explains why per-request is the right
   * granularity and what each case does.
   */
  clientId: string;
  /**
   * Whether this household programs anything at all. It selects the WORDING of the child
   * consequence, never whether one is shown — a first-run household has no program, and claiming one
   * would be false, but hiding the line made the two options non-parallel.
   */
  programsAnything: boolean;
}) {
  const [state, formAction, pending] = useActionState(addAthleteAction, INITIAL_ACTION_STATE);
  const [name, setName] = useState('');
  /** `null`, not a default — nothing is pre-checked. Drives `defaultChecked`; see the docblock. */
  const [kind, setKind] = useState<ProfileKind | null>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const uid = useId();
  const nameId = `${uid}-name`;
  const nameHintId = `${uid}-name-hint`;
  const kindHintId = `${uid}-kind-hint`;
  const kindErrorId = `${uid}-kind-error`;
  const nameErrorId = `${uid}-name-error`;

  const nameErrors = state.fieldErrors?.name;
  const kindErrors = state.fieldErrors?.kind;
  const nameInvalid = (nameErrors?.length ?? 0) > 0;
  // A kind error is cleared the moment a kind is chosen. Derived purely from `state`, the alert and
  // the red border would persist while the parent looked at a choice they had already fixed, until
  // the next submit told them so.
  const kindInvalid = (kindErrors?.length ?? 0) > 0 && kind === null;

  useEffect(() => {
    // 🔴 **Focus the input that is WRONG — both of them, not just the radios.** `disabled={pending}`
    // blurs the submit button when it disables, so focus is on `<body>` by the time an alert renders:
    // the next Tab would start at the top of the document, past the error. The first version of this
    // effect handled only the kind case, so a name-only refusal dropped focus — which is the exact
    // defect this comment claimed to prevent, and two lenses caught the gap independently.
    //
    // Kind first when both are wrong: it is the choice a parent is likelier to have skipped, and it
    // is the field above. Keyed on `state` identity, so a second refusal re-focuses.
    if (kindInvalid) firstRadioRef.current?.focus();
    else if (nameInvalid) nameRef.current?.focus();
  }, [state, kindInvalid, nameInvalid]);

  /**
   * ⚠️ **44px belongs on the LABEL, not the input.** `INPUT_CLASS` is for the name field: on an
   * `<input type="radio">` its `h-11 px-3 border` yields a 44px-tall, 13px-wide bordered dot. The
   * theme toggle sets the precedent — the tappable thing is the label, so the label carries it.
   *
   * 🔴 **ONE COLUMN, not two.** The first version was `flex-wrap` with `min-w-32 flex-1`, which a UX
   * lens measured: at 360px two labels fit (128+8+128 = 264 < 328), so they never wrapped and `flex-1`
   * grew them to 160px each — leaving a ~108px text column in which "trains on the household's
   * program" breaks over four lines. The wrap only engaged at 200% text, so the responsive path was
   * effectively dead code at the width that matters. A full-width row per option gives the
   * decision-critical text the whole column.
   */
  const kindLabelClass =
    'border-input bg-background has-checked:border-foreground has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-3 flex min-h-11 w-full cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-base';

  const kindOptions = [
    {
      value: PROFILE_KIND.kid,
      label: 'Child',
      // Branches the WORDING, never whether a consequence appears — see the prop's docblock.
      consequence: programsAnything
        ? ATHLETE_FORM_COPY.kidWithProgram
        : ATHLETE_FORM_COPY.kidFirstRun,
    },
    {
      value: PROFILE_KIND.adult,
      label: 'Adult',
      consequence: ATHLETE_FORM_COPY.adultConsequence,
    },
  ] as const;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* Server-minted and `readOnly`. A malformed or missing value is a PAGE-level refusal, never a
          field error: there is nothing here for a person to correct. */}
      <input type="hidden" name="clientId" value={clientId} readOnly />

      {/* 🔴 `role="radiogroup"` + `aria-invalid` on the FIELDSET, never on the radios. `aria-invalid`
          is not a supported attribute of `role="radio"` — one radio is not individually valid or
          invalid, the group is. `jsx-a11y/role-supports-aria-props` caught that on the first draft.
          A `<fieldset>` carries no implicit radiogroup role, so it is declared to give the attribute
          something to attach to. */}
      <fieldset
        role="radiogroup"
        aria-invalid={kindInvalid || undefined}
        aria-describedby={`${kindHintId}${kindInvalid ? ` ${kindErrorId}` : ''}`}
        className="flex flex-col gap-2"
      >
        <legend className="text-sm font-medium">{ATHLETE_FORM_COPY.legend}</legend>

        {/* The permanence, before the choice. `text-foreground`, not muted: it is the one sentence on
            this screen a parent must read, and the muted token sits on the AA floor at 4.74:1.
            ⚠️ The RECOVERY is not here — it is role-branched on the page, because only an owner can
            archive and a member read a contradiction two inches below. */}
        <p id={kindHintId} className="max-w-prose text-sm">
          {ATHLETE_FORM_COPY.kindPermanence}
        </p>

        <div className="flex flex-col gap-2">
          {kindOptions.map((option, i) => (
            <label key={option.value} className={kindLabelClass}>
              <input
                ref={i === 0 ? firstRadioRef : undefined}
                type="radio"
                name="kind"
                value={option.value}
                // `defaultChecked`, NOT `checked` — the docblock's table says why. State is still the
                // source of truth; this is the attribute React keeps in sync for a radio.
                defaultChecked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="mt-1 size-4 shrink-0"
              />
              <span className="flex flex-col">
                <span className="font-medium">{option.label}</span>
                {/* The consequence on its OWN line, full-contrast, and present for BOTH options.
                    It is the only fact that separates them, so it is not muted fine print. */}
                <span className="text-sm">{option.consequence}</span>
              </span>
            </label>
          ))}
        </div>

        {/* The kind error sits with the kind, not 250px below beside the name. Both alerts are
            per-field: one shared region cross-wired each input's `aria-describedby` to the other
            field's message, so a screen-reader user on the name heard the kind error too. */}
        {kindInvalid ? (
          <p id={kindErrorId} role="alert" className="text-destructive text-sm">
            {kindErrors!.join(' ')}
          </p>
        ) : null}
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
            field is otherwise offered the DEVICE OWNER's name, wrong on a shared family phone),
            `spellCheck={false}` (every name is a misspelling to a dictionary), `enterKeyHint="go"`
            because the return key submits. `w-full` because `INPUT_CLASS` carries no width. */}
        <input
          ref={nameRef}
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
          aria-describedby={`${nameHintId}${nameInvalid ? ` ${nameErrorId}` : ''}`}
          className={`${INPUT_CLASS} w-full`}
        />
        {nameInvalid ? (
          <p id={nameErrorId} role="alert" className="text-destructive text-sm">
            {nameErrors!.join(' ')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {/* `w-fit`, as on the rename form: a full-width primary button reads as the end of a long
            flow, and this is two questions. */}
        <Button type="submit" size="lg" disabled={pending} className="w-fit text-base">
          {pending ? ATHLETE_FORM_COPY.adding : ATHLETE_FORM_COPY.add}
        </Button>

        {/* The page-level refusal — no session, rate-limited, a spent `clientId`, or the household at
            its cap. Nothing in the form is wrong, so no `aria-invalid`; the way out is the page's
            "← All athletes" link, which is in the header ABOVE this form. */}
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
