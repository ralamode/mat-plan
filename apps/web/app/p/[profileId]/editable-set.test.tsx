// @vitest-environment jsdom
import { ENTRY_STATUS, QUANTITY_SLOT, UNIT_DIMENSION } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The island imports the Server Action module ('use server'), which jsdom can't evaluate.
vi.mock('./actions', () => ({
  editStrengthSetAction: vi.fn(async () => ({ ok: true, error: null })),
}));

import {
  AMEND_COPY,
  AMEND_ERROR_COPY,
  changeLabel,
  setAmendErrorId,
  weightInputLabel,
} from '@/lib/constants';
import type { SetDTO } from '@/lib/dal/entries';

import { editStrengthSetAction } from './actions';
import { EditableSet } from './editable-set';
import { formatSetLine } from './set-display';

afterEach(cleanup);

const set = (o: Partial<SetDTO> = {}): SetDTO => ({
  publicId: 'set-a',
  idx: 2,
  reps: 5,
  isBodyweight: false,
  isBand: false,
  quantities: [
    { slot: QUANTITY_SLOT.primary, dimension: UNIT_DIMENSION.mass, unit: 'lb', value: 135 },
  ],
  status: ENTRY_STATUS.done,
  ...o,
});
const SUBJECT = 'Back squat set 2';
const WEIGHT = weightInputLabel(SUBJECT, 'lb');
const island = (s = set(), subject = SUBJECT) => (
  <ul>
    <EditableSet set={s} profileId="p-1" subject={subject} />
  </ul>
);
const change = (s = set(), subject = SUBJECT) =>
  screen.getByRole('button', { name: changeLabel(subject, formatSetLine(s)) });
const statusText = () => screen.getByRole('status').textContent;

describe('EditableSet — the 1b amend standard (V1-24 3a-i)', () => {
  it('reads Change, named by changeLabel so N sets on a screen are distinguishable', () => {
    render(island());
    expect(change().textContent).toBe(AMEND_COPY.change);
  });

  it('the status region is ONE node across read and edit (a remounted region is not announced)', async () => {
    render(island());
    const region = screen.getByRole('status');
    fireEvent.click(change());
    expect(screen.getByRole('status')).toBe(region);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
    });
    expect(screen.getByRole('status')).toBe(region);
  });

  it('opening focuses reps (the Change button that had focus unmounts)', () => {
    render(island());
    fireEvent.click(change());
    expect(document.activeElement).toBe(
      screen.getByRole('spinbutton', { name: `${SUBJECT} reps` }),
    );
  });

  it('saving the SAME value again is announced again', async () => {
    render(island());
    for (let i = 0; i < 2; i++) {
      fireEvent.click(change());
      expect(statusText()).toBe(''); // cleared on open, so the next save is a text change
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
      });
      expect(statusText()).toBe(AMEND_COPY.setChanged(SUBJECT, formatSetLine(set())));
    }
  });

  it('labels the weight input with its unit code', () => {
    render(island());
    fireEvent.click(change());
    expect(screen.getByRole('spinbutton', { name: WEIGHT })).toBeTruthy();
  });

  it('save: announces the SUBJECT and the value, and focus returns to Change', async () => {
    render(island());
    fireEvent.click(change());
    fireEvent.change(screen.getByRole('spinbutton', { name: WEIGHT }), {
      target: { value: '140' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
    });
    expect(statusText()).toBe(
      AMEND_COPY.setChanged(
        SUBJECT,
        formatSetLine(set({ quantities: [{ ...set().quantities[0]!, value: 140 }] })),
      ),
    );
    expect(document.activeElement).toBe(change());
  });

  it('cancel: focus returns to Change, nothing announced', () => {
    render(island());
    fireEvent.click(change());
    fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.cancel }));
    expect(document.activeElement).toBe(change());
    expect(statusText()).toBe('');
  });

  it('an error is tied to BOTH inputs by a per-set id, and a reopen clears it', async () => {
    vi.mocked(editStrengthSetAction).mockResolvedValueOnce({
      ok: false,
      error: AMEND_ERROR_COPY.notFound('set'),
    });
    render(island());
    fireEvent.click(change());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
    });
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe(setAmendErrorId('set-a'));
    for (const name of [`${SUBJECT} reps`, WEIGHT]) {
      expect(screen.getByRole('spinbutton', { name }).getAttribute('aria-describedby')).toBe(
        alert.id,
      );
    }
    expect(statusText()).toBe(''); // a refusal is never announced as changed
    fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.cancel }));
    fireEvent.click(change());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('two islands never share an error id', () => {
    expect(setAmendErrorId('set-a')).not.toBe(setAmendErrorId('set-b'));
  });

  it('Save and Cancel sit on their own row, apart from the inputs (280px superset member)', () => {
    render(island());
    fireEvent.click(change());
    const save = screen.getByRole('button', { name: AMEND_COPY.save });
    const reps = screen.getByRole('spinbutton', { name: `${SUBJECT} reps` });
    expect(save.parentElement).not.toBe(reps.parentElement);
    expect(save.parentElement).toBe(
      screen.getByRole('button', { name: AMEND_COPY.cancel }).parentElement,
    );
  });
});
