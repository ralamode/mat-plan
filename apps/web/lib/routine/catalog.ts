import {
  buildDefaultRoutine,
  makeRoutineKey,
  parseRoutineKey,
  resolveRoutine,
  type RoutineConfig,
  type RoutineItem,
  STRENGTH_KEY,
} from '@mat-plan/shared';

import { LIFE_ACTIVITIES, LIFE_ACTIVITY_KEYS } from '@/lib/life/life-activities';

type LifeActivity = (typeof LIFE_ACTIVITIES)[number];

/**
 * The ordered routine catalog (V1-18; trimmed at FAM-1 12f PR 5, D28): `strength`, then the Life keys
 * (`LIFE_ACTIVITY_KEYS`, today Wrestling practice alone). The SINGLE source of both the default routine
 * order AND `resolveRoutine`'s membership set, derived from `LIFE_ACTIVITY_KEYS` so it can't drift.
 * Keys are built with the shared `makeRoutineKey` (symmetric with `parseRoutineKey`).
 *
 * - **The check-in keys and Wake left** (12f PR 5): the day page logs neither, and the editor offered
 *   what it could no longer switch on. A stored `checkin:*` or `life:wake` key is dropped at read and
 *   leaves storage only when that athlete's routine is next saved; no stored routine is rewritten.
 * - **`strength` stays a member, listed nowhere.** `resolveRoutine` never returns an empty routine: with
 *   no usable key it returns the fallback, and when the fallback is not in the catalog, the whole
 *   catalog. A Life-only catalog would hand every athlete with no stored routine Wrestling practice,
 *   "Life for everyone", which D28 rejected. So `strength` is the catalog's never-empty member: the
 *   first-run default, and what `savedOrder` writes when nothing listed is left.
 *
 * Bodyweight is NOT here: weigh-in is pinned separately. Pure (no `server-only`/React), so the
 * `server-only` DAL imports it without dragging a client boundary.
 */
