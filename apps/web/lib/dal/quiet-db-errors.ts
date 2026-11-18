import 'server-only';

/**
 * A DAL write's database failure, without the data it was writing. FAM-1 7a-i built it for the
 * program builder; 12b moved it here, shared, for the day page's row writes (the tech-debt row "A
 * failed query's params reach Vercel's runtime logs"). One helper, never a copy per directory.
 * One read takes it too: `getHouseholdScope`, whose parameter is the Clerk user id (V1-9b B1-2).
 *
 * drizzle's `DrizzleQueryError` carries `Failed query: …\nparams: …` in its message, and its
 * `cause` (the driver's error) carries Postgres's `detail` (the rejected row). Sentry's scrubber
 * strips both, but Next prints an error thrown out of a Server Action with `console.error`, and
 * Vercel keeps that for 24 hours. So a failed write would put a prescription's free-text notes, or
 * a child's logged numbers, in the log.
 *
 * The rethrown error keeps only what diagnoses without data: which operation failed, the original
 * error's type (`DrizzleQueryError`, `TypeError`, …), the SQLSTATE (`23505`, `57014`, …) and the
 * original stack's frame lines, so a bug inside a writer still points at its line. No message from
 * the original, no `cause`, no `params`, no `detail`: a frame line is a function and a file, never
 * a value.
 */
export class DbWriteError extends Error {
  readonly code: string | null;
  constructor(operation: string, error: unknown) {
    const code = sqlState(error);
    // The class's own name: `DrizzleQueryError` leaves `name` as "Error".
    const kind = error instanceof Error ? error.constructor.name || error.name : typeof error;
    super(`${operation} failed (${kind}${code ? `, SQLSTATE ${code}` : ''})`);
    this.name = 'DbWriteError';
    this.code = code;
    const frames = error instanceof Error ? framesOf(error) : [];
    if (frames.length) this.stack = [`${this.name}: ${this.message}`, ...frames].join('\n');
  }
}

/**
 * Only a stack's frame lines, `at <function> (<file>:<line>:<col>)`. The stack opens with the
 * message, which is where the data is and which drizzle runs over several lines, so those lines are
 * skipped BY COUNT first: a value shaped like a frame cannot pass by looking like one. What is left
 * must still end in a position to count.
 */
const FRAME = /^\s+at \S.*:\d+:\d+\)?$/;
function framesOf(error: Error): string[] {
  const header = error.message.split('\n').length;
  return (error.stack ?? '')
    .split('\n')
    .slice(header)
    .filter((line) => FRAME.test(line));
}

/**
 * The SQLSTATE, from the error or the driver error under it; never anything else of it. A Node errno
 * (`EPIPE`, `EPERM`) is five capitals too, and is not one.
 */
function sqlState(error: unknown): string | null {
  for (let at: unknown = error, depth = 0; at && depth < 3; depth++) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !code.startsWith('E'))
      return code;
    at = (at as { cause?: unknown }).cause;
  }
  return null;
}

/** Runs one DAL write; a throw comes back as a `DbWriteError` that carries no data. */
export async function quietDbErrors<T>(operation: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw new DbWriteError(operation, error);
  }
}
