/**
 * Did this error come from a unique violation (`23505`) on one of `indexNames`?
 *
 * The one matcher for "a named unique index refused this write", for every writer that turns a
 * specific collision into an answer. Its caller today is `hide.ts`'s restore (`RESTORE_SLOT_INDEXES`);
 * the FAM-1 row writer arbitrates with a bare `ON CONFLICT DO NOTHING` and matches none. It reads the shape
 * both drivers give: drizzle wraps the driver error in a `DrizzleQueryError` whose `cause` is it, and
 * node-postgres / PGlite put `code` and `constraint` on that error.
 *
 * ⚠️ Narrow on purpose: an index not named here is a genuine surprise and must keep propagating.
 * Matching every `23505` would tell a person the wrong story about a bug.
 */
export function isUniqueViolationOn(
  error: unknown,
  indexNames: string | readonly string[],
): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const { code, constraint } = (cause ?? {}) as { code?: string; constraint?: string };
  const names: readonly string[] = typeof indexNames === 'string' ? [indexNames] : indexNames;
  return code === '23505' && constraint !== undefined && names.includes(constraint);
}
