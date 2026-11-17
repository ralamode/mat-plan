import type { Equipment, Muscle } from './catalog/vocabulary';

/**
 * The movement picker's filters (CAT-3 spec P7, chunk C0b-2): what a person can narrow the library
 * by, and the one rule for whether a movement passes. Pure, client-safe, and read by
 * `searchMovementOptions` (`movement-search.ts`), which is where a query and the filters meet.
 */

/**
 * Equipment is one choice of three _(maintainer, 2026-11-17)_.
 *
 * - `any`: equipment does not filter.
 * - `none`: movements whose equipment set is empty. Just you and the floor: a wall, a towel or a
 *   partner is equipment.
 * - `chosen`: movements that use **at least one** of `chosenEquipment`. A movement may need more
 *   than the one ticked; its row lists what it needs (P14).
 */
export const EQUIPMENT_CHOICES = ['any', 'none', 'chosen'] as const;
export type EquipmentChoice = (typeof EQUIPMENT_CHOICES)[number];

export type MovementFilters = {
  readonly equipment: EquipmentChoice;
  /**
   * The items ticked under `chosen`. 🔴 **Kept whatever `equipment` says**: changing the choice
   * clears nothing, and the ticked items count again when `chosen` is selected (P7). They filter
   * only while `equipment` is `chosen`.
   */
  readonly chosenEquipment: readonly Equipment[];
  /** Main muscles: a movement passes when its PRIMARY muscle is one of them. */
  readonly muscles: readonly Muscle[];
};

export const NO_MOVEMENT_FILTERS: MovementFilters = {
  equipment: 'any',
  chosenEquipment: [],
  muscles: [],
};

/** How many equipment items the filter panel lists before "Show all equipment" (P7). */
export const EQUIPMENT_FILTER_SHOWN_FIRST = 10;

/**
 * How many filters are on: what the filter control's name carries (P15), and zero means the
 * filters change nothing. "No equipment" is one; each ticked item is one while `chosen` is
 * selected (and none while it is not: they are kept, not on); each muscle is one.
 */
export function movementFiltersOn(filters: MovementFilters): number {
  const equipment =
    filters.equipment === 'none'
      ? 1
      : filters.equipment === 'chosen'
        ? new Set(filters.chosenEquipment).size
        : 0;
  return equipment + new Set(filters.muscles).size;
}

/**
 * What a filter reads off an option. A household's own item (`isCatalog` false or absent) has no
 * taxonomy. 🔴 **A library row with no `equipment` field passes no filter**: it is a row whose
 * taxonomy was not read, not a movement that needs nothing, and showing it under "No equipment"
 * would be a wrong answer nobody could see. (It is then counted outside the filters.)
 */
export type FilterableMovement = {
  readonly isCatalog?: boolean;
  readonly equipment?: readonly Equipment[];
  readonly primaryMuscle?: Muscle | null;
};

/**
 * Whether a LIBRARY movement passes the filters. Different kinds together keep what passes each.
 *
 * 🔴 **A household's own item never passes, and is never removed by this either**: it has no
 * equipment and no muscle, so a filter cannot judge it (spec rule 11, P9). The search lists such
 * rows apart, as "Your custom items (not filtered)"; a caller that reads `false` here as "hide it"
 * has hidden something the person made.
 *
 * `chosen` with nothing ticked filters nothing, like `any`.
 */
export function passesMovementFilters(
  option: FilterableMovement,
  filters: MovementFilters,
): boolean {
  if (!option.isCatalog || option.equipment === undefined) return false;
  const { equipment } = option;
  if (filters.equipment === 'none' && equipment.length > 0) return false;
  if (
    filters.equipment === 'chosen' &&
    filters.chosenEquipment.length > 0 &&
    !equipment.some((item) => filters.chosenEquipment.includes(item))
  ) {
    return false;
  }
  if (filters.muscles.length > 0) {
    const primary = option.primaryMuscle ?? null;
    if (primary === null || !filters.muscles.includes(primary)) return false;
  }
  return true;
}

/**
 * The list with no query, under the filters (P9, P12): the library movements that fit, for
 * `browseTree`, and the household's own items, which are their own section and are not filtered.
 * Each in the order given. With no filter on, every library movement fits.
 */
export function filterMovementOptions<T extends FilterableMovement>(
  options: readonly T[],
  filters: MovementFilters,
): { readonly fitting: readonly T[]; readonly custom: readonly T[] } {
  const on = movementFiltersOn(filters) > 0;
  const unique = [...new Set(options)];
  return {
    fitting: unique.filter(
      (option) => option.isCatalog && (!on || passesMovementFilters(option, filters)),
    ),
    custom: unique.filter((option) => !option.isCatalog),
  };
}
