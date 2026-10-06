import {
  BLANK_SET_MESSAGE,
  ENTRY_STATUS,
  ENTRY_STATUSES,
  LOGGABLE_DIMENSION_NOUNS,
  logStrengthSessionSchema,
  modeNotApplicableBlankMessage,
  modeNotApplicableMessage,
  MOVEMENT_STATUSES,
  movementSlug,
  newId,
  type Unit,
  UNIT_CODES,
  UNIT_DIMENSION_BY_CODE,
  LOGGABLE_UNITS,
  numberTooHighMessage,
  UNIT_LABELS,
  quantityCeiling,
} from '@mat-plan/shared';
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

// GAP-1 P1-1a — a movement can be logged as SKIPPED, carrying zero sets. The `≥1 set` rule moved off
// `sessionMovementSchema.sets` into the session-level superRefine because it is now cross-field with
// `status`; these pin both directions AND the issue PATH, since the path is what keeps the rendered
// "Movement N: …" string identical (actions.ts keys on a numeric path[1]).
describe('logStrengthSessionSchema — skipped movements (GAP-1 P1-1a)', () => {
  const withMovement = (extra: Record<string, unknown>) =>
    logStrengthSessionSchema.safeParse(
      base({ movements: [{ ...move({ clientId: newId() }), ...extra }] }),
    );

  it('accepts status: skipped with ZERO sets', () => {
    const res = withMovement({ status: ENTRY_STATUS.skipped, sets: [] });
    expect(res.success).toBe(true);
    expect(res.success && res.data.movements[0]!.status).toBe(ENTRY_STATUS.skipped);
    expect(res.success && res.data.movements[0]!.sets).toEqual([]);
  });

  it('defaults an omitted status to done (the byte-identical existing path)', () => {
    const res = withMovement({});
    expect(res.success).toBe(true);
    expect(res.success && res.data.movements[0]!.status).toBe(ENTRY_STATUS.done);
  });

  it('still REJECTS an ordinary movement with zero sets — at path ["movements", 0]', () => {
    const res = withMovement({ sets: [] });
    expect(res.success).toBe(false);
    const issue =
      !res.success && res.error.issues.find((i) => i.message === 'Add at least one set.');
    expect(issue).toBeTruthy();
    // The path is the contract with actions.ts: a numeric path[1] is what renders "Movement 1: …".
    expect(issue && issue.path).toEqual(['movements', 0]);
    expect(issue && typeof issue.path[1]).toBe('number');
  });

  it('rejects a SKIPPED movement that still carries sets (the crafted-body converse)', () => {
    const res = withMovement({ status: ENTRY_STATUS.skipped });
    expect(res.success).toBe(false);
  });

  it('rejects sub_failure as a MOVEMENT status — it is a set-level observation (P1-1b)', () => {
    const res = withMovement({ status: ENTRY_STATUS.sub_failure, sets: [] });
    expect(res.success).toBe(false);
  });

  it('leaves an ordinary 1-set done movement parsing exactly as before', () => {
    const res = withMovement({});
    expect(res.success).toBe(true);
    expect(res.success && res.data.movements[0]!.sets).toEqual([{ reps: 5, weight: 135 }]);
  });

  // GAP-1 P1-1c (D5). `dissolveSmallSupersets` counts MEMBERSHIP, not sets, and the ≥2-member refine
  // does the same — so a zero-set skipped member is a coherent group member and parses. That is the
  // intended behaviour (a skipped member is still part of the group the athlete programmed), pinned
  // here rather than left to fall out. The alternative — stripping tags on skip — would need the
  // toggle handler to re-run dissolveSmallSupersets, or the surviving partner hits the ≥2 refine alone
  // and submit dies with an unrecoverable-looking error caused by a skip tap.
  it('accepts a SKIPPED, zero-set movement that is still a superset member', () => {
    const ss = newId();
    const res = logStrengthSessionSchema.safeParse(
      base({
        supersets: [{ clientId: ss }],
        movements: [
          {
            ...move({ clientId: newId(), supersetClientId: ss, supersetOrder: 1 }),
            status: ENTRY_STATUS.skipped,
            sets: [],
          },
          move({ clientId: newId(), supersetClientId: ss, supersetOrder: 2 }),
        ],
      }),
    );
    expect(res.success).toBe(true);
  });

  it('MOVEMENT_STATUSES is a strict subset of ENTRY_STATUSES', () => {
    expect(ENTRY_STATUSES).toEqual(expect.arrayContaining([...MOVEMENT_STATUSES]));
    expect(MOVEMENT_STATUSES).not.toContain(ENTRY_STATUS.sub_failure);
  });
});

