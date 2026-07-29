import { z } from 'zod';

/**
 * Per-kid routine contract (V1-18). A routine is an ORDERED list of activity keys the kid works
 * through; the Today page renders it in order, reusing the existing logging forms (PR 1b). This module
 * is catalog-AGNOSTIC on purpose: `CHECKIN_FIELDS`/`LIFE_ACTIVITY_KEYS` live app-side (React-adjacent) and
 * are themselves derived, so `shared` owns only the grammar + pure builders — the concrete ordered
 * catalog (and thus the default routine) is derived app-side and passed IN, so it can never drift out of
 * sync (the second occurrence would be a bug: there is exactly one catalog source).
 *
 * Stored as `profiles.routine_config` JSONB (nullable → the default). A knowing exception to the
 * typed-columns rule — see docs/tech-debt.md; promoted to a `routine_items` table when V1-10 needs to
 * query/join/schedule it.
 */

/** The bare, singleton routine key for the strength block (not namespaced — there's only one). */
export const STRENGTH_KEY = 'strength';

/** The display label for the strength block. Homed here (next to `STRENGTH_KEY`) because the strength
 *  singleton has no per-item registry — unlike check-ins/life, whose labels live on their registry objects.
 *  The coach editor's catalog (`routineCatalogItems`) sources it here rather than re-typing "Strength". */
export const STRENGTH_LABEL = 'Strength';

/** The current routine-config shape version. Named so the literal `1` can't drift across the schema, the
 *  builders, and the client editor's serialization at the next shape bump (a later change branches on it). */
export const ROUTINE_VERSION = 1;

/**
 * The namespace prefixes for the per-activity keys. A key is `<namespace>:<catalogKey>` — and the tail is
 * COLON-PERMITTING because the existing check-in keys already contain a colon (`activityKey:metricKey`,
 * e.g. `brush_teeth:stance`), so a namespaced metric key legitimately has two colons
 * (`checkin:brush_teeth:stance`). Always split on the FIRST colon (see `parseRoutineKey`), never
 * `String.split(':')` + destructure, which would truncate the tail. `bodyweight` is deliberately NOT a
 * namespace: weigh-in is pinned by being rendered separately (PR 1b), never a member of `order`.
 */
export const ROUTINE_NAMESPACES = ['checkin', 'life', 'finisher'] as const;
export type RoutineNamespace = (typeof ROUTINE_NAMESPACES)[number];

// Grammar: the bare strength singleton, OR `<namespace>:<non-empty, colon-permitting tail>`.
const KEY_PATTERN = new RegExp(`^(?:${STRENGTH_KEY}|(?:${ROUTINE_NAMESPACES.join('|')}):.+)$`);
export const routineKeySchema = z.string().regex(KEY_PATTERN, 'not a valid routine key');

/** One routine item: an activity key + an OPAQUE cosmetic `conditional` marker (V1-18 never reads it; the
 *  V1-10 down-payment — scheduling flips it functional later). `.strict()` so an unknown field is rejected. */
export const routineItemSchema = z
  .object({ key: routineKeySchema, conditional: z.literal(true).optional() })
  .strict();
export type RoutineItem = z.infer<typeof routineItemSchema>;

/** A per-kid routine: a `version` (so a later shape change branches, not guesses) + the ordered items.
 *  An OBJECT (not a bare array) so PR 3's check-in allowlist is additive with no shape bump. */
export const routineConfigSchema = z
  .object({ version: z.literal(ROUTINE_VERSION), order: z.array(routineItemSchema) })
  .strict();
export type RoutineConfig = z.infer<typeof routineConfigSchema>;

/** Split a routine key into its namespace + catalog tail, on the FIRST colon (the tail may contain more).
 *  `strength` → `{ namespace: 'strength', catalogKey: null }`; `checkin:brush_teeth:stance` →
 *  `{ namespace: 'checkin', catalogKey: 'brush_teeth:stance' }`. PR 1b dispatches the render on this. */
export function parseRoutineKey(key: string): { namespace: string; catalogKey: string | null } {
  if (key === STRENGTH_KEY) return { namespace: STRENGTH_KEY, catalogKey: null };
  const i = key.indexOf(':');
  // A colon-less non-strength key has no valid namespace (a grammar-valid key always has one) — return a
  // clean sentinel so a caller dispatches on the whole key + a null tail, never a truncated garbage prefix.
  if (i === -1) return { namespace: key, catalogKey: null };
  return { namespace: key.slice(0, i), catalogKey: key.slice(i + 1) };
}

/** Build a namespaced routine key from a namespace + a bare catalog key — the SYMMETRIC inverse of
 *  `parseRoutineKey` (same separator, defined once here so the build and read sides can't drift). The tail
 *  may itself contain a colon (`makeRoutineKey('checkin', 'brush_teeth:stance')` → `checkin:brush_teeth:stance`),
 *  which `parseRoutineKey` splits back on the FIRST colon. Callers build every `checkin:`/`life:` key with this. */
