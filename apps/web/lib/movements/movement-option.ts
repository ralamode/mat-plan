import type {
  CatalogOption,
  CatalogOptionTaxonomy,
  MovementPickerGroup,
  TrackingType,
  Unit,
} from '@mat-plan/shared';

/**
 * The DTOs the movement picker renders (PICK-1 Decision 5).
 *
 * 🔴 **Deliberately NOT `server-only`, and that is the point of the module existing.** A client
 * component imports these types; putting them in `lib/dal/movements.ts` beside the reads would drag
 * `server-only` into the picker's import graph. Types only — no query, no `db`, nothing that needs a
 * scope.
 */

/**
 * The MOVEMENT's own declaration — what kind of thing it is, which the picker uses to seed a card's
 * unit and load mode (Decision 6, in PR 4).
 *
 * 🔴 **A declaration is NOT a magnitude**, and the distinction is the app's one inviolable product
 * rule (AGENTS.md: the LLM never authors loads; strength-logging invariant 1). "This movement is
 * measured in pounds" is a property of the movement; "do 95 lb" is a prescription. So this type has
 * no `load`, no `reps` and no `sets`, a test pins that with `@ts-expect-error`, and picking a
 * movement can never prefill a number.
 *
 * `trackingType` (FAM-1 step 0b) is a declaration in the same sense: how the item is logged, one of
 * the seven `TRACKING_TYPES`, set once on the item (FAM-1 plan D1, D25). The movement picker shows
 * it on each row's second line (`rowMeta`, CAT-3 P14) and the workout editor reads it to choose a
 * card's fields.
 * The item picker's read fills it from the database row (`lib/dal/program/picker.ts`, FAM-1 7a-ii),
 * never from the library: the row is what a save and a log use.
 */
type Declaration = {
  readonly unitDefault: Unit | null;
  readonly isBodyweight: boolean;
  readonly trackingType: TrackingType;
};

/**
 * One option in the picker — a **discriminated union** on `owner` _(reuse N1)_, so the fields that
 * exist only for a curated row cannot be read off a household row without a narrow.
 *
 * A `catalog` row IS the contract's `CatalogOption` (CAT-3 C0b-2): its aliases and its library
 * taxonomy (equipment, muscles, modality, pattern, supervision, whether it has instructions), so
 * `catalogOptionOf`'s output is an option by construction, plus the legacy browse `group` where an
 * old built-in has one. A `household` row has none of it: nothing classifies a name somebody typed.
 * The taxonomy is **required**: a library row without it passes no filter (`passesMovementFilters`).
 *
 * 🔴 **Never fill `equipment` with `[]` as a placeholder.** An empty set MEANS "No equipment": a
 * barbell lift mapped that way would say so on its row and pass the "No equipment" filter. A read
 * that has not got the set must not build a library option at all.
 */
export type MovementOptionDTO = { readonly publicId: string; readonly name: string } & Declaration &
  (
    | (CatalogOption & {
        /**
         * The legacy browse group, from `MOVEMENT_PICKER_ENTRIES`: only the old built-ins have one.
         * **Optional** (CAT-3 C0b-2): a library entry has none, is found by search, and is left out
         * of the legacy groups (invariant 11) until B3's browse tree replaces them.
         */
        readonly group?: MovementPickerGroup;
      })
    | BuiltInWithoutLibrary
    | { readonly owner: 'household' }
  );

/**
 * ⏳ **An old built-in the movement library has no entry for yet: shown until the catalog's fresh
 * start** _(maintainer, 2026-11-17: "Show all 35 until reset")_. It is a catalog row, so search,
 * "already listed" and the server's `newItem` agree on it, but it has NO taxonomy: every
 * `CatalogOptionTaxonomy` field is absent, never filled with a placeholder. So its row shows only how
 * it is logged, no filter passes it, and it has no "How to".
 *
 * TODO(CAT-3 chunk R, the fresh start): the library replaces the old catalog, every built-in has an
 * entry, and this arm goes with the DAL's interim branch (`lib/dal/program/picker.ts`). CAT-3 spec
 * P11-i ("no third, taxonomy-less shape of option") holds again from then.
 */
export type BuiltInWithoutLibrary = {
  readonly owner: 'catalog';
  readonly aliases: readonly string[];
  readonly group?: MovementPickerGroup;
} & { readonly [K in keyof CatalogOptionTaxonomy]?: undefined };

/** Whether an option carries the library's taxonomy: a library entry, never a custom item. */
export function hasLibraryData(
  option: MovementOptionDTO,
): option is Extract<MovementOptionDTO, CatalogOption> {
  return option.owner === 'catalog' && option.equipment !== undefined;
}

/**
 * Everything the picker needs to render its lists, as **separate props** rather than one pre-joined
 * shape _(FE-12's intent, kept)_: the caller fetches each with its own query and the component stays
 * pure.
 *
 * `recentIds` is **optional and a subset of `options`' public ids** — optional because `D4c`'s
 * program editor at `/programs/new` has no athlete to have recent movements (architecture 4), and a
 * subset because the DAL intersects it with the listed options _(correctness S3)_ so Recent can never
 * show a row the browse list would not.
 */
export type MovementPickerData = {
  readonly options: readonly MovementOptionDTO[];
  readonly recentIds?: readonly string[];
};
