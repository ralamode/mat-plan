import {
  DAY_ROLE_TO_SESSION_TYPE,
  DAY_ROLES,
  dayRoleSchema,
  movementSlug,
  PROGRAM_SEED,
  prescriptionSeedRowSchema,
  programBlockSeedRowSchema,
  SESSION_TYPES,
  sessionTypeSchema,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

// V1-10 shared programming contract. Lives in the WEB test tree (like routine/contract.test.ts): the shared
// package has no vitest runner — its logic is proven from apps/web's suite, which CI runs.

describe('DAY_ROLES — a superset of SESSION_TYPES plus the strength split', () => {
  it('contains every SESSION_TYPE and the two split strength days', () => {
    for (const s of SESSION_TYPES) expect(DAY_ROLES).toContain(s);
    expect(DAY_ROLES).toContain('strength_a');
    expect(DAY_ROLES).toContain('strength_b');
  });

  it('dayRoleSchema accepts a day role and rejects a non-role', () => {
    expect(dayRoleSchema.safeParse('strength_a').success).toBe(true);
    expect(dayRoleSchema.safeParse('push').success).toBe(true);
    expect(dayRoleSchema.safeParse('not_a_role').success).toBe(false);
  });
});

describe('DAY_ROLE_TO_SESSION_TYPE — every day role maps to a valid session type', () => {
  it('is exhaustive over DAY_ROLES and maps to real session types', () => {
    for (const role of DAY_ROLES) {
      const sessionType = DAY_ROLE_TO_SESSION_TYPE[role];
      expect(sessionType).toBeDefined();
      expect(sessionTypeSchema.safeParse(sessionType).success).toBe(true);
    }
  });

  it('folds the split strength days to strength; other roles map 1:1', () => {
    expect(DAY_ROLE_TO_SESSION_TYPE.strength_a).toBe('strength');
    expect(DAY_ROLE_TO_SESSION_TYPE.strength_b).toBe('strength');
    for (const s of SESSION_TYPES) expect(DAY_ROLE_TO_SESSION_TYPE[s]).toBe(s);
  });
});

describe('seed-row schemas', () => {
  const goodPrescription = {
    dayRole: 'strength',
    movementSlug: 'front_squat',
    idx: 0,
    sets: 3,
    targetReps: '5',
    targets: [{ profilePublicId: 'p1', load: '65' }],
  };

  it('accepts a well-formed block → prescription → target graph', () => {
    const block = {
      householdPublicId: 'hh1',
      slug: 'strength_a',
      name: 'Strength A',
      notes: null,
      prescriptions: [goodPrescription],
    };
    expect(programBlockSeedRowSchema.safeParse(block).success).toBe(true);
  });

  it('rejects a negative idx, a non-positive set count, and a bad day role', () => {
    expect(prescriptionSeedRowSchema.safeParse({ ...goodPrescription, idx: -1 }).success).toBe(
      false,
    );
    expect(prescriptionSeedRowSchema.safeParse({ ...goodPrescription, sets: 0 }).success).toBe(
      false,
    );
    expect(
      prescriptionSeedRowSchema.safeParse({ ...goodPrescription, dayRole: 'nope' }).success,
    ).toBe(false);
  });

  it('allows a null load and null sets/target_reps (movement-only prescription)', () => {
    expect(
      prescriptionSeedRowSchema.safeParse({
        ...goodPrescription,
        sets: null,
        targetReps: null,
        targets: [{ profilePublicId: 'p1', load: null }],
      }).success,
    ).toBe(true);
  });
});

describe('PROGRAM_SEED — ships empty, and stays authoring-consistent when it grows', () => {
  it('ships EMPTY in slice 1 (mechanism only; real blocks are a later data PR)', () => {
    expect(PROGRAM_SEED).toHaveLength(0);
  });

  // Guards the future data-only PR (vacuous while empty): the DB seed is INSERT-ONLY via onConflictDoNothing,
  // so an authoring mistake — a slug that doesn't match its name, a duplicate (day_role, idx) slot, or a
  // repeated profile in one prescription's targets — would be silently swallowed at seed time. Catch it here.
  it('every block slug equals movementSlug(name)', () => {
    for (const block of PROGRAM_SEED) {
      expect(block.slug).toBe(movementSlug(block.name));
    }
  });

  it('no duplicate (day_role, idx) slot within a block, and no repeated profile within a prescription', () => {
    for (const block of PROGRAM_SEED) {
      const slots = block.prescriptions.map((p) => `${p.dayRole}#${p.idx}`);
      expect(new Set(slots).size).toBe(slots.length);
      for (const p of block.prescriptions) {
        const profiles = p.targets.map((t) => t.profilePublicId);
        expect(new Set(profiles).size).toBe(profiles.length);
      }
    }
  });
});
