// @vitest-environment jsdom
import { foldName, PROFILE_KIND, type ProfileKind } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form imports a `'use server'` module, which cannot be evaluated under jsdom. The action's own
// boundary tests live in `profile-actions.test.ts`; this file is about what the FORM does.
vi.mock('@/app/p/profile-actions', () => ({ renameAthleteAction: vi.fn() }));

const routerBack = vi.fn();
const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: routerBack, replace: routerReplace, push: vi.fn(), refresh: vi.fn() }),
}));

import { renameAthleteAction } from '@/app/p/profile-actions';
import { ATHLETE_FORM_COPY } from '@/lib/constants';

import { RenameForm } from './rename-form';

afterEach(cleanup);

const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';
const nameField = () => screen.getByLabelText(ATHLETE_FORM_COPY.nameLabel) as HTMLInputElement;

const renderForm = (kind: ProfileKind = PROFILE_KIND.kid) =>
  render(
    <RenameForm profileId={PROFILE_ID} name="Ada" kind={kind} from={null} fallbackPath="/p/x" />,
  );

/**
 * COMPONENT TIER (RTL/jsdom) for the rename form.
 *
 * 🔴 **This file is NEW at PROF-1 a-1d-ren, and that is itself a finding.** The a-r refusal-focus
 * effect — "a refusal returns focus to the field that is wrong" — shipped in #350 and was pinned by
 * **nothing**: the e2e checks `aria-invalid` and the kept value, not focus. A UX lens caught it
 * while reviewing this chunk's plan, so the pre-existing behaviour gets its first test here.
 *
 * ⚠️ **What jsdom cannot do:** implicit submission. The hidden sentinel's REASON (Enter/Go activates
 * the form's default button) is unprovable here, so this file pins its STRUCTURE and
 * `e2e/athletes.spec.ts` drives the real key.
 */
const duplicateState = (
  over: Partial<{ archived: boolean; kind: ProfileKind; stored: string }> = {},
) =>
  ({
    ok: false,
    error: null,
    duplicate: {
      match: {
        publicId: 'p-match',
        name: over.stored ?? 'Bea',
        kind: over.kind ?? PROFILE_KIND.kid,
        archived: over.archived ?? false,
      },
      folded: foldName(over.stored ?? 'Bea'),
    },
  }) as Awaited<ReturnType<typeof renameAthleteAction>>;

/** Type a new name and submit into the given answer. */
async function submitWith(state: Awaited<ReturnType<typeof renameAthleteAction>>, typed = 'Bea') {
  renderForm();
  fireEvent.change(nameField(), { target: { value: typed } });
  vi.mocked(renameAthleteAction).mockResolvedValueOnce(state);
  await act(async () => {
    fireEvent.submit(nameField().closest('form')!);
  });
}

