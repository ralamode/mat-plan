import {
  CATALOG_METRIC_DEFINITION_SEED_ROWS,
  ENTRY_KIND,
  ENTRY_STATUS,
  SEED_METRIC_KEYS,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import type { EntryDTO } from '@/lib/dal/entries';

import { entryLabel } from './entry-label';

// The canonical bodyweight metric_definition seed row (single source in
// packages/shared). Deriving the fixture's label from it means a seed rename flips
// these assertions instead of silently drifting from a re-typed literal.
const BODYWEIGHT_SEED = CATALOG_METRIC_DEFINITION_SEED_ROWS.find(
  (r) => r.key === SEED_METRIC_KEYS.bodyweight,
)!;

/** Minimal valid EntryDTO; each case overrides only the discriminant fields it needs. */
function entry(overrides: Partial<EntryDTO>): EntryDTO {
  return {
    id: 'entry-public-id',
    kind: ENTRY_KIND.bodyweight,
    unit: 'lb',
    movementName: null,
    value: null,
    status: ENTRY_STATUS.done,
    notes: null,
    metricKey: null,
    metricLabel: null,
    valueType: null,
    sets: [],
    ...overrides,
  };
}

describe('entryLabel', () => {
  it('renders a generalized bodyweight metric entry with its value + unit', () => {
    expect(
      entryLabel(
        entry({
          metricKey: SEED_METRIC_KEYS.bodyweight,
          metricLabel: BODYWEIGHT_SEED.label,
          valueType: 'number',
          value: 72.5,
          unit: 'lb',
        }),
      ),
    ).toBe('Bodyweight — 72.5 lb');
  });

  it('renders a generalized bodyweight metric entry with no value as the bare label', () => {
    expect(
      entryLabel(
        entry({
          metricKey: SEED_METRIC_KEYS.bodyweight,
          metricLabel: BODYWEIGHT_SEED.label,
          valueType: 'number',
          value: null,
        }),
      ),
    ).toBe('Bodyweight');
  });

  it('renders a legacy (metric_key IS NULL) bodyweight row via the fallback', () => {
    expect(
      entryLabel(
        entry({
          metricKey: null,
          kind: ENTRY_KIND.bodyweight,
          value: 80,
          unit: 'kg',
        }),
      ),
    ).toBe('Bodyweight — 80 kg');
  });

  it('renders a strength entry as its movement name', () => {
    expect(
      entryLabel(
        entry({
          metricKey: null,
          kind: ENTRY_KIND.strength,
          movementName: 'Back squat',
        }),
      ),
    ).toBe('Back squat');
  });

  it('renders a strength entry with no movement name as "Strength"', () => {
    expect(
      entryLabel(
        entry({
          metricKey: null,
          kind: ENTRY_KIND.strength,
          movementName: null,
        }),
      ),
    ).toBe('Strength');
  });
});

// Required contract test (adversarial-panel MAJOR): the seeded `bodyweight`
// metric_definition's label is pinned to 'Bodyweight' at the canonical shared
// source. A rename there is intentional-only — it must update this assertion,
// which in turn is what the entryLabel fixtures above derive from. Lives under
// apps/web so the required root `test` job (pnpm --filter web) runs it.
describe('bodyweight metric_definition seed contract', () => {
  it('pins the canonical bodyweight label to "Bodyweight"', () => {
    expect(BODYWEIGHT_SEED.label).toBe('Bodyweight');
  });
});
