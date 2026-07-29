import { makeRoutineKey, parseRoutineKey, STRENGTH_KEY, STRENGTH_LABEL } from '@mat-plan/shared';

import { type CheckinField, CHECKIN_FIELDS } from '@/lib/checkins/checkin-fields';
import { LIFE_ACTIVITIES, LIFE_ACTIVITY_KEYS } from '@/lib/life/life-activities';

type LifeActivity = (typeof LIFE_ACTIVITIES)[number];

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

/**
 * Classify ONE routine key into what renders it — the single dispatch both `buildRoutineBlocks` (Today)
 * and `routineCatalogItems` (the coach editor) share, so a new namespace can't render on one surface but
 * silently drop on the other. `strength` → the singleton; `checkin:*`/`life:*` → their kind + bare
 * catalog key; a missing tail or an unknown namespace (`finisher:*` etc.) → null (skipped everywhere).
 */
type RoutineKeyClass =
  | { kind: 'strength' }
  | { kind: 'checkins'; catalogKey: string }
  | { kind: 'life'; catalogKey: string };

function classifyRoutineKey(key: string): RoutineKeyClass | null {
  const { namespace, catalogKey } = parseRoutineKey(key);
  if (namespace === STRENGTH_KEY) return { kind: 'strength' };
  if (!catalogKey) return null; // no namespace tail (null / empty '')
  if (namespace === 'checkin') return { kind: 'checkins', catalogKey };
  if (namespace === 'life') return { kind: 'life', catalogKey };
  return null; // unknown namespace (finisher:* etc.)
}

export function buildRoutineBlocks(order: readonly { key: string }[]): RoutineBlock[] {
  const blocks: RoutineBlock[] = [];
  for (const { key } of order) {
    const cls = classifyRoutineKey(key);
    if (cls === null) continue; // no tail / unknown namespace — skip
    if (cls.kind === 'strength') {
      blocks.push({ kind: 'strength' });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && 'keys' in last && last.kind === cls.kind)
      last.keys.push(cls.catalogKey); // extend the run
    else blocks.push({ kind: cls.kind, keys: [cls.catalogKey] }); // start a new block
  }
  return blocks;
}

// Static key → object lookups, built ONCE at module load (the registries are static consts) — not per call.
const CHECKIN_FIELD_BY_KEY = new Map<string, CheckinField>(CHECKIN_FIELDS.map((f) => [f.key, f]));
const LIFE_ACTIVITY_BY_KEY = new Map<string, LifeActivity>(LIFE_ACTIVITIES.map((a) => [a.key, a]));

/** Map a check-in block's bare keys back to the live `CheckinField` objects (the ONE registry), in routine
 *  order (unknown keys dropped). DEFAULT (catalog-order keys) yields exactly today's `fields={CHECKIN_FIELDS}`. */
export function checkinFieldsForKeys(keys: readonly string[]): CheckinField[] {
  return keys
    .map((k) => CHECKIN_FIELD_BY_KEY.get(k))
    .filter((f): f is CheckinField => f !== undefined);
}

/** The life twin of `checkinFieldsForKeys` — bare keys → live `LIFE_ACTIVITIES` objects, in routine order
 *  (unknown keys dropped). Single-sources the resolution the `LifeForm` subset uses (no inline re-implement). */
export function lifeActivitiesForKeys(keys: readonly string[]): LifeActivity[] {
  return keys
    .map((k) => LIFE_ACTIVITY_BY_KEY.get(k))
    .filter((a): a is LifeActivity => a !== undefined);
}

/** One entry in the labelled catalog the coach editor renders — a routine key + its human label. */
export type RoutineCatalogItem = { key: string; label: string };

/**
 * The labelled routine catalog (V1-18 PR 2) — every `ROUTINE_CATALOG` key paired with its human label, in
 * catalog order, for the coach editor's checklist. Labels are single-sourced, NOT re-typed: `strength` →
 * the shared `STRENGTH_LABEL`; `checkin:*` / `life:*` → the live registry object's `.label`, resolved via
 * `parseRoutineKey` + the already-hoisted maps (the same maps `checkinFieldsForKeys`/`lifeActivitiesForKeys`
 * use). Order comes free from `ROUTINE_CATALOG` (itself derived from the registries — can't drift). A key
 * whose object has gone missing is dropped (can't happen while the catalog IS derived from the registries).
 */
export function routineCatalogItems(): RoutineCatalogItem[] {
  const items: RoutineCatalogItem[] = [];
  for (const key of ROUTINE_CATALOG) {
    const cls = classifyRoutineKey(key); // the SAME dispatch buildRoutineBlocks uses (no drift)
    if (cls === null) continue;
    const label =
      cls.kind === 'strength'
        ? STRENGTH_LABEL
        : cls.kind === 'checkins'
          ? CHECKIN_FIELD_BY_KEY.get(cls.catalogKey)?.label
          : LIFE_ACTIVITY_BY_KEY.get(cls.catalogKey)?.label;
    if (label !== undefined) items.push({ key, label });
  }
  return items;
}
