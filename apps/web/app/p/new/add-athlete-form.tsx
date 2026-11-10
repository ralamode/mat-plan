'use client';

import {
  collapseWhitespace,
  foldName,
  PROFILE_KIND,
  PROFILE_KIND_LABELS,
  PROFILE_NAME_MAX,
  type ProfileKind,
} from '@mat-plan/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { addAthleteAction, restoreAthleteAction } from '@/app/p/profile-actions';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import {
  athletePath,
  ATHLETE_FORM_COPY,
  HOUSEHOLD_FULL,
  INPUT_CLASS,
  NAME_WRAP_CLASS,
} from '@/lib/constants';

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
  /**
   * **Seeded from the envelope, so this form's duplicate answer no longer depends on client state.**
   * A `useState` initializer runs on MOUNT alone, so after an ordinary JS submit it is a no-op — the
   * island never unmounted — and the stale-callout rule below is untouched. Where it does something
   * is a render that mounts fresh with an answer already in `state`: without the name, the callout is
   * discarded by its own fold gate (`foldName('') !== folded`), and without the kind "Add another"
   * would come back refused for a missing radio. Every OTHER refusal on this form renders from
   * `state` alone; the duplicate was the one that did not.
   *
   * ⚠️ **UNPROVEN, and deliberately so rather than quietly.** The scenario is a JS-less or
   * pre-hydration submit, and this harness cannot drive one: in a `javaScriptEnabled: false` context
   * `page.url()` answers while `locator.count()` returns 0 and `innerText()` 32 characters — both of
   * those need Playwright's injected script, which such a context cannot run, so it cannot tell "the
   * page rendered nothing" from "the harness cannot see the page". A test was written and is NOT
   * shipped; `docs/tech-debt.md` records the measurement so the next attempt starts there. What IS
   * tested is the data: `profile-actions.test.ts` pins the whole envelope shape, including these two
   * fields. The same reasoning the plan already sanctions for `excludeClientId` — keep the code the
   * argument justifies, ship no proof that cannot fail.
   */
  const [name, setName] = useState(state.duplicate?.typed ?? '');
  /** `null`, not a default — nothing is pre-checked. Drives `defaultChecked`; see the docblock. */
  const [kind, setKind] = useState<ProfileKind | null>(state.duplicate?.chosenKind ?? null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  /**
   * Which athlete the last Restore was attempted for. ⚠️ **Scoping the error to "an archived match"
   * was not enough** — `restoreState` persists in `useActionState`, so a failure for Zoë then showed
   * "Couldn't restore Bea" over a DIFFERENT archived callout, about an attempt never made.
   *
   * 🔴 **STATE, not a ref**, and lint caught the first version reading a ref during render. A ref
   * does not re-render, so the error could render against a stale id — the exact class of bug this
   * value exists to prevent.
   */
  const [restoreAttemptedFor, setRestoreAttemptedFor] = useState<string | null>(null);
  const router = useRouter();

  /**
   * Restore is a SECOND action, in a sibling `<form>` — a `<form>` cannot nest, and
   * `restoreAthleteAction` returns `{ ok, savedId }` without redirecting, so the navigation is ours.
   */
  const [restoreState, restoreAction, restorePending] = useActionState(
    restoreAthleteAction,
    INITIAL_ACTION_STATE,
  );

  const uid = useId();
  const nameId = `${uid}-name`;
  const nameHintId = `${uid}-name-hint`;
  const kindHintId = `${uid}-kind-hint`;
  const kindErrorId = `${uid}-kind-error`;
  const nameErrorId = `${uid}-name-error`;
  const duplicateMessageId = `${uid}-duplicate`;
  const restoreFormId = `${uid}-restore`;

  /**
   * 🔴 **The callout is shown only while the typed name still FOLDS to what it was issued for.**
   * `state` persists in `useActionState` until the next submit, so editing "Sam" to "Samuel" would
   * otherwise leave a warning about Sam hanging over a field reading Samuel. This is also what makes
   * the Enter key safe (see the submit button): a warning the parent can act on by pressing Return
   * is always one that currently applies to what is in the field.
   */
  const duplicate =
    state.duplicate && foldName(name) === state.duplicate.folded ? state.duplicate : null;

  const matchKindLabel = duplicate ? PROFILE_KIND_LABELS[duplicate.match.kind] : '';
  /**
   * 🔴 **"Both will show as X" is only TRUE when the two names are spelled identically.** The fold is
   * lossy, so a live match can be `José` against a typed `Jose` — which render as two different
   * tiles. Saying they will look the same would be false in exactly the false-positive case the
   * hedged copy exists for, and would nudge a parent into disambiguating names that already differ.
   * Kinds must agree too: a tile shows name AND kind, so a Child and an Adult are already distinct.
   */
  const showDisambiguation = Boolean(
    duplicate &&
    !duplicate.match.archived &&
    // ⚠️ **`collapseWhitespace`, not `trim()` alone.** `athleteNameSchema` stores the name COLLAPSED
    // as well as trimmed, so a typed "Ada  B" (two spaces) against a stored "Ada B" is the same
    // record and really would render two identical tiles — while a bare `trim()` reads them as
    // different spellings and drops advice that is true. Same helper the schema uses, so the two
    // cannot drift.
    collapseWhitespace(name.trim()) === duplicate.match.name &&
    kind === duplicate.match.kind,
  );
  const chosenKindLabel = kind ? PROFILE_KIND_LABELS[kind] : '';
  /**
   * 🔴 **The archived twin's kind versus the one just chosen.** This screen's own recovery copy tells
   * a parent who picked the wrong kind to archive and add again — so they come back, choose the
   * CORRECTED kind, and meeting them with "Restore" as the primary would hand back the wrong kind,
   * permanently. When the kinds differ neither choice is primary and the callout says why.
   */
  const kindsDiffer = Boolean(duplicate?.match.archived && kind && duplicate.match.kind !== kind);

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
    // the next Tab would start at the top of the document, past the error. The first version handled
    // only the kind case, so a name-only refusal dropped focus — the exact defect this comment
    // claimed to prevent, caught independently by two lenses.
    //
    // Kind first when both are wrong: it is the choice a parent is likelier to have skipped, and it
    // is the field above.
    //
    // 🔴 **Read from `state.fieldErrors`, and depend on `state` ALONE.** Keying this on the derived
    // `kindInvalid` meant that choosing a kind while BOTH fields were wrong flipped it false,
    // re-ran the effect, and **stole focus to the name field mid-interaction** — so a keyboard user's
    // first arrow key threw them out of the radio group they were comparing options in. A refusal is
    // an event, not a condition: `state` is a fresh object per submit, so this runs once per
    // *answer from the server* and never on a keystroke.
    const kindWrong = (state.fieldErrors?.kind?.length ?? 0) > 0;
    const nameWrong = (state.fieldErrors?.name?.length ?? 0) > 0;
    // 🔴 **A duplicate is ANNOUNCED BY FOCUS**, which is also what scrolls it into view. On a 360x640
    // phone the submit already sits near the fold before any callout exists, and `enterKeyHint="go"`
    // invites a soft keyboard over the rest — so a parent could tap Add and see nothing change.
    // `aria-describedby` would not help: it is read on focus, and `disabled={pending}` has already
    // blurred the submit to `<body>`. No `role="alert"` on top of this; the two would double-announce.
    if (state.duplicate) calloutRef.current?.focus();
    else if (kindWrong) firstRadioRef.current?.focus();
    else if (nameWrong) nameRef.current?.focus();
  }, [state]);

  useEffect(() => {
    // Restore succeeded: open the athlete, the rename form's idiom. `replace` so Back does not
    // return to a form that is now about somebody who exists.
    if (restoreState.ok && restoreState.savedId) router.replace(athletePath(restoreState.savedId));
    // 🔴 **And the FAILURE path, which dropped focus to `<body>`.** `disabled={restorePending}`
    // blurs the Restore button the moment it is clicked — the same mechanism this file documents for
    // the primary submit — so when the action answers `{ ok: false }` the `role="alert"` is heard but
    // the keyboard position is gone, and the next Tab starts above the page header. Returning focus
    // to the callout puts the user back beside the choices, including the Restore they can retry.
    else if (restoreState.error) calloutRef.current?.focus();
  }, [restoreState, router]);

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

  /**
   * The callout's choices, as ONE element rather than three near-copies.
   *
   * 🔴 **Both review lenses found the same bug in the three-copy version**: the live branch guarded
   * `atCap` and the archived branch did not, so a full household was offered "Add another" — a button
   * `createProfile` answers `full` to. And the archived copy omitted `NAME_WRAP_CLASS`, so a
   * 40-character name with no break opportunity pushed the page sideways at 360px. One definition
   * makes both impossible to get wrong in one branch only.
   *
   * ⚠️ Returns `null` at the cap. Adding is the only thing the quota refuses — Restore needs no slot,
   * which is why the duplicate check runs before the quota at all.
   */
  const addAnotherButton = (label: string) =>
    duplicate && duplicate.atCap ? null : (
      <Button
        type="submit"
        size="lg"
        variant="outline"
        name="acknowledgedDuplicate"
        value={duplicate?.folded ?? ''}
        disabled={pending || restorePending}
        className="h-auto w-full min-w-0 py-2.5 text-left text-base whitespace-normal"
      >
        <span className={NAME_WRAP_CLASS}>{label}</span>
      </Button>
    );

  return (
    <>
      {/* 🔴 **A SIBLING form, not a nested one** — HTML forbids nesting, and the Restore button inside
          the callout reaches it by `form={restoreFormId}`. `restoreAthleteAction` returns
          `{ ok, savedId }` and does NOT redirect, so the navigation is the effect above. Rendered
          only when there is an archived match to restore, so the add form is never shadowed by an
          empty second form. */}
      {duplicate?.match.archived ? (
        <form id={restoreFormId} action={restoreAction} className="hidden">
          <input type="hidden" name="profileId" value={duplicate.match.publicId} readOnly />
        </form>
      ) : null}

      <form action={formAction} className="flex flex-col gap-6">
        {/* Server-minted and `readOnly`. A malformed or missing value is a PAGE-level refusal, never a
          field error: there is nothing here for a person to correct. */}
        <input type="hidden" name="clientId" value={clientId} readOnly />

        {/* 🔴 **The implicit-submission sentinel, and it must be FIRST IN TREE ORDER.** A form's
          default button is the first submit button in document order — visible or not — and every
          implicit submission activates it: Enter on the name field, Enter on a focused RADIO, a soft
          keyboard's Go, an IME confirm. While the callout shows, the only other submits are its
          choices, which carry `acknowledgedDuplicate`; without this, pressing Enter anywhere would
          silently acknowledge the warning and create the second athlete.
          ⚠️ **A per-element `onKeyDown` guard is not enough** — it covers the one element it is
          attached to, and a reviewer probed Enter on a focused radio in Chromium slipping past it.
          This absorbs every entry point at once: the re-post carries no acknowledgement, the server
          answers `duplicate` again with no write, and the `[state]` effect re-focuses the callout.
          `hidden` + `aria-hidden` + `tabIndex={-1}`: inert to sight, screen readers and Tab, while
          still being the default. */}
        {duplicate ? (
          <button
            type="submit"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            // ⚠️ Disabled while either action is in flight, which the visible primary it replaces did
            // too. A disabled default button blocks implicit submission outright, so Enter during the
            // pending window cannot queue a second action behind the first.
            disabled={pending || restorePending}
          >
            {ATHLETE_FORM_COPY.add}
          </button>
        ) : null}

        {/* 🔴 `role="radiogroup"` + `aria-invalid` on the FIELDSET, never on the radios. `aria-invalid`
          is not a supported attribute of `role="radio"` — one radio is not individually valid or
          invalid, the group is. `jsx-a11y/role-supports-aria-props` caught that on the first draft.
          A `<fieldset>` carries no implicit radiogroup role, so it is declared to give the attribute
          something to attach to. */}
        <fieldset
          role="radiogroup"
          aria-invalid={kindInvalid || undefined}
          // Appended only in the KINDS-DIFFER case, where the message is about this control: it
          // reads "…saved as Adult … You chose Child", and switching the radio rewrites both the
          // sentence and the buttons with no announcement of its own. When the kinds agree the
          // message is about the name, so adding it here would repeat it on the wrong control.
          aria-describedby={`${kindHintId}${kindInvalid ? ` ${kindErrorId}` : ''}${
            duplicate && kindsDiffer ? ` ${duplicateMessageId}` : ''
          }`}
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
            // 🔴 **The duplicate message is appended here, not merely rendered below.** A screen
            // reader announces the callout once, on the programmatic focus move; a parent who then
            // Shift+Tabs back into this field to change the spelling — which is exactly what the
            // disambiguation advice asks them to do — would otherwise hear only the hint and nothing
            // about the warning they are responding to. ⚠️ The plan accepted this at C6 and it was
            // NOT shipped: `duplicateMessageId` existed and reached only the Callout, while the
            // plan, the component's docblock and `callout.test.tsx` all described a wiring no
            // element had. Found by a third review pass.
            aria-describedby={`${nameHintId}${nameInvalid ? ` ${nameErrorId}` : ''}${
              duplicate ? ` ${duplicateMessageId}` : ''
            }`}
            className={`${INPUT_CLASS} w-full`}
          />
          {nameInvalid ? (
            <p id={nameErrorId} role="alert" className="text-destructive text-sm">
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
                    ? ATHLETE_FORM_COPY.duplicateArchived(duplicate.match.name, matchKindLabel)
                    : ATHLETE_FORM_COPY.duplicateLive(duplicate.match.name, matchKindLabel)}
                </span>
                {/* The Restore benefit, only when the kinds AGREE — see the copy's docblock. With
                  them differing it would recommend Restore in the sentence before the one saying
                  Restore is permanent and wrong. */}
                {duplicate.match.archived && !kindsDiffer ? (
                  <> {ATHLETE_FORM_COPY.duplicateArchivedRestoreNote}</>
                ) : null}
                {kindsDiffer ? (
                  <>
                    {' '}
                    <span className={NAME_WRAP_CLASS}>
                      {ATHLETE_FORM_COPY.duplicateArchivedOtherKind(
                        duplicate.match.name,
                        matchKindLabel,
                        chosenKindLabel,
                      )}
                    </span>
                  </>
                ) : null}
                {showDisambiguation ? (
                  <>
                    {' '}
                    <span className={NAME_WRAP_CLASS}>
                      {ATHLETE_FORM_COPY.duplicateDisambiguate(duplicate.match.name)}
                    </span>
                  </>
                ) : null}
                {/* 🔴 **At the cap, say why the choice is missing.** `addAnotherButton` returns
                  `null` when `atCap`, and without this the parent of two genuinely different Adas
                  reads "…who is already on your list", sees one button, and is given no reason and
                  no route. The action answers this path with `error: null` — it is a duplicate
                  envelope, not a refusal — so `HOUSEHOLD_FULL` never rendered anywhere. Reusing that
                  constant keeps one sentence for the cap across the whole app. */}
                {duplicate.atCap ? <> {HOUSEHOLD_FULL}</> : null}
              </>
            }
          >
            {/* 🔴 Choices STACK full-width. `Button` is `whitespace-nowrap`, so "Add another " plus a
              40-character name is ~364px against ~296px of callout at 360px — it overflows, and two
              side-by-side buttons break above ~12 characters. `h-auto whitespace-normal text-left`
              lets the label wrap instead. */}
            {duplicate.match.archived ? (
              <>
                <Button
                  type="submit"
                  size="lg"
                  variant={kindsDiffer ? 'outline' : 'default'}
                  disabled={pending || restorePending}
                  form={restoreFormId}
                  onClick={() => setRestoreAttemptedFor(duplicate.match.publicId)}
                  className="h-auto w-full min-w-0 py-2.5 text-left text-base whitespace-normal"
                >
                  <span className={NAME_WRAP_CLASS}>
                    {ATHLETE_FORM_COPY.restoreMatch(duplicate.match.name)}
                  </span>
                </Button>
                {/* The acknowledgement rides on the SUBMITTER, so it exists only on the request this
                  click produced — a stale value is impossible by construction. */}
                {addAnotherButton(
                  kindsDiffer
                    ? ATHLETE_FORM_COPY.addNewInstead(
                        name.trim() || duplicate.match.name,
                        chosenKindLabel,
                      )
                    : ATHLETE_FORM_COPY.addAnother(name.trim() || duplicate.match.name),
                )}
              </>
            ) : (
              <>
                {/* "Open" is a LINK, and it needs an explicit `min-h-11`: `a11y.spec.ts`'s tap scan is
                  `button, [role="button"], select, textarea, input`, so a bare `<a>` is never
                  measured by CI. */}
                <Link
                  href={athletePath(duplicate.match.publicId)}
                  className="border-input hover:bg-accent focus-visible:ring-ring flex min-h-11 w-full items-center rounded-lg border px-3 py-2.5 text-left text-base font-medium outline-none focus-visible:ring-3"
                >
                  <span className={NAME_WRAP_CLASS}>
                    {ATHLETE_FORM_COPY.openMatch(duplicate.match.name)}
                  </span>
                </Link>
                {/* ⚠️ Hidden at the cap: `createProfile` checks duplicates BEFORE the quota so an
                  archived twin stays restorable by a full household — which means this warning can
                  reach one. Offering "Add another" there would be a button the endpoint rejects. */}
                {addAnotherButton(
                  ATHLETE_FORM_COPY.addAnother(name.trim() || duplicate.match.name),
                )}
              </>
            )}
            {restoreState.error && restoreAttemptedFor === duplicate.match.publicId ? (
              <p role="alert" className="text-destructive text-sm">
                {ATHLETE_FORM_COPY.restoreFailed(duplicate.match.name)}
              </p>
            ) : null}
          </Callout>
        ) : null}

        <div className="flex flex-col gap-3">
          {/* `w-fit`, as on the rename form: a full-width primary button reads as the end of a long
            flow, and this is two questions.
            🔴 **Hidden while a duplicate is showing**, so the callout's choices are the only submit
            buttons on the form. Two near-identical "add" buttons visible together is the state a
            parent misreads, and leaving this one here would also make it the Enter-key default
            while the callout sits above it. */}
          {/* `w-fit`, as on the rename form: a full-width primary button reads as the end of a long
            flow, and this is two questions. Hidden while the callout shows, so two near-identical
            add buttons are never visible together — the DEFAULT-submit role is held by the sentinel
            at the top of the form, not by this one. */}
          {duplicate ? null : (
            <Button type="submit" size="lg" disabled={pending} className="w-fit text-base">
              {pending ? ATHLETE_FORM_COPY.adding : ATHLETE_FORM_COPY.add}
            </Button>
          )}

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
    </>
  );
}
