// @vitest-environment jsdom
import { PROFILE_KIND, PROFILE_NAME_MAX } from '@mat-plan/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form imports a `'use server'` module, which cannot be evaluated under jsdom. Mocked here —
// this file is about what the FORM does; the action's own boundary tests live in
// `profile-actions.test.ts` and the household matrix in `[profileId]/actions.test.ts`.
vi.mock('@/app/p/profile-actions', () => ({ addAthleteAction: vi.fn() }));

import { ATHLETE_FORM_COPY } from '@/lib/constants';

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
 * ⚠️ **What it cannot see**, stated so the coverage is not over-read: the refusal path needs
 * `useActionState` to return a state this test cannot inject (the action is mocked and never
 * invoked), so focus-on-refusal and the `role="alert"` are proved by `e2e/athletes.spec.ts` against
 * a real submit, not here. 200% text and the 360px geometry are a hand check — nothing in the suite
 * zooms.
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

  it('states the permanence, and names the way out, before the choice', () => {
    renderForm();
    const hint = screen.getByText(ATHLETE_FORM_COPY.kindPermanence);
    // Before, not after: a one-way door explained underneath the control is explained too late.
    expect(
      hint.compareDocumentPosition(radios()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // It must name the recovery, or it is a warning with no exit.
    expect(ATHLETE_FORM_COPY.kindPermanence).toContain('archive');
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
    expect(screen.queryByText(new RegExp(ATHLETE_FORM_COPY.kidConsequence))).toBeNull();
    cleanup();
    renderForm(true);
    expect(screen.getByText(new RegExp(ATHLETE_FORM_COPY.kidConsequence))).toBeTruthy();
  });

  it('keeps the adult consequence in BOTH cases — it does not depend on a program', () => {
    for (const programs of [true, false]) {
      renderForm(programs);
      expect(screen.getByText(new RegExp(ATHLETE_FORM_COPY.adultConsequence))).toBeTruthy();
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

  it('kind is CONTROLLED — a chosen radio is React state, not browser form state', () => {
    renderForm();
    const adult = radios()[1]!;
    fireEvent.click(adult);
    expect(adult.checked).toBe(true);
    // 🔴 **Why this matters, and it is not a style point.** React 19 resets an UNCONTROLLED field
    // when a form action settles, including on a refusal. Uncontrolled, a parent who chose Adult and
    // left the name blank got the name error AND a silently cleared kind — then a second refusal
    // about the kind if they did not notice. `e2e/athletes.spec.ts` caught it by asserting the radio
    // survives a name-only refusal; this tier pins that the value is React's to begin with.
    expect(adult).toHaveProperty('onchange');
    fireEvent.click(radios()[0]!);
    expect(radios()[0]!.checked).toBe(true);
    expect(adult.checked).toBe(false);
  });

  it('name is CONTROLLED, and bounded by the shared max', () => {
    renderForm();
    fireEvent.change(nameField(), { target: { value: 'Ada' } });
    // React 19 resets an UNcontrolled field when a form action settles, including on `{ ok: false }`
    // (`docs/features/write-path.md:341`) — so a kind-only refusal would empty a name the parent had
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