describe('RenameForm — the duplicate warning (PROF-1 a-1d-ren)', () => {
  it('shows the rename-specific sentence, not the add form’s, and takes focus', async () => {
    await submitWith(duplicateState());
    // 🔴 "…who is already on your list" under an <h1> reading "Rename Ada" is read as "yes, I know".
    expect(screen.getByRole('group').textContent).toContain('Another athlete looks like');
    expect(screen.getByRole('group').textContent).not.toContain('already on your list');
    // Focus IS the announcement — the Callout carries no `role="alert"` by design.
    expect(document.activeElement?.getAttribute('role')).toBe('group');
  });

  it('names the routes out, including what going back preserves', async () => {
    // The ARCHIVED case, where no disambiguation line renders — so the routes sentence carries both
    // halves. `initialName` is this athlete's own name ("Ada"), which is what going back preserves.
    await submitWith(duplicateState({ archived: true }));
    const text = screen.getByRole('group').textContent ?? '';
    // One button is only not-a-dead-end if the alternatives are stated.
    expect(text).toContain('Change the name');
    expect(text).toContain('Ada keeps their name');
    expect(screen.getByRole('button', { name: ATHLETE_FORM_COPY.saveAnyway })).toBeTruthy();
  });

  /**
   * 🔴 Found by reading the captured screenshot, not by a test. The disambiguation line ends
   * "…to tell them apart", and the routes sentence used to open "To tell them apart, change the
   * name" — the phrase twice in adjacent sentences, re-advising what had just been advised.
   */
  it('does not re-advise changing the name when the disambiguation line already did', async () => {
    // Exact spelling + equal kind → the advice renders, so the routes sentence drops its half.
    await submitWith(duplicateState());
    const text = screen.getByRole('group').textContent ?? '';
    expect(text).toContain('to tell them apart');
    expect(text).toContain('Ada keeps their name');
    expect(text).not.toContain('Change the name');
    // …and the phrase appears exactly once.
    expect(text.match(/tell them apart/g)).toHaveLength(1);
  });

  it('offers exactly ONE choice, and never Restore or Open', async () => {
    await submitWith(duplicateState({ archived: true }));
    // Restore is meaningless here: the match is somebody else, and restoring them would neither
    // finish nor abandon this rename.
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Open/ })).toBeNull();
    expect(screen.getByRole('group').textContent).toContain('archived');
    expect(screen.getByRole('group').textContent).not.toContain('Restoring brings back');
  });

  it('ties the warning to the name field, and lets go when the typed name moves on', async () => {
    await submitWith(duplicateState());
    const messageId = screen.getByRole('group').getAttribute('aria-labelledby');
    expect(messageId).toBeTruthy();
    expect(nameField().getAttribute('aria-describedby')).toContain(messageId);

    fireEvent.change(nameField(), { target: { value: 'Cleo' } });
    // ⚠️ Asserted as ABSENT, not as "does not contain": with no error and no duplicate the composed
    // value is `undefined`, so React removes the attribute outright and `getAttribute` returns
    // `null` — on which `.not.toContain()` throws about its receiver instead of passing.
    expect(nameField().getAttribute('aria-describedby')).toBeNull();
    expect(document.getElementById(messageId!)).toBeNull();
  });

  it('the sentinel is the FIRST submit and carries no acknowledgement', async () => {
    await submitWith(duplicateState());
    const submits = Array.from(
      nameField().closest('form')!.querySelectorAll('button[type="submit"]'),
    ) as HTMLButtonElement[];
    // 🔴 The structural invariant. HTML activates the first submit in TREE ORDER on every implicit
    // submission, so if "Save anyway" were first, Enter would acknowledge.
    expect(submits[0]!.hidden).toBe(true);
    expect(submits[0]!.getAttribute('name')).toBeNull();
    expect(submits.some((b) => b.getAttribute('name') === 'acknowledgedDuplicate')).toBe(true);
  });

  it('the primary Save is hidden while the callout shows, and comes back when it clears', async () => {
    await submitWith(duplicateState());
    expect(screen.queryByRole('button', { name: ATHLETE_FORM_COPY.save })).toBeNull();
    fireEvent.change(nameField(), { target: { value: 'Cleo' } });
    expect(screen.getByRole('button', { name: ATHLETE_FORM_COPY.save })).toBeTruthy();
  });

  /**
   * 🔴 The failure this prevents is specific: the derived `duplicate` depends on TYPING, so an
   * effect that depended on it would re-fire when a parent backspaces back onto the match — yanking
   * focus out of the field mid-edit and, on a phone, dropping the keyboard under their thumb.
   */
  it('re-typing the matching name does NOT re-steal focus', async () => {
    await submitWith(duplicateState());
    fireEvent.change(nameField(), { target: { value: 'Bea B' } });
    nameField().focus();
    expect(document.activeElement).toBe(nameField());
    // Back onto the match: the callout returns, but focus must stay where the parent is typing.
    fireEvent.change(nameField(), { target: { value: 'Bea' } });
    expect(screen.getByRole('group')).toBeTruthy();
    expect(document.activeElement).toBe(nameField());
  });

  it('“both will show as” needs an exact spelling AND an equal kind', async () => {
    await submitWith(duplicateState());
    expect(screen.getByText(/Both will show as/)).toBeTruthy();
    cleanup();
    // Same spelling, different kind: the tiles differ, so the advice would be false.
    await submitWith(duplicateState({ kind: PROFILE_KIND.adult }));
    expect(screen.queryByText(/Both will show as/)).toBeNull();
  });
});

