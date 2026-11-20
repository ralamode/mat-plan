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
 * A **library** row IS the contract's `CatalogOption` (CAT-3 C0b-2): its aliases and its library
 * taxonomy (equipment, muscles, modality, pattern, supervision, whether it has instructions), so
 * `catalogOptionOf`'s output is an option by construction, plus the legacy browse `group` where an
 * old built-in has one. Its taxonomy is whole, never partial. ⏳ Until CAT-3 chunk R a `catalog` row
 * may instead be `BuiltInWithoutLibrary`, with none of it (`hasLibraryData` tells them apart; the
 * rule and its reason are the DAL's, `lib/dal/program/picker.ts`). A `household` row has none of
 * it: nothing classifies a name somebody typed.
 *
 * 🔴 **Never fill `equipment` with `[]` as a placeholder.** An empty set MEANS "No equipment": a
 * barbell lift mapped that way would say so on its row and pass the "No equipment" filter. A read
 * that has not got the set builds the taxonomy-less arm, never a library option.
 */
export type MovementOptionDTO = { readonly publicId: string; readonly name: string } & Declaration &
  (
    | (CatalogOption & {
        /**
         * The legacy browse group, from `MOVEMENT_PICKER_ENTRIES`: only the old built-ins have one.
         * **Optional** (CAT-3 C0b-2): a library entry has none. Nothing reads it since B3's tree,
         * which files a row by its kind and family. TODO(CAT-3 chunk R): goes in the post-R2 cleanup.
         */
        readonly group?: MovementPickerGroup;
      })
    | BuiltInWithoutLibrary
    | { readonly owner: 'household' }
  );

/**
 * ⏳ **An old built-in the movement library has no entry for yet** (until CAT-3 chunk R; why, and the
 * TODO, are in `lib/dal/program/picker.ts`). Every `CatalogOptionTaxonomy` field is absent, never a
 * placeholder: its row shows only how it is logged, no filter passes it, and it has no "How to".
 */
export type BuiltInWithoutLibrary = {
  readonly owner: 'catalog';
  readonly aliases: readonly string[];
  readonly group?: MovementPickerGroup;
} & { readonly [K in keyof CatalogOptionTaxonomy]?: undefined };

/** A library option: the contract's `CatalogOption`, what `hasLibraryData` narrows to. */
export type LibraryOption = Extract<MovementOptionDTO, CatalogOption>;

/** Whether an option carries the library's taxonomy: a library entry, never a custom item. */
export function hasLibraryData(option: MovementOptionDTO): option is LibraryOption {
  return option.owner === 'catalog' && option.equipment !== undefined;
}

/**
 * ONE place that turns a `MovementOptionDTO` into what the matcher and the filters read
 * (catalog-first, aliases from the catalog only). The picker's search, `listedAs`, its filter
 * counts and the browse tree (`browse-view.ts`) all read through it, so "Show N movements" and
 * "All movements · N" cannot count two different mappings.
 */
export function matchable(options: readonly MovementOptionDTO[]) {
  return options.map((option) => ({
    name: option.name,
    isCatalog: option.owner === 'catalog',
    aliases: option.owner === 'catalog' ? option.aliases : [],
    // What a filter reads (P7). A household item has neither, so a filter cannot judge it (P9).
    equipment: hasLibraryData(option) ? option.equipment : undefined,
    primaryMuscle: hasLibraryData(option) ? option.primaryMuscle : null,
    option,
  }));
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