export const ROUTINE_CATALOG: readonly string[] = [
  STRENGTH_KEY,
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
 *  - `life:wrestling_practice` was a one tap that wrote 90, the maintainer's club's session length,
 *    with no number on the button. Since V1-24 3b-life it is typed minutes with Change and Clear, so
 *    that reason is gone; whether a new household sees it by default is still this row's call
 *    (docs/plan.md's standing ruling), and it stays out until that is decided.
 * Since FAM-1 12f PR 5 the catalog holds none of those exclusions but practice: the check-in keys and
 * Wake left it, and nothing links to the editor (it is reached by its URL).
 *
 * ⚠️ READ-TIME FALLBACK, NEVER WRITTEN AS A DEFAULT. `routine_config = NULL` *is* the representation of
 * "the neutral default", so a profile creator leaves it NULL. `strength` alone may still be written, by
 * `savedOrder`, as the catalog's never-empty member when an editor save leaves nothing listed: that is
 * a saved routine, not the first-run default. If PROF-1 / TEN-1 / ONB-2 ever needs to WRITE a starter
 * routine from `packages/db`, this const and the registry it derives from (`LIFE_ACTIVITIES`) have to move to
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
 * A render block: the collapsed BARE catalog keys one run of `life:*` keys covers, or the `strength`
 * singleton. A contiguous run of `life:*` keys collapses into ONE block. Unknown namespaces (a stored
 * `checkin:*` since 12f PR 5, `finisher:*`), already stripped by `resolveRoutine`, are skipped.
 */
export type RoutineBlock = { kind: 'strength' } | { kind: 'life'; keys: string[] }; // bare LIFE_ACTIVITY_KEYS values, in routine order

/**
 * Classify ONE routine key into what renders it: the single dispatch both `buildRoutineBlocks` (the day
 * page) and `routineCatalogItems` (the editor) share, so a new namespace can't render on one surface but
 * silently drop on the other. `strength` → the singleton; `life:*` → its bare catalog key; a missing
 * tail or any other namespace → null (skipped everywhere).
 */
type RoutineKeyClass = { kind: 'strength' } | { kind: 'life'; catalogKey: string };

function classifyRoutineKey(key: string): RoutineKeyClass | null {
  const { namespace, catalogKey } = parseRoutineKey(key);
  if (namespace === STRENGTH_KEY) return { kind: 'strength' };
  if (!catalogKey) return null; // no namespace tail (null / empty '')
  if (namespace === 'life') return { kind: 'life', catalogKey };
  return null; // any other namespace (checkin:* since 12f PR 5, finisher:* etc.)
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
    if (last && last.kind === 'life')
      last.keys.push(cls.catalogKey); // extend the run
    else blocks.push({ kind: 'life', keys: [cls.catalogKey] }); // start a new block
  }
  return blocks;
}

// Static key → object lookup, built ONCE at module load (the registry is a static const), not per call.
const LIFE_ACTIVITY_BY_KEY = new Map<string, LifeActivity>(LIFE_ACTIVITIES.map((a) => [a.key, a]));

/** Bare Life keys → live `LIFE_ACTIVITIES` objects, in routine order (unknown keys dropped). The Life
 *  section's one resolution: since 12f PR 5 the catalog holds no Wake, so a stored `wake` key drops here. */
export function lifeActivitiesForKeys(keys: readonly string[]): LifeActivity[] {
  return keys
    .map((k) => LIFE_ACTIVITY_BY_KEY.get(k))
    .filter((a): a is LifeActivity => a !== undefined);
}

/** One entry in the labelled catalog the coach editor renders — a routine key + its human label. */
export type RoutineCatalogItem = { key: string; label: string };

/**
 * The labelled routine catalog the editor lists (V1-18 PR 2; Life only since FAM-1 12f PR 5): every
 * `life:*` key of `ROUTINE_CATALOG` with its label from `LIFE_ACTIVITIES`, in catalog order. `strength`
 * is a member but is never listed: the editor cannot switch it off, and `savedOrder` carries it.
 */
export function routineCatalogItems(): RoutineCatalogItem[] {
  const items: RoutineCatalogItem[] = [];
  for (const key of ROUTINE_CATALOG) {
    const cls = classifyRoutineKey(key); // the SAME dispatch buildRoutineBlocks uses (no drift)
    if (cls?.kind !== 'life') continue;
    const label = LIFE_ACTIVITY_BY_KEY.get(cls.catalogKey)?.label;
    if (label !== undefined) items.push({ key, label });
  }
  return items;
}

/**
 * **What the editor's Save sends** (FAM-1 12f PR 5): the items it lists, with what it does not list
 * carried along. `initial` is the athlete's resolved routine and `listed` the editor's current items.
 *
 * - **Carried:** every item of `initial` whose key the editor does not list (today `strength`), kept at
 *   its slot and with its `conditional` marker, so a day-conditional strength stays day-conditional
 *   through a save that never showed it. The listed items fill `initial`'s listed slots in the editor's
 *   order, and any extra ones follow; with more than one listed item, a carried item's place relative
 *   to a given listed item can therefore shift.
 * - **Nothing left** (no listed item and nothing carried): `strength` alone, as the catalog's
 *   never-empty member. An empty order is not authorable (the write path refuses it), and the read side
 *   would otherwise re-expand it.
 *
 * The version comes from `buildDefaultRoutine`; the order comes from the items themselves, because
 * `buildDefaultRoutine` takes keys and would drop a `conditional` marker.
 */
export function savedOrder(initial: RoutineConfig, listed: readonly RoutineItem[]): RoutineConfig {
  const listable = new Set(routineCatalogItems().map((item) => item.key));
  const queue = [...listed];
  const order: RoutineItem[] = [];
  for (const item of initial.order) {
    if (!listable.has(item.key))
      order.push(item); // carried, at its place
    else if (queue.length > 0) order.push(queue.shift()!); // a listed slot takes the next listed item
  }
  order.push(...queue); // listed items beyond the initial's listed slots, in the editor's order
  const version = buildDefaultRoutine([STRENGTH_KEY]).version;
  return order.length > 0 ? { version, order } : buildDefaultRoutine([STRENGTH_KEY]);
}