describe('RenameForm — a stale form (the stale-rename fix)', () => {
  const staleState = (current = 'Bea') =>
    ({ ok: false, error: null, stale: { current } }) as Awaited<
      ReturnType<typeof renameAthleteAction>
    >;
  const form = () => nameField().closest('form')!;
  const hiddenSeen = () =>
    form().querySelector<HTMLInputElement>('input[type="hidden"][name="seenName"]');
  const submits = () =>
    Array.from(form().querySelectorAll<HTMLButtonElement>('button[type="submit"]'));
  const submitAgain = async (state: Awaited<ReturnType<typeof renameAthleteAction>>) => {
    vi.mocked(renameAthleteAction).mockResolvedValueOnce(state);
    await act(async () => {
      fireEvent.submit(form());
    });
  };

  it('sends the shown name as seenName, and a server refresh of the prop does not advance it', () => {
    const { rerender } = renderForm();
    expect(hiddenSeen()?.value).toBe('Ada');
    // A refresh (the time-zone sync, a revalidate) hands down a newer stored name: the form keeps
    // comparing against what it SHOWED, so the next Save is refused rather than overwriting.
    rerender(
      <RenameForm
        profileId={PROFILE_ID}
        name="Zed"
        kind={PROFILE_KIND.kid}
        from={null}
        fallbackPath="/p/x"
      />,
    );
    expect(hiddenSeen()?.value).toBe('Ada');
  });

  it('refuses with the approved copy, keeps the typing, and takes focus', async () => {
    await submitWith(staleState('Bea'), 'Cleo');
    expect(screen.getByRole('group').textContent).toContain(ATHLETE_FORM_COPY.renameStale('Bea'));
    expect(document.activeElement?.getAttribute('role')).toBe('group');
    expect(nameField().value).toBe('Cleo');
    // The refusal is tied to the field for a screen reader returning to it.
    expect(nameField().getAttribute('aria-describedby')).toContain('-stale');
  });

  it('the overwrite is Save anyway, carrying the stored name; Enter posts an empty seen name', async () => {
    await submitWith(staleState('Bea'), 'Cleo');
    const all = submits();
    // The sentinel first (hidden), carrying an EMPTY seen name, which no stored name can equal…
    expect(all[0]!.hidden).toBe(true);
    expect([all[0]!.name, all[0]!.value]).toEqual(['seenName', '']);
    // …then Save anyway, the only visible submit, carrying the stored name.
    const visible = all.filter((b) => !b.hidden);
    expect(visible.map((b) => b.textContent)).toEqual([ATHLETE_FORM_COPY.saveAnyway]);
    expect([visible[0]!.name, visible[0]!.value]).toEqual(['seenName', 'Bea']);
    // No second seenName to collide with while it shows.
    expect(hiddenSeen()).toBeNull();
  });

  it('a second Enter while stale still cannot carry the stored name', async () => {
    await submitWith(staleState('Bea'), 'Cleo');
    await submitAgain(staleState('Bea')); // the answer to the first Enter
    const sentinel = submits()[0]!;
    expect(sentinel.hidden).toBe(true);
    expect(sentinel.value).not.toBe('Bea');
    expect(sentinel.value).toBe('');
  });

  it('the refusal survives a field error, so a plain Save cannot come back and overwrite', async () => {
    await submitWith(staleState('Bea'), 'Cleo');
    await submitAgain({
      ok: false,
      error: null,
      fieldErrors: { name: ['Enter a name.'] },
    } as Awaited<ReturnType<typeof renameAthleteAction>>);
    // Still the stale callout and its Save anyway; no plain Save, no hidden seen name.
    expect(screen.getByRole('group').textContent).toContain(ATHLETE_FORM_COPY.renameStale('Bea'));
    expect(
      submits()
        .filter((b) => !b.hidden)
        .map((b) => b.textContent),
    ).toEqual([ATHLETE_FORM_COPY.saveAnyway]);
    expect(hiddenSeen()).toBeNull();
  });

  it('stale, then a duplicate answer: the form still compares against the stored name', async () => {
    await submitWith(staleState('Bea'), 'Cleo');
    await submitAgain(duplicateState({ stored: 'Cleo' }));
    // The stale callout is gone and the duplicate one shows; seenName stayed advanced.
    expect(screen.getByRole('group').textContent).toContain('Another athlete looks like');
    expect(hiddenSeen()?.value).toBe('Bea');
  });
});

describe('RenameForm — refusals (a-r, pinned here for the first time)', () => {
  it('a FIELD error returns focus to the input', async () => {
    renderForm();
    fireEvent.change(nameField(), { target: { value: '   ' } });
    vi.mocked(renameAthleteAction).mockResolvedValueOnce({
      ok: false,
      error: null,
      fieldErrors: { name: ['Enter a name.'] },
    } as Awaited<ReturnType<typeof renameAthleteAction>>);
    document.body.focus();
    await act(async () => {
      fireEvent.submit(nameField().closest('form')!);
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.activeElement).toBe(nameField());
  });

  it('a PAGE-level refusal moves focus to the error, not to <body>', async () => {
    renderForm();
    vi.mocked(renameAthleteAction).mockResolvedValueOnce({
      ok: false,
      error: 'Something went wrong.',
    } as Awaited<ReturnType<typeof renameAthleteAction>>);
    await act(async () => {
      fireEvent.submit(nameField().closest('form')!);
    });
    // The callout has unmounted by now, so the add form's "re-focus the callout" has nothing to
    // return to — this path needs its own target.
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.contains(screen.getByRole('alert'))).toBe(true);
  });
});
