import { ENTRY_STATUS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import {
  CHECKIN_CLIENT_ID_NOT_UUID,
  type CheckinInsertValue,
  writeCheckinEntries,
} from './checkin';
import type { Executor } from './executor';

/**
 * The check-in writer's precondition: a submit's `client_id`s are distinct once folded to lower case
 * (plan `v1-9b-checkin-distinct-ids.md`). ⚠️ **This is the tier that can prove "no statement was
 * issued"**: the executor below throws on ANY use, so a writer that inserted first and refused after
 * fails here with the executor's message, not the precondition's.
 */
const untouched = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`the executor was used (${String(property)})`);
    },
  },
) as Executor;

const item = (clientId: string): CheckinInsertValue => ({
  publicId: '019826b4-0000-7000-8000-0000000000a1',
  clientId,
  activityDate: '2026-11-19',
  unit: 'count',
  valueNum: '1',
  activityTypeId: 1,
  metricKey: null,
  status: ENTRY_STATUS.done,
});

const ID = '019826b4-0000-7000-8000-00000000abcd';

describe('writeCheckinEntries — a repeated client_id', () => {
  it.each([
    ['in the same case', ID],
    ['differing only in case', ID.toUpperCase()],
  ])('refuses two items sharing an id %s, before any statement', async (_label, twin) => {
    await expect(
      writeCheckinEntries(untouched, { profileId: 1, values: [item(ID), item(twin)] }),
    ).rejects.toThrow('check-in client_ids repeat within one submit');
  });
});

describe('writeCheckinEntries — an id in another spelling', () => {
  // Postgres reads the first two as the same uuid and prints it hyphenated, so the classifier would
  // miss them; the third is hyphenated but its variant digit is outside RFC 9562, which zod refuses.
  it.each([
    ['in braces', `{${ID}}`],
    ['without hyphens', ID.replaceAll('-', '')],
    ['with a non-RFC variant digit', `${ID.slice(0, 19)}c${ID.slice(20)}`],
  ])('refuses an id %s, before any statement', async (_label, spelling) => {
    await expect(
      writeCheckinEntries(untouched, { profileId: 1, values: [item(spelling)] }),
    ).rejects.toThrow(CHECKIN_CLIENT_ID_NOT_UUID);
  });
});
