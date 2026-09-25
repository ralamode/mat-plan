import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EVENTS } from './registry';
import { dualsEventSchema } from './schema';

describe('registry', () => {
  /**
   * The "drop in a JSON" workflow (D6) relies on an explicit import list, so the
   * failure mode is forgetting the line. Catch it here rather than with a 404 in
   * a gym.
   */
  it('registers every event JSON in events/', () => {
    const dir = join(import.meta.dirname, 'events');
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();

    expect([...EVENTS].map((e) => e.slug).sort()).toEqual(onDisk);
  });

  it('rejects an event whose round points at an unknown team', () => {
    const broken = {
      slug: 'x',
      name: 'X',
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      source: { name: 'S', url: 'https://example.com' },
      capturedAt: '2026-01-01',
      notes: [],
      teams: [{ id: 't1', slug: 't1', name: 'T1', roster: [] }],
      entries: [
        {
          teamId: 't1',
          division: 'D',
          pool: 'P',
          rounds: [{ round: 1, opponentId: 'ghost', mat: null }],
        },
      ],
    };

    const result = dualsEventSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('unknown opponentId');
  });

  it('rejects duplicate round numbers for one team', () => {
    const broken = {
      slug: 'x',
      name: 'X',
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      source: { name: 'S', url: 'https://example.com' },
      capturedAt: '2026-01-01',
      notes: [],
      teams: [{ id: 't1', slug: 't1', name: 'T1', roster: [] }],
      entries: [
        {
          teamId: 't1',
          division: 'D',
          pool: 'P',
          rounds: [
            { round: 1, opponentId: null, mat: null },
            { round: 1, opponentId: null, mat: null },
          ],
        },
      ],
    };

    expect(dualsEventSchema.safeParse(broken).success).toBe(false);
  });
});
