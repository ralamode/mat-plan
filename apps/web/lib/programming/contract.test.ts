import {
  DAY_ROLE_LABELS,
  DAY_ROLE_TO_SESSION_TYPE,
  DAY_ROLES,
  dayRoleSchema,
  MOVEMENT_SEED_ROWS,
  movementSlug,
  PROGRAM_NAME_MAX,
  PROGRAM_SEED,
  prescriptionSeedRowSchema,
  programBlockSeedRowSchema,
  LEGACY_SESSION_TYPES,
  SESSION_TYPE,
  SESSION_TYPE_LABELS,
  sessionTypeSchema,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

// V1-10 shared programming contract. Lives in the WEB test tree (like routine/contract.test.ts): the shared
// package has no vitest runner — its logic is proven from apps/web's suite, which CI runs.

describe('DAY_ROLES — a superset of LEGACY_SESSION_TYPES plus the strength split', () => {
  it('contains every legacy session type and the two split strength days', () => {
    for (const s of LEGACY_SESSION_TYPES) expect(DAY_ROLES).toContain(s);
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
    for (const s of LEGACY_SESSION_TYPES) expect(DAY_ROLE_TO_SESSION_TYPE[s]).toBe(s);
  });
});

describe('DAY_ROLE_LABELS — derived from SESSION_TYPE_LABELS, never re-typed', () => {
  it('labels every day role', () => {
    for (const role of DAY_ROLES) {
      expect(DAY_ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it('distinguishes the split strength days (SESSION_TYPE_LABELS alone collapses them)', () => {
    expect(DAY_ROLE_LABELS.strength_a).toBe('Strength A');
    expect(DAY_ROLE_LABELS.strength_b).toBe('Strength B');
    expect(DAY_ROLE_LABELS.strength_c).toBe('Strength C');
    expect(new Set(DAY_ROLES.map((r) => DAY_ROLE_LABELS[r])).size).toBe(DAY_ROLES.length);
  });

  it('is the session-type label verbatim for a 1:1 role', () => {
    for (const s of LEGACY_SESSION_TYPES) expect(DAY_ROLE_LABELS[s]).toBe(SESSION_TYPE_LABELS[s]);
  });

  // FAM-1 D6: a template workout's session type is not a day role, so neither day_role CHECK widens.
  it("has no 'workout' role, although 'workout' is a session type with a label", () => {
    expect(sessionTypeSchema.safeParse(SESSION_TYPE.workout).success).toBe(true);
    expect(SESSION_TYPE_LABELS.workout).toBe('Workout');
    expect(dayRoleSchema.safeParse(SESSION_TYPE.workout).success).toBe(false);
    expect(Object.keys(DAY_ROLE_LABELS).sort()).toEqual([...DAY_ROLES].sort());
  });
});

describe('seed-row schemas', () => {
  const goodPrescription = {
    dayRole: 'strength',
    movementSlug: 'front_squat',
    idx: 0,
    sets: 3,
    targetReps: '5',
    targets: [{ profilePublicId: 'p1', load: '65', reps: null }],
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

  it("bounds a seed block's name as program_blocks_name_length_check does: blank and over-long refused", () => {
    const block = {
      householdPublicId: 'hh1',
      slug: 'strength_a',
      name: 'x'.repeat(PROGRAM_NAME_MAX),
      notes: null,
      prescriptions: [goodPrescription],
    };
    expect(programBlockSeedRowSchema.safeParse(block).success).toBe(true);
    expect(
      programBlockSeedRowSchema.safeParse({ ...block, name: 'x'.repeat(PROGRAM_NAME_MAX + 1) })
        .success,
    ).toBe(false);
    expect(programBlockSeedRowSchema.safeParse({ ...block, name: '   ' }).success).toBe(false);
    // The raw value, as the seed inserts it: padding that pushes it past the bound is refused too.
    expect(
      programBlockSeedRowSchema.safeParse({ ...block, name: ` ${'x'.repeat(PROGRAM_NAME_MAX)}` })
        .success,
    ).toBe(false);
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
        targets: [{ profilePublicId: 'p1', load: null, reps: null }],
      }).success,
    ).toBe(true);
  });
});

describe('PROGRAM_SEED — Ray’s real block, authoring-consistent', () => {
  it('is populated (the Youth Daily Program block)', () => {
    expect(PROGRAM_SEED.length).toBeGreaterThanOrEqual(1);
    // 2026-09-24: replaced `kids_s&c_foundation`, archived verbatim at
    // docs/programs/kids-sc-foundation-archived.md. Both cannot be active — programDayRows picks
    // the newest block per day-role, so seeding two would silently hijack one card with the other.
    expect(PROGRAM_SEED.some((b) => b.slug === 'youth_daily_program')).toBe(true);
    expect(PROGRAM_SEED.some((b) => b.slug === 'kids_s&c_foundation')).toBe(false);
  });

  it('programs BOTH day letters, so every calendar day has a card', () => {
    const roles = new Set(PROGRAM_SEED.flatMap((b) => b.prescriptions.map((p) => p.dayRole)));
    expect([...roles].sort()).toEqual(['strength_a', 'strength_b']);
  });

  it('prescribes no reps or loads except the one fixed movement', () => {
    // The paper sheet deliberately shows no goal numbers — "the absence of a target reduced the
    // 'I failed today' effect". Hip thrusts are the single exception (3 x 10 per side).
    const prescribed = PROGRAM_SEED.flatMap((b) => b.prescriptions).filter(
      (p) => p.sets !== null || p.targetReps !== null,
    );
    expect(prescribed.map((p) => p.movementSlug)).toEqual([
      'single-leg_hip_thrusts',
      'single-leg_hip_thrusts',
    ]);
    // And no authored loads anywhere — the LLM-never-authors-loads rule, and the sheet's own design.
    for (const p of PROGRAM_SEED.flatMap((b) => b.prescriptions)) {
      for (const t of p.targets) expect(t.load).toBeNull();
    }
  });

  it('validates against the seed-row schemas (every block, prescription, target)', () => {
    for (const block of PROGRAM_SEED) {
      expect(programBlockSeedRowSchema.safeParse(block).success).toBe(true);
    }
  });

  it('every prescription references a real catalog movement slug', () => {
    const slugs = new Set<string>(MOVEMENT_SEED_ROWS.map((m) => m.slug));
    for (const block of PROGRAM_SEED) {
      for (const p of block.prescriptions) {
        expect(slugs.has(p.movementSlug)).toBe(true);
      }
    }
  });

  // The DB seed is INSERT-ONLY via onConflictDoNothing, so an authoring mistake — a slug that doesn't match
  // its name, a duplicate (day_role, idx) slot, or a repeated profile in one prescription's targets — would
  // be silently swallowed at seed time. Catch it here instead.
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
