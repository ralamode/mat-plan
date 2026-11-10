// @vitest-environment jsdom
import { foldName, PROFILE_KIND, PROFILE_NAME_MAX, type ProfileKind } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form imports a `'use server'` module, which cannot be evaluated under jsdom. Mocked here —
// this file is about what the FORM does; the action's own boundary tests live in
// `profile-actions.test.ts` and the household matrix in `[profileId]/actions.test.ts`.
vi.mock('@/app/p/profile-actions', () => ({
  addAthleteAction: vi.fn(),
  restoreAthleteAction: vi.fn(),
}));

// The form calls `useRouter()` to open an athlete after a Restore (PROF-1 a-1d). jsdom mounts no
// app router, so without this every test in the file dies at render with "invariant expected app
// router to be mounted" — a missing test seam, not a defect in the component.
const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { athletePath, ATHLETE_FORM_COPY, HOUSEHOLD_FULL } from '@/lib/constants';

import { addAthleteAction, restoreAthleteAction } from '@/app/p/profile-actions';

import { AddAthleteForm } from './add-athlete-form';

afterEach(cleanup);

const CLIENT_ID = '019826b4-0000-7000-8000-0000000000c1';

const renderForm = (programsAnything = true) =>
  render(<AddAthleteForm clientId={CLIENT_ID} programsAnything={programsAnything} />);

const radios = () => screen.getAllByRole('radio') as HTMLInputElement[];
const nameField = () => screen.getByLabelText(ATHLETE_FORM_COPY.nameLabel) as HTMLInputElement;

/**
 * COMPONENT TIER (RTL/jsdom). This file exists for the decisions a reader cannot verify anywhere
 * else: the ones the UX panel made about this screen, which live in markup rather than in logic.
 *
 * ⚠️ **An earlier version of this docblock claimed the refusal path "cannot be injected" here. That
 * was false**, and it mattered: it excused the file from covering the one defect this chunk exists
 * to have fixed. The mocked action can simply RESOLVE a refusal, and `submitExpecting` below drives
 * it. A reviewer found the excuse before a reader did.
 *
 * **What it genuinely cannot see:** 200% text and the 360px geometry — nothing in the suite zooms,
 * so those are a hand check plus `e2e`'s overflow assertions.
 */
