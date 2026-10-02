// @vitest-environment jsdom
import {
  ACTIVITY_TYPE_KEYS,
  DAY_ROLE_LABELS,
  DEFAULT_SESSION_TYPE,
  ENTRY_STATUS,
  QUANTITY_SLOT,
  UNIT_DIMENSION,
} from '@mat-plan/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// EditableSet (a client island inside the receipt) imports the Server Action module.
vi.mock('./actions', () => ({ editStrengthSetAction: vi.fn() }));

import { AMEND_COPY, STRENGTH_COPY, strengthReceiptId } from '@/lib/constants';
import type { EntryDTO, SetDTO } from '@/lib/dal/entries';
import { todayRows, type SessionRow } from '@/lib/entries/activity-totals';

import { sessionOrdinals, StrengthSessionReceipt } from './strength-session-receipt';

afterEach(cleanup);

const loaded = (publicId: string): SetDTO => ({
  publicId,
  idx: 1,
  reps: 5,
  isBodyweight: false,
  isBand: false,
  quantities: [
    { slot: QUANTITY_SLOT.primary, dimension: UNIT_DIMENSION.mass, unit: 'lb', value: 135 },
  ],
  status: ENTRY_STATUS.done,
});
const bw = (publicId: string): SetDTO => ({
  ...loaded(publicId),
  isBodyweight: true,
  quantities: [],
});

const move = (o: Partial<EntryDTO>): EntryDTO =>
  ({
    id: 'e',
    kind: null,
    activityKey: ACTIVITY_TYPE_KEYS.sc_lift,
    activityLabel: 'S&C lift',
    metricKey: null,
    metricLabel: null,
    aggregation: null,
    unit: 'lb',
    value: null,
    movementName: 'Back squat',
    status: ENTRY_STATUS.done,
    sessionId: 's1',
    sessionType: DEFAULT_SESSION_TYPE,
    sessionDayRole: 'strength_a',
    sessionFeel: null,
    supersetId: null,
    supersetOrder: null,
    sets: [loaded('set-a')],
    ...o,
  }) as EntryDTO;

const sessionsOf = (entries: EntryDTO[]) =>
  todayRows(entries).filter((r): r is SessionRow => r.kind === 'session');

const ONE = sessionsOf([
  move({ id: 'a', movementName: 'Back squat' }),
  move({ id: 'b', movementName: 'Push-Ups', sets: [bw('set-b1'), bw('set-b2')] }),
  move({ id: 'c', movementName: 'Pull-Up', sets: [bw('set-c1')] }),
  move({ id: 'd', movementName: 'Rows', status: ENTRY_STATUS.skipped, sets: [] }),
])[0]!;

describe('StrengthSessionReceipt — one renderer, two placements (V1-24 3a-ii)', () => {
  it('section: focusable by its id, says Saved, counts honestly, no checkmark', () => {
    render(<StrengthSessionReceipt row={ONE} profileId="p1" placement="section" />);
    const card = document.getElementById(strengthReceiptId('s1'))!;
    expect(card.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(
      `${DAY_ROLE_LABELS.strength_a} session`,
    );
    expect(card.textContent).toContain(STRENGTH_COPY.saved);
    expect(card.textContent).toContain('4 movements');
    expect(card.textContent).toContain('1 skipped');
    expect(card.textContent).not.toMatch(/✓|✔/);
  });

  it('section: ONE Locked line for the session, naming its movements, recovery once', () => {
    render(<StrengthSessionReceipt row={ONE} profileId="p1" placement="section" />);
    const lines = screen.getAllByText((t) => t.includes(AMEND_COPY.lockedRecovery));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toContain('(Push-Ups, Pull-Up)');
  });

  it('list beside the section: no ids, no Change (the section owns it)', () => {
    render(<StrengthSessionReceipt row={ONE} profileId="p1" placement="list" editable={false} />);
    expect(document.getElementById(strengthReceiptId('s1'))).toBeNull();
    expect(screen.queryByRole('button', { name: /^Change/ })).toBeNull();
    expect(screen.queryByText(STRENGTH_COPY.saved, { exact: false })).toBeNull();
  });

  it('list with no strength section: keeps Change (it is the only surface)', () => {
    render(<StrengthSessionReceipt row={ONE} profileId="p1" placement="list" />);
    expect(screen.getAllByRole('button', { name: /^Change/ })).toHaveLength(1);
  });

  it('a second session of the same role is numbered inside the h3', () => {
    const two = sessionsOf([
      move({ id: 'a', sessionId: 's1' }),
      move({ id: 'b', sessionId: 's2', movementName: 'Rows' }),
    ]);
    const ordinals = sessionOrdinals(two);
    render(
      <StrengthSessionReceipt
        row={two[1]!}
        profileId="p1"
        placement="section"
        ordinal={ordinals.get('s2')}
      />,
    );
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(
      `${DAY_ROLE_LABELS.strength_a} session 2`,
    );
  });
});
