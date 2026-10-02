// @vitest-environment jsdom
import {
  ACTIVITY_TYPE_KEYS,
  DEFAULT_SESSION_TYPE,
  ENTRY_STATUS,
  QUANTITY_SLOT,
  UNIT_DIMENSION,
} from '@mat-plan/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ editStrengthSetAction: vi.fn(), logStrengthSessionAction: vi.fn() }));

import { STRENGTH_COPY, strengthReceiptId } from '@/lib/constants';
import type { EntryDTO } from '@/lib/dal/entries';
import { todayRows, type SessionRow } from '@/lib/entries/activity-totals';

import { StrengthSection } from './strength-section';

afterEach(cleanup);

const session = todayRows([
  {
    id: 'a',
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
    sessionDayRole: null,
    sessionFeel: null,
    supersetId: null,
    supersetOrder: null,
    sets: [
      {
        publicId: 'set-a',
        idx: 1,
        reps: 5,
        isBodyweight: false,
        isBand: false,
        quantities: [
          { slot: QUANTITY_SLOT.primary, dimension: UNIT_DIMENSION.mass, unit: 'lb', value: 135 },
        ],
        status: ENTRY_STATUS.done,
      },
    ],
  } as EntryDTO,
]).filter((r): r is SessionRow => r.kind === 'session');

const section = (writable: boolean, sessions = session) => (
  <StrengthSection
    headingId="str-0"
    profileId="p1"
    day="2026-09-28"
    writable={writable}
    dayRole={null}
    programDay={[]}
    sessions={sessions}
  />
);

describe('StrengthSection (V1-24 3a-ii)', () => {
  it('a closed day: the receipt and its Change, but no form and no toggle', () => {
    render(section(false));
    expect(document.getElementById(strengthReceiptId('s1'))).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /^Change/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: STRENGTH_COPY.logMore })).toBeNull();
    expect(screen.queryByRole('button', { name: STRENGTH_COPY.submit })).toBeNull();
  });

  it('a writable day with a session: receipt first, then the collapsed toggle', () => {
    render(section(true));
    const receipt = document.getElementById(strengthReceiptId('s1'))!;
    const toggle = screen.getByRole('button', { name: STRENGTH_COPY.logMore });
    expect(receipt.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('a writable empty day: the form is open, with no toggle', () => {
    render(section(true, []));
    expect(screen.getByRole('button', { name: STRENGTH_COPY.submit })).toBeTruthy();
    expect(screen.queryByRole('button', { name: STRENGTH_COPY.logMore })).toBeNull();
  });
});
