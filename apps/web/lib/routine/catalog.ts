import { makeRoutineKey, parseRoutineKey, STRENGTH_KEY } from '@mat-plan/shared';

import { type CheckinField, CHECKIN_FIELDS } from '@/lib/checkins/checkin-fields';
import { LIFE_ACTIVITY_KEYS } from '@/lib/life/life-activities';

/**
 * The ordered routine catalog (V1-18) — the SINGLE source of both the default routine order AND
 * `resolveRoutine`'s membership set, derived from the live catalogs (`CHECKIN_FIELDS`, `LIFE_ACTIVITY_KEYS`)
 * so it can't drift. Keys are built with the shared `makeRoutineKey` (symmetric with `parseRoutineKey`).
 * Order = today's page: strength → check-ins (in `CHECKIN_FIELDS` order) → life. Bodyweight is NOT here —
 * weigh-in is pinned separately. Pure (no `server-only`/React — the transitive catalogs are pure), so the
 * `server-only` DAL imports it without dragging a client boundary.
 */
export const ROUTINE_CATALOG: readonly string[] = [
  STRENGTH_KEY,
  ...CHECKIN_FIELDS.map((f) => makeRoutineKey('checkin', f.key)),
  ...LIFE_ACTIVITY_KEYS.map((k) => makeRoutineKey('life', k)),
];

/**
 * A render block: one existing form + the collapsed BARE catalog keys it covers. A CONTIGUOUS run of
 * `checkin:*` (or `life:*`) keys collapses into ONE block, so `CheckinForm`/`LifeForm` are called once per
 * run — preserving the batch submit + a single hydration island (`DEFAULT_ROUTINE`, all check-ins
 * contiguous, = today's single `CheckinForm`). A scattered routine yields multiple blocks (the honest
 * consequence). `strength` is a singleton block; unknown namespaces (`finisher:*`, already stripped by
 * `resolveRoutine`) are skipped.
 */
export type RoutineBlock =
  | { kind: 'strength' }
  | { kind: 'checkins'; keys: string[] } // bare CheckinField.key values, in routine order
  | { kind: 'life'; keys: string[] }; // bare LIFE_ACTIVITY_KEYS values, in routine order

export function buildRoutineBlocks(order: readonly { key: string }[]): RoutineBlock[] {
  const blocks: RoutineBlock[] = [];
  for (const { key } of order) {
    const { namespace, catalogKey } = parseRoutineKey(key);
    if (namespace === STRENGTH_KEY) {
      blocks.push({ kind: 'strength' });
      continue;
    }
    if (catalogKey === null) continue; // malformed / no tail — skip
    const kind = namespace === 'checkin' ? 'checkins' : namespace === 'life' ? 'life' : null;
    if (kind === null) continue; // unknown namespace (finisher:* etc.) — skip
    const last = blocks[blocks.length - 1];
    if (last && 'keys' in last && last.kind === kind)
      last.keys.push(catalogKey); // extend the run
    else blocks.push({ kind, keys: [catalogKey] }); // start a new block
  }
  return blocks;
}

/** Map a check-in block's bare keys back to the live `CheckinField` objects (the ONE registry), in routine
 *  order. DEFAULT (catalog-order keys) yields exactly today's `fields={CHECKIN_FIELDS}`. */
export function checkinFieldsForKeys(keys: readonly string[]): CheckinField[] {
  const byKey = new Map(CHECKIN_FIELDS.map((f) => [f.key, f]));
  return keys.map((k) => byKey.get(k)).filter((f): f is CheckinField => f !== undefined);
}
