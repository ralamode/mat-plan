import {
  ACTIVITY_TYPE_KEYS,
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
    aggregation: null,
    activityKey: null,
    activityLabel: null,
    sessionId: null,
    sessionType: null,
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

  // ── V1-5 ────────────────────────────────────────────────────────────────────
  //
  // REGRESSION GUARD for the shape real rows actually have. Migration 0002 step 4a
  // backfilled `metric_key='bodyweight'` onto every legacy bodyweight row AND gave it
  // an activity_type, so a live weigh-in carries BOTH a metricKey and an activityLabel
  // ('Weigh-in'). The metric branch must keep winning — if the new activity branch ever
  // shadowed it, the Today view and the e2e would silently render 'Weigh-in'.
  it('keeps rendering the metric label when an entry also carries an activity label', () => {
    expect(
      entryLabel(
        entry({
          metricKey: SEED_METRIC_KEYS.bodyweight,
          metricLabel: BODYWEIGHT_SEED.label,
          valueType: 'number',
          value: 72.5,
          unit: 'lb',
          activityKey: 'weigh_in',
          activityLabel: 'Weigh-in',
        }),
      ),
    ).toBe('Bodyweight — 72.5 lb');
  });

  it('renders a bool check-in metric as the bare metric label', () => {
    expect(
      entryLabel(
        entry({
          kind: null,
          metricKey: 'stance',
          metricLabel: 'Stance',
          valueType: 'bool',
          value: 1,
          unit: 'bool',
          activityKey: 'brush_teeth',
          activityLabel: 'Brush teeth',
        }),
      ),
    ).toBe('Stance');
  });

  it('renders a scale_10 check-in as a rating, not as its storage unit', () => {
    expect(
      entryLabel(
        entry({
          kind: null,
          metricKey: 'pressure',
          metricLabel: 'Pressure',
          valueType: 'scale_10',
          value: 7,
          unit: 'count', // seeded unit is `count`; the label must NOT say "7 count"
          activityKey: 'brush_teeth',
          activityLabel: 'Brush teeth',
        }),
      ),
    ).toBe('Pressure — 7/10');
  });

  it('renders a bare habit (neither metric nor movement) as its activity label', () => {
    expect(
      entryLabel(
        entry({
          kind: null,
          metricKey: null,
          movementName: null,
          value: 1,
          unit: 'bool',
          activityKey: 'rice_bucket',
          activityLabel: 'Rice bucket',
        }),
      ),
    ).toBe('Rice bucket');
  });

  // ── V1-7 ────────────────────────────────────────────────────────────────────
  // Wake is a timing "neither-source" event: value_num is local minutes-since-midnight,
  // rendered as a clock. It must be caught by the activityKey branch BEFORE the bare-habit
  // branch (both are metricKey/movement-null) — else it renders "Wake" with no time.
  it('renders a wake event as its activity label + the local clock (from value_num minutes)', () => {
    expect(
      entryLabel(
        entry({
          kind: null,
          metricKey: null,
          movementName: null,
          value: 412, // 06:52 local
          unit: 'timing',
          activityKey: ACTIVITY_TYPE_KEYS.wake,
          activityLabel: 'Wake',
        }),
      ),
    ).toBe('Wake — 6:52 AM');
  });

  it('renders a wake event with no value as the bare activity label', () => {
    expect(
      entryLabel(
        entry({
          kind: null,
          value: null,
          activityKey: ACTIVITY_TYPE_KEYS.wake,
          activityLabel: 'Wake',
        }),
      ),
    ).toBe('Wake');
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
