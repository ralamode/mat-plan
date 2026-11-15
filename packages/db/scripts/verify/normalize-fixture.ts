import { hiddenAtSchema, uuidSchema } from '@mat-plan/shared';

/**
 * The fixture normalizer for the both-sides fixture tests (FAM-1 step 0c;
 * `docs/plans/fam-1-family-program.md` §6 → "Fixtures are tested from both sides";
 * `docs/parallel-work.md` → "Once lanes run", 3).
 *
 * A data lane seeds the state a contract fixture describes, runs its query, and asserts the result
 * deep-equals the fixture. The database mints its own public ids and timestamps, so the two never
 * match as written. `normalizeFixture` rewrites a value so that only those two things are erased,
 * and **both sides go through it with the same options**:
 *
 * - **Every public id becomes a stable label**, `<id:1>`, `<id:2>`, …, numbered by first appearance.
 *   One id gets one label wherever it appears, so identity survives: a row that points at the wrong
 *   prescription gets a different label and the comparison fails. "Is a public id" is the shared
 *   `uuidSchema`, the same definition the input schemas use. ⚠️ An id is labelled ONLY if it passes
 *   that schema (zod's `z.uuid()`: version nibble 1 to 8, variant 8, 9, a or b), so a contract
 *   fixture must use valid UUIDs. A made-up id such as `00000000-0000-0000-0000-000000000001` is
 *   left as written and will never equal what the database minted.
 * - **Every field named in `timestampFields` becomes `<timestamp>`, but only when it holds the
 *   contract's timestamp text**: UTC with exactly six fractional digits, the shared `hiddenAtSchema`
 *   (`2026-11-16T15:04:05.123456Z`). The FORMAT is part of the contract, so it is checked, not
 *   erased: a string in any other format is left as it is and the comparison fails, and a `Date`
 *   throws, because a timestamp that passed through a `Date` has lost its microseconds
 *   (`docs/features/delete-and-restore.md`, invariant 2). `null` and a missing field stay as they
 *   are, because "has a timestamp or not" is meaning. There is no default list and no guessing from
 *   the value: a timestamp is erased only where the caller named the field.
 * - **Calendar days are left alone.** A proof seeds the fixture's own days, so a wrong day is a real
 *   difference.
 *
 * Everything else is copied unchanged, in order: array order is meaning (the order the server
 * returns items in is one of the things this test exists to catch).
 *
 * Two details that keep a comparison from failing for no reason:
 *
 * - Object keys are visited in sorted order, so the labels do not depend on the order either side
 *   happened to build its objects in. Keys themselves are never rewritten.
 * - A property whose value is `undefined` is dropped, as JSON does. `{ reps: undefined }` and `{}`
 *   mean the same thing in the contract's shapes, and a strict deep-equal tells them apart.
 *
 * Pure: no database, no clock, no shared state between calls. Generic over plain JSON-like values
 * (plus `Date`); it throws on anything else (a `Map`, a class instance), which a contract shape
 * never holds. It does not import the program contract: the comparisons against the real named
 * fixtures are added by lane P (`./program.ts`, steps 6a and 6c) and lane E (`./day.ts`, step 12a).
 * The unit test beside this file uses a sample shaped like the plan's `DayPlan`.
 */

/** What a timestamp in a named field becomes. */
export const TIMESTAMP_PLACEHOLDER = '<timestamp>';

/** The label of the `n`th distinct public id met (1-based). */
export const idLabel = (n: number): string => `<id:${n}>`;

export interface NormalizeFixtureOptions {
  /**
   * Names of the fields that hold a timestamp, at any depth: for the program contract's row
   * results, `['hiddenAt']`. Omitted means no field is a timestamp.
   */
  readonly timestampFields?: readonly string[];
}

export function normalizeFixture(value: unknown, options: NormalizeFixtureOptions = {}): unknown {
  const timestampFields = new Set(options.timestampFields ?? []);
  const labels = new Map<string, string>();

  const labelFor = (id: string): string => {
    // Case-insensitive: Postgres prints a uuid in lower case, a hand-written fixture may not.
    const key = id.toLowerCase();
    let label = labels.get(key);
    if (label === undefined) {
      label = idLabel(labels.size + 1);
      labels.set(key, label);
    }
    return label;
  };

  const timestamp = (field: string, held: unknown): unknown => {
    if (held === null || held === undefined) return held;
    // Only the contract's own format is erased. Any other string stays, so the two sides differ.
    if (typeof held === 'string') {
      return hiddenAtSchema.safeParse(held).success ? TIMESTAMP_PLACEHOLDER : held;
    }
    if (held instanceof Date) {
      throw new TypeError(
        `normalizeFixture: '${field}' holds a Date. The contract's timestamps are UTC text with six ` +
          'fractional digits; a Date has already rounded the value to milliseconds',
      );
    }
    throw new TypeError(
      `normalizeFixture: '${field}' is listed as a timestamp field but holds ${describe(held)}`,
    );
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return uuidSchema.safeParse(node).success ? labelFor(node) : node;
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    // A Date outside a named field is a value like any other: kept, and compared by deep-equal.
    if (node instanceof Date) return node;
    const proto: unknown = Object.getPrototypeOf(node);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`normalizeFixture: expected plain JSON-like data, got ${describe(node)}`);
    }
    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const held = source[key];
      if (held === undefined) continue;
      out[key] = timestampFields.has(key) ? timestamp(key, held) : walk(held);
    }
    return out;
  };

  return walk(value);
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object' && value !== null) {
    const name = (value as { constructor?: { name?: string } }).constructor?.name;
    return name && name !== 'Object' ? `a ${name}` : 'an object';
  }
  return `a ${typeof value}`;
}
