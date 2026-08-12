import { logStrengthSessionSchema, movementSlug, newId } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

// The shared `logStrengthSessionSchema` superRefine is the write-path trust boundary for supersets
// (V1-8-3c). `packages/shared` has no test runner, so its contract is pinned here (apps/web imports it
// and runs in CI). The app doesn't forward `supersets[]` until 3d, so several of these are only
// reachable via a direct/crafted body — exactly what the boundary guards.

const move = (o: {
  clientId: string;
  supersetClientId?: string;
  supersetOrder?: number;
}): Record<string, unknown> => ({
  movementName: 'Back squat',
  unit: 'lb',
  clientId: o.clientId,
  sets: [{ reps: 5, weight: 135 }],
  ...(o.supersetClientId !== undefined ? { supersetClientId: o.supersetClientId } : {}),
  ...(o.supersetOrder !== undefined ? { supersetOrder: o.supersetOrder } : {}),
});

const base = (extra: Record<string, unknown>) => ({
  profileId: newId(),
  clientId: newId(),
  ...extra,
});

describe('logStrengthSessionSchema — superset validation (V1-8-3c)', () => {
  it('accepts a valid 2-movement superset', () => {
    const ss = newId();
    const res = logStrengthSessionSchema.safeParse(
      base({
        supersets: [{ clientId: ss }],
        movements: [
          move({ clientId: newId(), supersetClientId: ss, supersetOrder: 1 }),
          move({ clientId: newId(), supersetClientId: ss, supersetOrder: 2 }),
        ],
      }),
    );
    expect(res.success).toBe(true);
  });

  it('accepts a flat session (no supersets) — the common path is unaffected', () => {
    const res = logStrengthSessionSchema.safeParse(
      base({ movements: [move({ clientId: newId() })] }),
    );
    expect(res.success).toBe(true);
  });

  it('rejects a superset with fewer than 2 members', () => {
    const ss = newId();
    const res = logStrengthSessionSchema.safeParse(
      base({
        supersets: [{ clientId: ss }],
        movements: [
          move({ clientId: newId(), supersetClientId: ss, supersetOrder: 1 }),
          move({ clientId: newId() }), // standalone → the superset has only 1 member
        ],
      }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects a 0-member superset (a supersets[] entry no movement references)', () => {
    const res = logStrengthSessionSchema.safeParse(
      base({
        supersets: [{ clientId: newId() }], // orphan
        movements: [move({ clientId: newId() }), move({ clientId: newId() })],
      }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects a movement referencing an undefined superset (dangling membership)', () => {
    const res = logStrengthSessionSchema.safeParse(
      base({
        supersets: [{ clientId: newId() }],
        movements: [
          move({ clientId: newId(), supersetClientId: newId(), supersetOrder: 1 }), // not in supersets[]
          move({ clientId: newId(), supersetClientId: newId(), supersetOrder: 2 }),
        ],
      }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects duplicate superset client ids (would silently merge two groups)', () => {
    const ss = newId();
    const res = logStrengthSessionSchema.safeParse(
      base({
        supersets: [{ clientId: ss }, { clientId: ss }],
        movements: [
          move({ clientId: newId(), supersetClientId: ss, supersetOrder: 1 }),
          move({ clientId: newId(), supersetClientId: ss, supersetOrder: 2 }),
        ],
      }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects duplicate orders within a superset (would hit the DB UNIQUE as a raw 500)', () => {
    const ss = newId();
    const res = logStrengthSessionSchema.safeParse(
      base({
        supersets: [{ clientId: ss }],
        movements: [
          move({ clientId: newId(), supersetClientId: ss, supersetOrder: 1 }),
          move({ clientId: newId(), supersetClientId: ss, supersetOrder: 1 }), // dup slot
        ],
      }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects a supersetOrder without a supersetClientId (the pairing invariant)', () => {
    const res = logStrengthSessionSchema.safeParse(
      base({
        movements: [move({ clientId: newId(), supersetOrder: 5 })], // order, no group
      }),
    );
    expect(res.success).toBe(false);
  });
});

// GAP-1 P2-2 / P2-3 — the CSV joins fields RAW (deliberately not RFC-4180), so a comma shifts every
// downstream field in a row and a CR/LF splits the record. Guarded at the write boundary, which is the
// same call `parseLoad` already makes for the load field.
describe('logStrengthSessionSchema — CSV-unsafe input is rejected at the boundary (GAP-1 P2-2)', () => {
  const withName = (movementName: string) =>
    logStrengthSessionSchema.safeParse(
      base({ movements: [{ ...move({ clientId: newId() }), movementName }] }),
    );

  it.each([
    ['a comma', 'Bench, Close Grip'],
    ['a newline', 'Bench\nPress'],
    ['a carriage return', 'Bench\rPress'],
  ])('rejects a movement name containing %s', (_label, name) => {
    expect(withName(name).success).toBe(false);
  });

  it('ALLOWS a double-quote — `30" Box Jump` is real, and the files carry bare inch marks', () => {
    expect(withName('30" Box Jump').success).toBe(true);
  });

  it('leaves an ordinary movement name untouched', () => {
    const res = withName('Close-Grip Bench');
    expect(res.success).toBe(true);
    expect(res.success && res.data.movements[0]!.movementName).toBe('Close-Grip Bench');
  });

  // The decision, made executable. `movementSlug` is a PERSISTED natural key: its derivation is inlined
  // as SQL in applied, forward-only migration 0002, so changing it would leave existing rows on the old
  // slug, stop `ON CONFLICT (slug)` firing, and split one movement's history across two `movements`
  // rows — which `db:verify` check 6 would NOT catch (it iterates MOVEMENT_SEED_ROWS, not DB rows).
  // Sanitising the slug also fixes NOTHING: the raw name is persisted verbatim in `movements.name` and
  // `entries.movement_name`, and the CSV `movement` column is kebab-rendered, not the (snake) slug.
  // See docs/csv-recording-gaps.md P2-2 before changing this.
  it('does NOT sanitise the slug — the guard is at the name boundary, not the derivation', () => {
    expect(movementSlug('Bench, Close Grip')).toBe('bench,_close_grip');
  });
});

describe('freeTextNoteSchema via `feel` — single-line, but commas are fine (GAP-1 P2-3)', () => {
  const withFeel = (feel: string) =>
    logStrengthSessionSchema.safeParse(base({ feel, movements: [move({ clientId: newId() })] }));

  it('rejects an INTERIOR newline — it would split the record', () => {
    expect(withFeel('felt strong\nback tight').success).toBe(false);
  });

  it('ALLOWS a comma — the contract quotes a comma-bearing note on export instead', () => {
    expect(withFeel('felt strong, back tight').success).toBe(true);
  });

  it('still maps a blank/whitespace-only note to undefined (the transform survives the refine)', () => {
    const res = withFeel('   ');
    expect(res.success).toBe(true);
    expect(res.success && res.data.feel).toBeUndefined();
  });

  it('trims a LEADING/TRAILING newline rather than rejecting it', () => {
    const res = withFeel('\nfelt strong\n');
    expect(res.success).toBe(true);
    expect(res.success && res.data.feel).toBe('felt strong');
  });
});
