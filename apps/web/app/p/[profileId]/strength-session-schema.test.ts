import { logStrengthSessionSchema, newId } from '@mat-plan/shared';
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

  it('rejects a supersetOrder without a supersetClientId (the pairing invariant)', () => {
    const res = logStrengthSessionSchema.safeParse(
      base({
        movements: [move({ clientId: newId(), supersetOrder: 5 })], // order, no group
      }),
    );
    expect(res.success).toBe(false);
  });
});
