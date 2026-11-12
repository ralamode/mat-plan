import type { MovementPickerGroup, Unit } from '@mat-plan/shared';

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
 */
type Declaration = {
  readonly unitDefault: Unit | null;
  readonly isBodyweight: boolean;
};

/**
 * One option in the picker — a **discriminated union** on `owner` _(reuse N1)_, so the fields that
 * exist only for a curated row cannot be read off a household row without a narrow.
 *
 * A `catalog` row carries its browse `group` and its `aliases`, both from
 * `MOVEMENT_PICKER_ENTRIES`; a `household` row has neither, because nothing groups or nicknames a
 * name somebody typed. Making that a union rather than two optional fields is what stops a renderer
 * writing `option.group` and getting `undefined` for exactly the rows a household cares most about.
 */
export type MovementOptionDTO = { readonly publicId: string; readonly name: string } & Declaration &
  (
    | {
        readonly owner: 'catalog';
        readonly group: MovementPickerGroup;
        readonly aliases: readonly string[];
      }
    | { readonly owner: 'household' }
  );

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
