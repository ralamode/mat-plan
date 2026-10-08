import {
  makeRoutineKey,
  parseRoutineKey,
  resolveRoutine,
  type RoutineConfig,
  STRENGTH_KEY,
  STRENGTH_LABEL,
} from '@mat-plan/shared';

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
 * The FIRST-RUN routine KEYS (ONB-0) — what a profile whose `routine_config` is NULL renders.
 *
 * A key LIST, like `ROUTINE_CATALOG`, not a `RoutineConfig` — `buildDefaultRoutine` is what turns one
 * into the other, and the shared parameter it feeds is called `defaultOrderedKeys`.
 *
 * `strength` ALONE. With the pinned weigh-in that is exactly the UX panel's A2 candidate ("weigh-in +
 * strength only, everything else opt-in via the editor"): `bodyweight` is deliberately not a legal
 * `order` key, so the weigh-in is pinned by construction and this list is the whole of the rest.
 *
 * Before ONB-0 a new profile fell back to `ROUTINE_CATALOG` — all of it — so a stranger's first screen
 * was ~17 unexplained controls belonging to the maintainer's household: 3 habits (Rice bucket · Brain
 * rep · Splits), 7 numeric fields grouped under the label "Brush teeth" (a wrestling drill block a new
 * coach reads as dental hygiene), 4 calisthenics counters and 2 life controls.
 *
 * Why each exclusion, since "why so small?" is the first question a reader has:
 *  - the habits and the `brush_teeth` metrics are one household's choices, which IS the defect;
 *  - the calisthenics counters twin the `push-ups` / `pull-up` / `v-sit_crunches` MOVEMENTS and
 *    double-count adherence (CAT-1, whose trap (2) says "the default needs the criterion too") — and
 *    ONB-2's Daily Five prescribes push-ups and pull-ups, so keeping them here would hand every new
 *    household the same work loggable two ways on day one;
 *  - `life:wrestling_practice`'s one tap writes `DEFAULT_PRACTICE_MINUTES = 90` — the maintainer's
 *    club's session length — with no number on the button and no in-app undo. docs/plan.md's standing
 *    ruling names THIS row as the owner of that distinction.
 * Everything excluded stays fully authorable in the shipped editor, which Today links to.
 *
 * ⚠️ READ-TIME FALLBACK, NEVER WRITTEN. `routine_config = NULL` *is* the representation of "the neutral
 * default", so a profile creator leaves it NULL. If PROF-1 / TEN-1 / ONB-2 ever needs to WRITE a starter
 * routine from `packages/db`, this const and the two registries it derives from have to move to
 * `packages/shared` first — `packages/db` cannot import `apps/web`.
 */
export const NEUTRAL_DEFAULT_KEYS: readonly string[] = [STRENGTH_KEY];

/**
 * Resolve a stored `routine_config` the way the APP means it: membership is the whole catalog (so an
 * authored item is never silently stripped), the first-run fallback is the neutral default.
 *
 * The ONE place those two lists are paired, and the only module in `apps/web` that imports
 * `resolveRoutine` at all. Its third parameter is defaulted for backward compatibility, which means
 * `resolveRoutine(raw, ROUTINE_CATALOG)` still compiles and still means "inherit the whole catalog" —
 * so every production READ goes through this wrapper instead, and no caller passes either list by hand.
 *
 * ⚠️ The WRITE path is asymmetric on purpose: `actions.ts` calls `validateRoutineForWrite(submitted,
 * ROUTINE_CATALOG)` and pairs membership ALONE, because a default is meaningless when authoring (an
 * empty order is rejected outright precisely so the read side can't re-expand it). Do not add a
 * `validateProfileRoutineForWrite` that smuggles the first-run default into authoring.
 */
export function resolveProfileRoutine(raw: unknown): RoutineConfig {
  return resolveRoutine(raw, ROUTINE_CATALOG, NEUTRAL_DEFAULT_KEYS);
}

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
