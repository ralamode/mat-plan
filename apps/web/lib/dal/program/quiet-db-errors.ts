import 'server-only';

/**
 * A program write's database failure, without the data it was writing (FAM-1 7a; the tech-debt row
 * "A failed query's params reach Vercel's runtime logs", whose gate is the step that makes
 * save-workout reachable — this one).
 *
 * drizzle's `DrizzleQueryError` carries `Failed query: …\nparams: …` in its message, and its
 * `cause` (the driver's error) carries Postgres's `detail` (the rejected row). Sentry's scrubber
 * strips both, but Next prints an error thrown out of a Server Action with `console.error`, and
 * Vercel keeps that for 24 hours — so a failed save would put a prescription's free-text notes,
 * which can hold health detail about a child, in the log.
 *
 * The rethrown error keeps only what diagnoses without data: which operation failed and the
 * SQLSTATE (`23505`, `57014`, …). No message from the original, no `cause`, no `params`, no
 * `detail`, no stack from the original.
 */
export class ProgramWriteError extends Error {
  readonly code: string | null;
  constructor(operation: string, code: string | null) {
    super(`${operation} failed${code ? ` (SQLSTATE ${code})` : ''}`);
    this.name = 'ProgramWriteError';
    this.code = code;
  }
}

/** The SQLSTATE, from the error or the driver error under it; never anything else of it. */
function sqlState(error: unknown): string | null {
  for (let at: unknown = error, depth = 0; at && depth < 3; depth++) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    at = (at as { cause?: unknown }).cause;
  }
  return null;
}

/** Runs one DAL write; a throw comes back as a `ProgramWriteError` that carries no data. */
export async function quietDbErrors<T>(operation: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw new ProgramWriteError(operation, sqlState(error));
  }
}