describe('logStrengthSessionSchema — every loggable unit is accepted (V1-30)', () => {
  // Built from the shared lists, never re-typed (AGENTS.md → constants). The one literal pin of the
  // non-loggable set lives next to the chain test in packages/shared/src/units.test.ts.
  const NON_LOGGABLE = UNIT_CODES.filter((u) => !LOGGABLE_UNITS.includes(u));
  const oneMovement = (unit: string, set: Record<string, unknown>) =>
    base({ movements: [{ ...move({ clientId: newId() }), unit, sets: [set] }] });

  it.each(LOGGABLE_UNITS)('accepts a movement logged in %s', (unit) => {
    const res = logStrengthSessionSchema.safeParse(oneMovement(unit, { reps: 1, weight: '30' }));
    expect(res.success).toBe(true);
  });

  it.each([...NON_LOGGABLE, 'furlong'])('rejects a movement logged in %s', (unit) => {
    const res = logStrengthSessionSchema.safeParse(oneMovement(unit, { reps: 1, weight: '30' }));
    expect(res.success).toBe(false);
  });
});

describe('logStrengthSessionSchema — a time or distance set carries its number, never a mode (V1-30)', () => {
  const issuesFor = (unit: Unit, set: Record<string, unknown>) => {
    const res = logStrengthSessionSchema.safeParse(
      base({ movements: [{ ...move({ clientId: newId() }), unit, sets: [set] }] }),
    );
    return res.success ? [] : res.error.issues;
  };

  it('accepts 30 sec', () => {
    expect(issuesFor('sec', { reps: 1, weight: '30' })).toEqual([]);
  });

  it.each<[Unit, Record<string, unknown>, typeof modeNotApplicableMessage]>([
    ['sec', { reps: 3, isBodyweight: true }, modeNotApplicableBlankMessage],
    ['sec', { reps: 3, isBodyweight: true, weight: '30' }, modeNotApplicableMessage],
    ['m', { reps: 3, isBand: true }, modeNotApplicableBlankMessage],
  ])('rejects %s with %o — exactly one message, on the set', (unit, set, message) => {
    const issues = issuesFor(unit, set);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['movements', 0, 'sets', 0, 'weight'],
      message: message(LOGGABLE_DIMENSION_NOUNS[UNIT_DIMENSION_BY_CODE[unit]]!),
    });
  });

  it('a blank time set gets exactly one message (the set check’s), with no BW advice', () => {
    const issues = issuesFor('sec', { reps: 3 });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe(BLANK_SET_MESSAGE);
  });

  it('BW alone is still a valid MASS set', () => {
    expect(issuesFor('lb', { reps: 10, isBodyweight: true })).toEqual([]);
  });
});

/**
 * V1-30b-ii — the stored-value ceiling is PER UNIT and lives here, because this is the only place the
 * unit is known. The shared `> 2000` it replaces refused a real `3219 m` run and a `2400 sec` hold,
 * while letting a 2-mile run typed into Inches straight through.
 */
