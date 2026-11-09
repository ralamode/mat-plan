// @vitest-environment jsdom
import { PROFILE_KIND, PROFILE_NAME_MAX } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form imports a `'use server'` module, which cannot be evaluated under jsdom. Mocked here —
// this file is about what the FORM does; the action's own boundary tests live in
// `profile-actions.test.ts` and the household matrix in `[profileId]/actions.test.ts`.
vi.mock('@/app/p/profile-actions', () => ({ addAthleteAction: vi.fn() }));

import { ATHLETE_FORM_COPY } from '@/lib/constants';

import { addAthleteAction } from '@/app/p/profile-actions';

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

  it('renders no live region — success is a server redirect, so there is nothing to announce', () => {
    renderForm();
    // The rename form mounts an `<Announcer>` because a no-JS rename has no navigation to confirm it.
    // Here the action ends in `redirect(…)`, so this component is gone before a status could render.
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('[aria-live]')).toBeNull();
  });
});