describe('AddAthleteForm (PROF-1 a-1u)', () => {
  it('pre-checks NOTHING — kind is set once and a default would be invisible state', () => {
    renderForm();
    // 🔴 The decision this asserts: `kind` cannot be changed after the add _(maintainer,
    // 2026-11-07)_, so a default radio would create an athlete of whichever kind we guessed for a
    // parent who never looked at the fieldset. The form refuses instead.
    expect(radios()).toHaveLength(2);
    expect(radios().some((r) => r.checked)).toBe(false);
  });

  it('puts the kind fieldset BEFORE the name field in the document', () => {
    renderForm();
    // The interaction reason: `enterKeyHint="go"` means the return key submits, so with the radios
    // after the name a parent's first experience of this screen would be the refusal. Asserted on
    // DOCUMENT ORDER, which is what both a screen reader and the tab sequence follow.
    const position = radios()[0]!.compareDocumentPosition(nameField());
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('states the permanence BEFORE the choice, and leaves the recovery to the page', () => {
    renderForm();
    const hint = screen.getByText(ATHLETE_FORM_COPY.kindPermanence);
    // Before, not after: a one-way door explained underneath the control is explained too late.
    expect(
      hint.compareDocumentPosition(radios()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // 🔴 **The recovery is NOT in this sentence, and this assertion is the INVERSE of what it was.**
    // It read "…If it's wrong, archive them in Household settings and add them again" — which a
    // MEMBER saw on a page that says two inches lower that only the owner can archive. The recovery
    // is now role-branched on the page, so the form must not carry an unbranched copy of it.
    expect(ATHLETE_FORM_COPY.kindPermanence).not.toMatch(/archiv/i);
    expect(screen.queryByText(/archiv/i)).toBeNull();
  });

  it('the radio group carries the ARIA, not the individual radios', () => {
    renderForm();
    // `aria-invalid` is not supported on `role="radio"` — a single radio is not individually
    // invalid, the group is. The first draft of this form put it on both the input and the label,
    // and `jsx-a11y/role-supports-aria-props` caught it.
    const group = screen.getByRole('radiogroup');
    // `jest-dom` is not wired in this project, so the accessible name is read the way the DOM
    // computes it for a fieldset: its `<legend>`.
    expect(group.querySelector('legend')?.textContent).toBe(ATHLETE_FORM_COPY.legend);
    for (const r of radios()) expect(r.hasAttribute('aria-invalid')).toBe(false);
  });

  it('names both options so a parent reads a word, never the stored value', () => {
    renderForm();
    // `kid` is the schema's word. It must not reach a screen — the maintainer's instruction on aD3.
    const labels = radios().map((r) => r.closest('label')!.textContent ?? '');
    expect(labels[0]).toContain('Child');
    expect(labels[1]).toContain('Adult');
    expect(labels.join(' ')).not.toMatch(/\bkid\b/);
    // …while the SUBMITTED values are the stored ones, from the shared const.
    expect(radios().map((r) => r.value)).toEqual([PROFILE_KIND.kid, PROFILE_KIND.adult]);
  });

  it('claims the household program only when the household actually programs something', () => {
    renderForm(false);
    // A first-run household has no program, so "on the household's program" would be false. `a-g`'s
    // day page branches on the same boolean rather than claiming one exists.
    // Both options ALWAYS carry a consequence now; only the child's wording branches. The first
    // version dropped the child line entirely at first run, leaving "Child" beside
    // "Adult — logs their own training" in front of this form's main audience.
    expect(screen.getByText(ATHLETE_FORM_COPY.kidFirstRun)).toBeTruthy();
    expect(screen.queryByText(ATHLETE_FORM_COPY.kidWithProgram)).toBeNull();
    cleanup();
    renderForm(true);
    expect(screen.getByText(ATHLETE_FORM_COPY.kidWithProgram)).toBeTruthy();
  });

  it('keeps the adult consequence in BOTH cases — it does not depend on a program', () => {
    for (const programs of [true, false]) {
      renderForm(programs);
      // Exact strings, not `new RegExp(copy)`: the copy is data and a future edit adding a `.` or
      // `(` would turn the pattern into a silently different matcher.
      expect(screen.getByText(ATHLETE_FORM_COPY.adultConsequence)).toBeTruthy();
      cleanup();
    }
  });

  it('carries the server-minted clientId as a hidden field, unmodified', () => {
    renderForm();
    const hidden = document.querySelector<HTMLInputElement>('input[name="clientId"]');
    // Minted by the PAGE, once per render. Minting it in the client would re-mint on every remount,
    // and a resubmit after a remount would create a second athlete instead of replaying onto one.
    expect(hidden?.value).toBe(CLIENT_ID);
    expect(hidden?.type).toBe('hidden');
  });

  /** Drive a real submit whose action RESOLVES the given refusal, then let React commit the settle. */
  async function submitExpecting(refusal: {
    error?: string | null;
    fieldErrors?: { name?: string[]; kind?: string[] };
  }) {
    vi.mocked(addAthleteAction).mockResolvedValueOnce({
      ok: false,
      error: refusal.error ?? null,
      ...(refusal.fieldErrors ? { fieldErrors: refusal.fieldErrors } : {}),
    } as Awaited<ReturnType<typeof addAthleteAction>>);
    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });
  }

  it('a NAME-only refusal leaves the chosen kind checked', async () => {
    renderForm();
    fireEvent.click(radios()[1]!);
    await submitExpecting({ fieldErrors: { name: ['Enter a name.'] } });

    // 🔴 **This is the defect the chunk exists to have fixed, and the test that could not fail
    // before.** React 19 resets fields in a `<form action>` when the action settles, including on a
    // refusal — and it freezes a controlled radio's `defaultChecked` at mount, so `checked` alone is
    // wiped. A parent who chose Adult and left the name blank got the name error AND a cleared kind,
    // then a SECOND refusal about the kind if they did not notice.
    //
    // ⚠️ The version of this test it replaces asserted `expect(radio).toHaveProperty('onchange')`,
    // which is true of every DOM input, and three clicks that pass for plain uncontrolled radios.
    // Nothing in it would have failed if the fix were deleted. This one does.
    expect(radios()[1]!.checked).toBe(true);
    expect(radios()[0]!.checked).toBe(false);
  });

  it('…and the typed name survives a KIND-only refusal', async () => {
    renderForm();
    fireEvent.change(nameField(), { target: { value: 'Ada' } });
    await submitExpecting({ fieldErrors: { kind: ['Choose Child or Adult.'] } });
    expect(nameField().value).toBe('Ada');
  });

  it('a kind refusal marks the GROUP invalid, and choosing a kind clears it', async () => {
    renderForm();
    await submitExpecting({ fieldErrors: { kind: ['Choose Child or Adult.'] } });

    const group = screen.getByRole('radiogroup');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);

    // The error clears the moment the parent fixes it. Derived purely from `state`, the alert and the
    // red border would persist while they looked at a choice they had already made.
    fireEvent.click(radios()[0]!);
    expect(group.getAttribute('aria-invalid')).toBeNull();
  });

  it('each field gets its OWN alert — one shared region cross-wired aria-describedby', async () => {
    renderForm();
    await submitExpecting({
      fieldErrors: { kind: ['Choose Child or Adult.'], name: ['Enter a name.'] },
    });

    // The action returns BOTH when both are invalid (`profile-actions.ts`), which is why the first
    // version's comment — "at most one field's errors per submit in practice" — was wrong. With one
    // shared region, the name input's `aria-describedby` also pointed at the kind's message.
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    const nameDescribedBy = nameField().getAttribute('aria-describedby') ?? '';
    const kindMessageId = alerts.find((a) => a.textContent?.includes('Child or Adult'))!.id;
    const nameMessageId = alerts.find((a) => a.textContent?.includes('Enter a name'))!.id;
    // BOTH directions. Asserting only that the name is not wired to the kind's message would pass
    // with the name's own `aria-describedby` entry deleted — which is the louder defect of the two.
    expect(nameDescribedBy).not.toContain(kindMessageId);
    expect(nameDescribedBy).toContain(nameMessageId);
    expect(screen.getByRole('radiogroup').getAttribute('aria-describedby') ?? '').toContain(
      kindMessageId,
    );
  });

  /**
   * 🔴 **Focus had NO unit coverage**, which a review found by replacing the whole effect with a
   * no-op and watching all sixteen tests pass. Only e2e touched it, and only the single-field cases.
   * The both-invalid case below is a defect this file would never have seen.
   */
  it('a refusal moves focus to the field that is wrong — kind first when both are', async () => {
    renderForm();
    await submitExpecting({ fieldErrors: { name: ['Enter a name.'] } });
    expect(document.activeElement).toBe(nameField());

    cleanup();
    renderForm();
    await submitExpecting({
      fieldErrors: { kind: ['Choose Child or Adult.'], name: ['Enter a name.'] },
    });
    // The field above, and the one a parent is likelier to have skipped.
    expect(document.activeElement).toBe(radios()[0]);
  });

  it('choosing a kind does NOT steal focus away from the radio group', async () => {
    renderForm();
    await submitExpecting({
      fieldErrors: { kind: ['Choose Child or Adult.'], name: ['Enter a name.'] },
    });
    expect(document.activeElement).toBe(radios()[0]);

    // 🔴 The bug this pins: the effect used to depend on the DERIVED `kindInvalid`, so picking a
    // radio flipped it false, re-ran the effect, and focused the name — throwing a keyboard user out
    // of the group on their first arrow key, while the name error was still showing. A refusal is an
    // event, not a condition, so the effect depends on `state` alone.
    fireEvent.click(radios()[1]!);
    expect(document.activeElement).not.toBe(nameField());
  });

  it('name is CONTROLLED, and bounded by the shared max', () => {
    renderForm();
    fireEvent.change(nameField(), { target: { value: 'Ada' } });
    // React 19 resets an UNcontrolled field when a form action settles, including on `{ ok: false }`
    // (`write-path.md` → Traps, the uncontrolled-fields bullet) — so a kind-only refusal would empty a name the parent had
    // just typed. The rename form carries the same decision for the same reason.
    expect(nameField().value).toBe('Ada');
    expect(nameField().maxLength).toBe(PROFILE_NAME_MAX);
  });

  it('gives the name field the phone-keyboard attributes a name needs', () => {
    renderForm();
    const f = nameField();
    // Each one is a defect if absent: sentence-case capitalises only the first word of "Mary Ann";
    // autocomplete offers the DEVICE OWNER's name on a shared family phone; a dictionary marks every
    // name as a misspelling; and "done" reads as "dismiss the keyboard" on a key that submits.
    expect(f.getAttribute('autocapitalize')).toBe('words');
    expect(f.getAttribute('autocomplete')).toBe('off');
    expect(f.getAttribute('spellcheck')).toBe('false');
    expect(f.getAttribute('enterkeyhint')).toBe('go');
  });

  it('submits "Add athlete", not "Save name"', () => {
    renderForm();
    // This screen CREATES. `ATHLETE_FORM_COPY.save` is the rename form's and stays there.
    expect(screen.getByRole('button').textContent).toBe(ATHLETE_FORM_COPY.add);
    expect(ATHLETE_FORM_COPY.add).not.toBe(ATHLETE_FORM_COPY.save);
  });

  /**
   * PROF-1 a-1d — the duplicate callout.
   *
   * 🔴 **These exist because two documents claimed they already did.** The e2e docblock and
   * `docs/tech-debt.md` both said "the unit suite proves the Restore button renders and that the
   * kinds-differ copy appears" while this file contained nothing but two `vi.mock` lines. A review
   * lens found it. Writing the tests was the fix; weakening the claim was not.
   */
  const duplicateState = (
    over: Partial<{
      archived: boolean;
      kind: ProfileKind;
      atCap: boolean;
      storedName: string;
      /** Only feeds `folded` below — the server's fold is derived from the name it parsed. */
      typed: string;
    }> = {},
  ) =>
    ({
      ok: false,
      error: null,
      duplicate: {
        match: {
          publicId: 'p-match',
          name: over.storedName ?? 'Ada',
          kind: over.kind ?? PROFILE_KIND.kid,
          archived: over.archived ?? false,
        },
        atCap: over.atCap ?? false,
        // 🔴 Derived with the REAL `foldName`, not the literal `'ada'` this used to hard-code. The
        // form only shows a callout while `foldName(typed) === folded`, so a hand-written fold is a
        // fixture that can disagree with the function the component calls — and a case using any
        // other name would then render nothing and assert nothing.
        folded: foldName(over.typed ?? 'Ada'),
      },
    }) as Awaited<ReturnType<typeof addAthleteAction>>;

  /** Choose a kind, type `Ada`, and submit into the given duplicate answer. */
  async function warnWith(state: Awaited<ReturnType<typeof addAthleteAction>>, kindIndex = 0) {
    renderForm();
    fireEvent.click(radios()[kindIndex]!);
    fireEvent.change(nameField(), { target: { value: 'Ada' } });
    vi.mocked(addAthleteAction).mockResolvedValueOnce(state);
    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });
  }

  it('a LIVE match offers Open and Add another, and takes focus', async () => {
    await warnWith(duplicateState());
    expect(screen.getByRole('link', { name: /Open Ada/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add another Ada/ })).toBeTruthy();
    // Focus IS the announcement — `aria-describedby` is read on focus, and the submit has blurred.
    expect(document.activeElement?.getAttribute('role')).toBe('group');
  });

  it('an ARCHIVED match offers Restore, and never Open', async () => {
    await warnWith(duplicateState({ archived: true }));
    expect(screen.getByRole('button', { name: /Restore Ada/ })).toBeTruthy();
    // The archived day page is read-only, so "Open" would send them somewhere they cannot act.
    expect(screen.queryByRole('link', { name: /Open Ada/ })).toBeNull();
  });

  it('an archived match whose KIND differs says so, and promotes neither choice', async () => {
    // 🔴 The collision: this screen tells a parent who picked the wrong kind to archive and add
    // again. They return with the corrected kind — and Restore would hand back the WRONG kind,
    // permanently. Chosen = Child (index 0), archived match = Adult.
    await warnWith(duplicateState({ archived: true, kind: PROFILE_KIND.adult }), 0);
    expect(screen.getByText(/can’t be changed/)).toBeTruthy();
    // 🔴 The half that names the parent's OWN choice — without it, swapping the two kind arguments
    // in the copy call would still pass, and that swap is the whole point of the sentence.
    expect(screen.getByText(/You chose Child/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add a new Ada \(Child\) instead/ })).toBeTruthy();
  });

  /**
   * 🔴 **The warning has to be TIED to the field, not merely rendered near it.** The plan accepted
   * this at C6 and it was not shipped: `duplicateMessageId` reached the Callout and nothing else,
   * while the plan, the component docblock and `callout.test.tsx` all described a wiring no element
   * had. A screen-reader user hears the callout once, on the focus move; the moment they Shift+Tab
   * back to the field to change the spelling — which is what the disambiguation advice asks of them
   * — the association is the only thing that still speaks.
   */
  it('ties the warning to the NAME field via aria-describedby, and lets go when it clears', async () => {
    await warnWith(duplicateState());

    const messageId = screen.getByRole('group').getAttribute('aria-labelledby');
    expect(messageId).toBeTruthy();
    expect(nameField().getAttribute('aria-describedby')).toContain(messageId);
    // The hint must survive alongside it — appended, not replaced.
    expect(nameField().getAttribute('aria-describedby')!.split(' ').length).toBeGreaterThan(1);

    // Editing past the match dismisses the callout, so the association must go with it rather than
    // pointing `aria-describedby` at an id no longer in the document.
    fireEvent.change(nameField(), { target: { value: 'Bea' } });
    expect(nameField().getAttribute('aria-describedby')).not.toContain(messageId);
    expect(document.getElementById(messageId!)).toBeNull();
  });

  it('ties it to the RADIOGROUP too, but only when the kinds differ', async () => {
    // Kinds agree: the message is about the name, so repeating it on the kind control would be noise.
    await warnWith(duplicateState({ archived: true }));
    const sameKindMessageId = screen.getByRole('group').getAttribute('aria-labelledby');
    expect(screen.getByRole('radiogroup').getAttribute('aria-describedby')).not.toContain(
      sameKindMessageId,
    );
    cleanup();

    // Kinds differ: the message reads "…saved as Adult … You chose Child" — it IS about this
    // control, and switching the radio rewrites the sentence with no announcement of its own.
    await warnWith(duplicateState({ archived: true, kind: PROFILE_KIND.adult }), 0);
    const messageId = screen.getByRole('group').getAttribute('aria-labelledby');
    expect(screen.getByRole('radiogroup').getAttribute('aria-describedby')).toContain(messageId);
  });

  /**
   * 🔴 A failed Restore dropped keyboard focus to `<body>`. `disabled={restorePending}` blurs the
   * button the moment it is clicked — the same mechanism this form documents for its primary submit
   * — so the `role="alert"` was heard while the keyboard position was gone, and the next Tab started
   * above the page header.
   */
  it('returns focus to the callout when a Restore FAILS', async () => {
    await warnWith(duplicateState({ archived: true }));
    const restore = screen.getByRole('button', { name: /Restore Ada/ });

    // ⚠️ `mockResolvedValue`, NOT `…Once`: the click on a `type="submit"` button already dispatches
    // one submit, so a single-shot mock is spent before the explicit dispatch below and the second
    // call resolves `undefined` — which is how the second version of this test failed.
    vi.mocked(restoreAthleteAction).mockResolvedValue({
      ok: false,
      error: 'nope',
    } as Awaited<ReturnType<typeof restoreAthleteAction>>);
    fireEvent.click(restore);
    // 🔴 **Move focus OFF the callout first, or this proof cannot fail.** The add-submit already
    // focused the group, and jsdom does not move focus on a click, so the naive version of this test
    // passed with the fix deleted — it was re-asserting focus the previous effect had set. In a real
    // browser `disabled={restorePending}` blurs the clicked button to `<body>`; the name field
    // stands in for "focus is anywhere but the group", and the assertion is that it comes BACK.
    nameField().focus();
    expect(document.activeElement).toBe(nameField());

    await act(async () => {
      // ⚠️ **NOT `restore.closest('form')`.** The button sits inside the add form but belongs to the
      // hidden sibling via `form={restoreFormId}`, so `closest` finds the wrong one — and submitting
      // the add form with no mocked answer sets its state to `undefined`, which is how the first
      // version of this test failed.
      fireEvent.submit(document.getElementById(restore.getAttribute('form')!)!);
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.activeElement?.getAttribute('role')).toBe('group');

    // ⚠️ **Reset it here.** This file has no `beforeEach` and the config sets no `clearMocks`, so a
    // persistent `mockResolvedValue` would hand a stale failure to every later test that touches
    // Restore — including the wiring test below.
    vi.mocked(restoreAthleteAction).mockReset();
  });

  /**
   * 🔴 At the cap the choice simply vanished. `addAnotherButton` returns `null`, and the action
   * answers this path with `error: null` — it is a duplicate envelope, not a refusal — so
   * `HOUSEHOLD_FULL` rendered nowhere. A parent of two genuinely different Adas saw one button and
   * was given no reason and no route.
   */
  it('at the cap, the message SAYS why there is no "Add another" — and drops advice about adding', async () => {
    await warnWith(duplicateState({ atCap: true }));
    expect(screen.getByRole('group').textContent).toContain(HOUSEHOLD_FULL);
    // 🔴 **And the disambiguation advice goes.** "Add an initial … to tell them apart" is
    // instructions for an add the quota refuses, and the two sentences landed in one paragraph.
    // Found by reading the captured screenshot, not the code.
    expect(screen.getByRole('group').textContent).not.toMatch(/Add an initial/);
    cleanup();
    // Not at the cap: the reason must not appear, or it reads as a limit they have hit.
    await warnWith(duplicateState());
    expect(screen.getByRole('group').textContent).not.toContain(HOUSEHOLD_FULL);
  });

  /**
   * 🔴 The composed kinds-differ message sold Restore in the sentence before the one warning that
   * Restore is permanent and wrong. The plan's C7 asks that neither option be given primacy, and a
   * benefit stated first is primacy.
   */
  it('omits the "Restoring brings back everything" line when the kinds DIFFER', async () => {
    await warnWith(duplicateState({ archived: true, kind: PROFILE_KIND.adult }), 0);
    expect(screen.getByRole('group').textContent).not.toContain(
      ATHLETE_FORM_COPY.duplicateArchivedRestoreNote,
    );
    cleanup();
    // …and keeps it when they agree, where it is the reason Restore is the better choice.
    await warnWith(duplicateState({ archived: true }));
    expect(screen.getByRole('group').textContent).toContain(
      ATHLETE_FORM_COPY.duplicateArchivedRestoreNote,
    );
  });

  /**
   * ⚠️ `athleteNameSchema` stores the name COLLAPSED as well as trimmed, so a typed "Ada  B" and a
   * stored "Ada B" are the same record and really would render two identical tiles. A bare `trim()`
   * read them as different spellings and dropped advice that is true.
   */
  it('the disambiguation advice survives interior double spaces, which the schema collapses', async () => {
    renderForm();
    fireEvent.click(radios()[0]!);
    fireEvent.change(nameField(), { target: { value: 'Ada  B' } });
    // The server stores — and echoes — the COLLAPSED name, so its fold matches the double-spaced
    // text in the field and the callout really does appear. The advice is what went missing.
    vi.mocked(addAthleteAction).mockResolvedValueOnce(
      duplicateState({ storedName: 'Ada B', typed: 'Ada B' }),
    );
    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });
    expect(screen.getByText(/Both will show as/)).toBeTruthy();
  });

  it('🔴 at the cap, NEITHER branch offers "Add another" — the endpoint would refuse it', async () => {
    await warnWith(duplicateState({ atCap: true }));
    // A positive assertion FIRST: without it a callout that never rendered would pass the queryBy.
    expect(screen.getByRole('link', { name: /Open Ada/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add another/ })).toBeNull();
    cleanup();
    // The archived branch had no guard at all until a review found it: one shared button now.
    await warnWith(duplicateState({ archived: true, atCap: true }));
    expect(screen.queryByRole('button', { name: /Add a new|Add another/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Restore Ada/ })).toBeTruthy();
  });

  /**
   * 🔴 **`showDisambiguation` had no test at any tier** — the whole gate could be replaced with
   * `false` and all 26 tests passed. Found by probing rather than reading, which is how the other
   * three empty proofs in this chunk surfaced too.
   *
   * Its four conjuncts each exist for a reason, so each gets a case: the advice is only TRUE when
   * the two athletes would be indistinguishable on a tile, and a tile shows name **and** kind.
   */
  it('the "both will show as" advice appears only when the tiles really would be identical', async () => {
    // Exact spelling, same kind, live → the one case where the advice is true.
    await warnWith(duplicateState());
    fireEvent.change(nameField(), { target: { value: 'Ada' } });
    expect(screen.getByText(/Both will show as/)).toBeTruthy();
  });

  it('…and NOT when the fold matched but the spellings differ', async () => {
    // 🔴 The false-positive case the hedging exists for: `foldName` is lossy, so a typed "Jose"
    // matches a stored "José" — which render as two DIFFERENT tiles. Telling a parent they will look
    // the same would be false, and would nudge them into disambiguating names that already differ.
    await warnWith(duplicateState());
    fireEvent.change(nameField(), { target: { value: 'ada' } });
    expect(screen.queryByText(/Both will show as/)).toBeNull();
  });

  it('…and NOT when the kinds differ, because a tile shows the kind too', async () => {
    await warnWith(duplicateState({ kind: PROFILE_KIND.adult }), 0);
    fireEvent.change(nameField(), { target: { value: 'Ada' } });
    expect(screen.queryByText(/Both will show as/)).toBeNull();
  });

  it('…and NOT for an archived match, who is not on the picker at all', async () => {
    await warnWith(duplicateState({ archived: true }));
    fireEvent.change(nameField(), { target: { value: 'Ada' } });
    expect(screen.queryByText(/Both will show as/)).toBeNull();
  });

  /**
   * 🔴 **The Restore WIRING had no test at any tier.** `routerReplace` was declared in this file's
   * mock and never asserted; `restoreAthleteAction` was mocked and never invoked. Dropping
   * `form={restoreFormId}` makes the button submit the ADD form instead — so Restore silently does
   * nothing — and everything stayed green. The tech-debt note said "nothing proves the click",
   * which was only half true: the cheap jsdom half was unproven too.
   */
  it('Restore is wired to the sibling form, carrying the match id', async () => {
    await warnWith(duplicateState({ archived: true }));
    const restore = screen.getByRole('button', { name: /Restore Ada/ }) as HTMLButtonElement;

    // A `<form>` cannot nest, so the button reaches its own form by `form=`. Without this attribute
    // it belongs to the add form and posts the wrong action.
    const owner = restore.getAttribute('form');
    expect(owner).toBeTruthy();
    const restoreForm = document.getElementById(owner!) as HTMLFormElement;
    expect(restoreForm?.tagName).toBe('FORM');
    const profileId = restoreForm.querySelector<HTMLInputElement>('input[name="profileId"]');
    expect(profileId?.value).toBe('p-match');
    // …and it is NOT the add form, which would post the add action with no acknowledgement.
    expect(restoreForm).not.toBe(screen.getByRole('group').closest('form'));
  });

  it('a successful Restore opens the athlete rather than adding a second', async () => {
    await warnWith(duplicateState({ archived: true }));
    vi.mocked(restoreAthleteAction).mockResolvedValue({
      ok: true,
      error: null,
      savedId: 'p-match',
    } as Awaited<ReturnType<typeof restoreAthleteAction>>);
    const restore = screen.getByRole('button', { name: /Restore Ada/ });
    await act(async () => {
      fireEvent.click(restore);
      fireEvent.submit(document.getElementById(restore.getAttribute('form')!) as HTMLFormElement);
    });
    // `restoreAthleteAction` returns an envelope and does NOT redirect, so the navigation is ours.
    expect(routerReplace).toHaveBeenCalledWith(athletePath('p-match'));
  });

  it('a FAILED Restore says so in add-screen words, not "No athlete found to save."', async () => {
    await warnWith(duplicateState({ archived: true }));
    // `mockResolvedValue`, not `…Once`: the click may itself submit in jsdom, so a one-shot mock
    // would be consumed by the click and the explicit submit would get the default.
    vi.mocked(restoreAthleteAction).mockResolvedValue({
      ok: false,
      error: 'nope',
    } as Awaited<ReturnType<typeof restoreAthleteAction>>);
    const restore = screen.getByRole('button', { name: /Restore Ada/ });
    // ⚠️ CLICK, not a bare form submit: the click is what records which athlete the attempt was
    // for, so the failure message cannot later surface over a DIFFERENT archived callout.
    await act(async () => {
      fireEvent.click(restore);
      fireEvent.submit(document.getElementById(restore.getAttribute('form')!) as HTMLFormElement);
    });
    expect(screen.getByText(ATHLETE_FORM_COPY.restoreFailed('Ada'))).toBeTruthy();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('a failed Restore for one athlete does NOT show its error over a DIFFERENT one', async () => {
    // 🔴 The cross-callout case. `restoreState` persists in `useActionState`, so scoping the error
    // to "an archived match" was not enough: a failure for Ada then read "Couldn't restore Bea"
    // above Bea's callout, about an attempt nobody made. The error is keyed to the match the click
    // was for.
    await warnWith(duplicateState({ archived: true }));
    vi.mocked(restoreAthleteAction).mockResolvedValue({
      ok: false,
      error: 'nope',
    } as Awaited<ReturnType<typeof restoreAthleteAction>>);
    const restore = screen.getByRole('button', { name: /Restore Ada/ });
    await act(async () => {
      fireEvent.click(restore);
      fireEvent.submit(document.getElementById(restore.getAttribute('form')!) as HTMLFormElement);
    });
    expect(screen.getByText(ATHLETE_FORM_COPY.restoreFailed('Ada'))).toBeTruthy();

    // Now a warning about somebody else, without ever pressing Restore for them.
    vi.mocked(addAthleteAction).mockResolvedValueOnce({
      ok: false,
      error: null,
      duplicate: {
        match: { publicId: 'p-other', name: 'Bea', kind: PROFILE_KIND.kid, archived: true },
        atCap: false,
        folded: 'bea',
      },
    } as Awaited<ReturnType<typeof addAthleteAction>>);
    fireEvent.change(nameField(), { target: { value: 'Bea' } });
    await act(async () => {
      fireEvent.submit(screen.getAllByRole('button')[0]!.closest('form')!);
    });

    expect(screen.getByRole('button', { name: /Restore Bea/ })).toBeTruthy();
    expect(screen.queryByText(ATHLETE_FORM_COPY.restoreFailed('Bea'))).toBeNull();
  });

  it('the acknowledgement rides the SUBMITTER, so it cannot be stale', async () => {
    await warnWith(duplicateState());
    const add = screen.getByRole('button', { name: /Add another Ada/ }) as HTMLButtonElement;
    expect(add.name).toBe('acknowledgedDuplicate');
    expect(add.value).toBe('ada');
  });

  it("🔴 the form's DEFAULT submit never carries the acknowledgement", async () => {
    await warnWith(duplicateState());

    // 🔴 **This is the real invariant, and the guard it replaces was too narrow.** The default
    // button is the FIRST submit button in tree order, visible or not — so any implicit submission
    // (Enter on the name field, Enter on a RADIO, a soft keyboard's Go, an IME confirm) activates
    // it. The first version unmounted the primary submit, which promoted the callout's "Add
    // another" into that role; a reviewer probed Enter on a focused radio in Chromium and it
    // acknowledged. An `onKeyDown` guard on the name input could not cover the radio path.
    const form = screen.getByRole('group').closest('form')!;
    const submits = Array.from(
      form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
    ).filter((b) => b.form === form);
    expect(submits.length).toBeGreaterThan(0);
    expect(submits[0]!.name).not.toBe('acknowledgedDuplicate');

    // …and it is inert to sight, screen readers and Tab, while still being the default.
    expect(submits[0]!.hidden).toBe(true);
    expect(submits[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(submits[0]!.tabIndex).toBe(-1);
    // And the acknowledging buttons are still reachable — they are just not the DEFAULT.
    expect(screen.getByRole('button', { name: /Add another Ada/ })).toBeTruthy();
  });

  it('…and with no duplicate showing there is no sentinel, just the visible primary', () => {
    renderForm();
    const submits = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
    );
    expect(submits).toHaveLength(1);
    expect(submits[0]!.hidden).toBe(false);
    expect(submits[0]!.textContent).toBe(ATHLETE_FORM_COPY.add);
  });

  it('editing the name past the match dismisses the callout and restores the primary submit', async () => {
    await warnWith(duplicateState());
    expect(screen.queryByRole('group')).toBeTruthy();
    fireEvent.change(nameField(), { target: { value: 'Bea' } });
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('button', { name: ATHLETE_FORM_COPY.add })).toBeTruthy();
  });

  it('renders no live region — success is a server redirect, so there is nothing to announce', () => {
    renderForm();
    // The rename form mounts an `<Announcer>` because a no-JS rename has no navigation to confirm it.
    // Here the action ends in `redirect(…)`, so this component is gone before a status could render.
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('[aria-live]')).toBeNull();
  });
});