describe('logStrengthSessionSchema — the per-unit ceiling (V1-30b-ii)', () => {
  const withSet = (unit: Unit, weight: unknown) =>
    logStrengthSessionSchema.safeParse(
      base({
        movements: [
          { movementName: 'Thing', unit, clientId: newId(), sets: [{ reps: 1, weight }] },
        ],
      }),
    );
  const messages = (r: ReturnType<typeof withSet>) =>
    r.success ? [] : r.error.issues.map((i) => i.message);

  it('accepts the real numbers the shared 2000 cap used to refuse', () => {
    expect(withSet('m', 3219).success).toBe(true); // a 2-mile run, in metres
    expect(withSet('sec', 2400).success).toBe(true); // a 40-minute hold
    expect(withSet('in', 100).success).toBe(true);
  });

  it('refuses what the shared cap could not catch — the same number in the wrong unit', () => {
    // 3219 is a real distance in metres and an absurd one in inches. Only the unit tells them apart.
    expect(withSet('in', 3219).success).toBe(false);
    // The copy now NAMES the unit, so a `2001 lb` typo is not sent to a Unit select where nothing
    // is wrong. Asserted through the exported function, not a re-typed sentence.
    expect(messages(withSet('in', 3219))).toContain(numberTooHighMessage('inches'));
    // Derived, not re-typed: a hand-written `10_001` would still assert `false` if the map were
    // RAISED, and would pass while the boundary moved if it were lowered.
    for (const u of ['m', 'sec', 'kg', 'lb'] as const) {
      expect(withSet(u, quantityCeiling(u)! + 1).success, `${u} over its ceiling`).toBe(false);
      expect(withSet(u, quantityCeiling(u)!).success, `${u} AT its ceiling`).toBe(true);
    }
  });

  it('reports ONE fault when the format check also failed', () => {
    // The session refine runs even after a set's format check fails, and then `weight` is the raw
    // STRING. Without the typeof guard this would stack "too high" on "Enter a plain number".
    const msgs = messages(withSet('lb', '99999.1234'));
    expect(msgs.filter((m) => m === numberTooHighMessage('pounds'))).toHaveLength(0);
    expect(msgs.some((m) => /plain number/.test(m))).toBe(true);
  });

  it('puts the issue on the set’s weight path, so the action can name the movement and set', () => {
    const r = withSet('lb', 2001);
    const issue = r.success
      ? undefined
      : r.error.issues.find((i) => i.message === numberTooHighMessage('pounds'));
    expect(issue?.path).toEqual(['movements', 0, 'sets', 0, 'weight']);
  });

  // ⚠️ The boundary. Without this, `>` → `>=` survives the ENTIRE suite: every accept case sits far
  // below its cap, so nothing pins the edge, and four of the nine units had no ceiling case at all.
  // Proved by mutation: the off-by-one refuses every unit's legitimate maximum, silently.
  it.each([...LOGGABLE_UNITS])('%s accepts exactly its cap and refuses one step more', (u) => {
    const cap = quantityCeiling(u)!;
    expect(withSet(u, cap).success, `${u} AT its cap`).toBe(true);
    expect(messages(withSet(u, cap + 0.001))).toContain(
      numberTooHighMessage(UNIT_LABELS[u].toLowerCase()),
    );
  });

  it('a unit with no declared cap cannot reach the ceiling at all — TWO independent guards', () => {
    // ⚠️ Mutation-tested and corrected: an earlier version of this case asserted that a `count` set
    // is refused and called that proof of the `ceiling === undefined` branch. It is not — `count` is
    // not a LOGGABLE unit, so `loggableUnitSchema` refuses it long before the ceiling loop runs, and
    // the test passed for the wrong reason (swapping the guard for `?? Infinity` left it green).
    //
    // So the branch is unreachable by construction, behind two guards that ARE tested:
    expect(quantityCeiling('count' as Unit)).toBeUndefined(); // 1. no cap is declared for it
    expect(withSet('count' as Unit, 5).success).toBe(false); // 2. and the unit never parses anyway
    // …plus the completeness test below, which is what actually keeps the branch unreachable. The
    // `ceiling === undefined` check stays as defence in depth: `n > undefined` is false, so the
    // tempting `?? Infinity` spelling would silently disable the bound for a future unit that slips
    // past the completeness test.
  });

  // The completeness guard lives in `packages/shared/src/units.test.ts`, beside the map.
});
