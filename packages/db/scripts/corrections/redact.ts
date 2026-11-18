/**
 * Keeping a correction's input out of its output, on every path (`PRIV-3` RC, D2).
 *
 * `scripts/correct.ts` prints a thrown error's message, its `cause` and its stack. A database error
 * carries the statement's bound parameters in all three: drizzle's `DrizzleQueryError` message is
 * `Failed query: … params: …`, and the driver's error on `cause` has `detail`, which for a unique
 * violation reads `Key (clerk_user_id)=(user_…)`. A correction whose input is a sign-in account id
 * therefore cannot let a database error reach the runner as it is.
 *
 * 🔴 **`PRIV-3` 2b adopts this module for its runner-wide catch and does not write its own.** The
 * shape it planned was the same one: the SQLSTATE plus the constraint name, nothing else.
 */

/**
 * A refusal a correction raises on purpose. **Its message is built only from counts and positions**
 * ("account 2 of 2"), never from an input value, so it passes through `redactedFailure` unchanged.
 * The class is the promise: construct one only with a message that names no id.
 */
export class CorrectionRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorrectionRefusal';
  }
}

/**
 * What each field may look like to be printed. ⚠️ **Not "identifier characters"**: the first version
 * accepted `[A-Za-z0-9_]{1,63}`, which a Clerk id (`user_…`) matches exactly, so a driver that put
 * the value in either field would have printed it.
 *
 * - `code`: a SQLSTATE (five digits or capitals, `23505`) or a Node system code (`ENOTFOUND`).
 * - `constraint`: this schema's naming — a bare prefix or `<word>_<words>` in lower case — and never
 *   anything starting `user_`, which the naming pattern alone would let through.
 */
const FIELD_SHAPE = {
  code: (v: string) => /^[0-9A-Z]{5}$/.test(v) || /^E[A-Z0-9_]+$/.test(v),
  constraint: (v: string) =>
    /^(uq|idx|fk|pk|chk|[a-z0-9]+_[a-z0-9_]+)$/.test(v) && !/^user_/i.test(v) && v.length <= 63,
} as const;

function fieldOn(source: unknown, key: keyof typeof FIELD_SHAPE): string {
  const value = (source as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' && FIELD_SHAPE[key](value) ? value : 'unknown';
}

/**
 * What a correction rethrows from its one `catch`.
 *
 * - A `CorrectionRefusal` is returned unchanged: its message is already safe, and it is the operator's
 *   answer.
 * - Anything else becomes a NEW error, with no `cause`, whose message is
 *   `<name> failed (nothing committed): <code> <constraint>`. "Nothing committed" rather than
 *   "rolled back": a connection that never opened has nothing to roll back, and both are true of the
 *   one transaction a correction runs in. Both are read from `err.cause` (drizzle
 *   wraps the driver's error and has no `code` of its own), or from `err` when nothing wraps it.
 *   Neither holds a bound parameter, and the constraint is what tells a lost race
 *   (`uq_household_members_clerk_user`) from anything else. ⚠️ **Nothing else is read**: not the
 *   message, not `detail`, not `where`, not the query.
 *
 * The new error's stack starts with that message and lists only this module's frames and its
 * callers', so the stack the runner prints is safe too.
 */
export function redactedFailure(name: string, err: unknown): Error {
  if (err instanceof CorrectionRefusal) return err;
  const source = (err as { cause?: unknown } | null | undefined)?.cause ?? err;
  return new Error(
    `${name} failed (nothing committed): ${fieldOn(source, 'code')} ${fieldOn(source, 'constraint')}`,
  );
}