export function makeRoutineKey(namespace: RoutineNamespace, catalogKey: string): string {
  return `${namespace}:${catalogKey}`;
}

/** Build the default routine from the app's ordered catalog keys (strength → check-ins → life). Pure: the
 *  CALLER (app-side, PR 1b) owns the ordered key list so the default can't drift from the live catalog. */
export function buildDefaultRoutine(orderedCatalogKeys: readonly string[]): RoutineConfig {
  return { version: ROUTINE_VERSION, order: orderedCatalogKeys.map((key) => ({ key })) };
}

/**
 * Resolve a stored (possibly null / stale / crafted) `routine_config` into a usable routine, given the
 * app's ordered catalog keys (which are also the membership set + the default order — so `default ⊆
 * catalog` by construction). Forgiving, item-by-item:
 *   - null / non-object / wrong `version` → the default routine (the ships-dark path);
 *   - a valid config → keep only the items whose key is (a) grammar-valid, (b) a live catalog key, AND (c)
 *     not a DUPLICATE (first occurrence wins) — dropping any stale/invalid/repeat item WITHOUT discarding the
 *     rest (a single bad key never nukes the routine; a repeated key never renders duplicate controls);
 *   - a config whose items ALL drop out (fully stale) → the default too, so a kid never renders a blank Today.
 */
export function resolveRoutine(raw: unknown, orderedCatalogKeys: readonly string[]): RoutineConfig {
  // Loose outer parse: `version` reused from `routineConfigSchema` (so the two can't drift), `order` an array
  // of opaque items filtered below. Deliberately NOT `.strict()` — a future additive top-level field (PR 3's
  // check-in allowlist) must not fail the parse and silently discard the kid's authored order.
  const outer = z
    .object({ version: routineConfigSchema.shape.version, order: z.array(z.unknown()) })
    .safeParse(raw);
  if (!outer.success) return buildDefaultRoutine(orderedCatalogKeys);

  const allow = new Set(orderedCatalogKeys);
  const seen = new Set<string>();
  const order: RoutineItem[] = [];
  for (const rawItem of outer.data.order) {
    const item = routineItemSchema.safeParse(rawItem);
    // DEDUPE (first-wins): a repeated key from corrupt/crafted JSONB must not render two of the same block
    // (duplicate React keys, DOM ids, and hidden inputs — a phantom control).
    if (item.success && allow.has(item.data.key) && !seen.has(item.data.key)) {
      seen.add(item.data.key);
      order.push(item.data);
    }
  }
  // All items stale/invalid → fall back to the default (never a blank routine from a gone-stale config).
  return order.length > 0
    ? { version: ROUTINE_VERSION, order }
    : buildDefaultRoutine(orderedCatalogKeys);
}

/**
 * STRICT write-side validation (V1-18 PR 2, coach editor) — the authoring counterpart to the forgiving
 * `resolveRoutine`. A Server Action is an untrusted public POST, so a save must REJECT a bad body rather
 * than silently drop items (which would let the coach save X and then see Y on Today). It single-sources
 * the membership + dedupe rule by DELEGATING to `resolveRoutine` and demanding it change NOTHING — the
 * submitted config is clean iff resolving it (grammar + catalog membership + first-wins dedupe) returns
 * the identical ordered items. Rejects (→ null):
 *   - not a valid `routineConfigSchema` object (wrong `version`, unknown field, malformed item);
 *   - an EMPTY `order` — an empty routine is NOT authorable, because `resolveRoutine` maps it back to the
 *     full default on read, so "save nothing" would silently render everything (a hidden write/read split);
 *   - any non-catalog key, or a duplicate key (both things `resolveRoutine` would have dropped/deduped).
 * Returns the config to persist as-is (so the opaque `conditional` marker survives), or `null`.
 */
export function validateRoutineForWrite(
  raw: unknown,
  orderedCatalogKeys: readonly string[],
): RoutineConfig | null {
  const parsed = routineConfigSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.order.length === 0) return null; // empty is not authorable (would revert to the default)

  const resolved = resolveRoutine(parsed.data, orderedCatalogKeys);
  // Clean iff resolving changed nothing. TODAY `resolveRoutine` is an order-preserving, non-transforming
  // filter, so equal length already implies item-identity — but we ALSO compare key + conditional per index
  // on purpose: it is the guard that keeps this "reject" contract correct if `resolveRoutine` ever reorders
  // or normalizes items (then length could match while contents differ). Cheap defence, not dead code.
  const clean =
    resolved.order.length === parsed.data.order.length &&
    resolved.order.every(
      (item, i) =>
        item.key === parsed.data.order[i]!.key &&
        item.conditional === parsed.data.order[i]!.conditional,
    );
  return clean ? parsed.data : null;
}
