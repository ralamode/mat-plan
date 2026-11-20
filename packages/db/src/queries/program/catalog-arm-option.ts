import {
  catalogOptionOf,
  movementNameKey,
  type CatalogMovement,
  type CatalogOptionTaxonomy,
  type MovementPickerGroup,
  type Supervision,
  type TrackingType,
  type Unit,
} from '@mat-plan/shared';

/**
 * The library's taxonomy on a catalog-arm option (CAT-3 P11): from the library entry on the row's slug
 * in P11-ii-a, from the tables in P11-ii-b. **Present exactly when the row has a library entry**, and
 * `null` otherwise, never a placeholder: an empty `equipment` MEANS "No equipment"
 * (`apps/web/lib/movements/movement-option.ts`'s 🔴).
 */
export type CatalogArmTaxonomy = Pick<
  CatalogOptionTaxonomy,
  'modality' | 'pattern' | 'equipment' | 'primaryMuscle' | 'secondaryMuscles'
>;

/** An entry of `MOVEMENT_PICKER_ENTRIES` (the old built-ins' browse group and aliases). */
export type PickerEntry = {
  readonly group: MovementPickerGroup;
  readonly aliases?: readonly string[];
};

/** The database row's identity: what a save, a log and `newItem` use. */
export type CatalogArmRow = {
  readonly publicId: string;
  readonly slug: string;
  readonly name: string;
  readonly unitDefault: Unit | null;
  readonly isBodyweight: boolean;
  readonly trackingType: TrackingType;
};

/** One catalog-arm option, as the read returns it (the DAL copies it field by field). */
export type CatalogArmOption = CatalogArmRow & {
  readonly owner: 'catalog';
  /** The legacy browse group: only an old built-in (one `MOVEMENT_PICKER_ENTRIES` names) has one. */
  readonly group?: MovementPickerGroup;
  /** The const's aliases joined with the library entry's, by the picker's name key, the const's first. */
  readonly aliases: readonly string[];
  readonly taxonomy: CatalogArmTaxonomy | null;
  readonly supervision: Supervision | null;
  readonly hasInstructions: boolean;
};

/** Every alias once, by the picker's "same name" key, the first spelling kept. */
export function joinAliases(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  return lists.flat().filter((alias) => {
    const key = movementNameKey(alias);
    if (key === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 🔴 **The one mapping from a catalog-arm row to its option** (CAT-3 P11-ii-a; plan
 * `docs/plans/cat-3-p11-ii-option-taxonomy.md`, Amendment 1, A1.2). Pure, so its four cases are tested
 * without a database:
 *
 * | Row | Library entry | Option |
 * | --- | --- | --- |
 * | old built-in | yes | the row's identity; the const's aliases joined with the entry's; the entry's taxonomy, supervision and `hasInstructions`; the const's `group` |
 * | old built-in | no | the row's identity; the const's aliases; no taxonomy (K22); the const's `group` |
 * | catalog row | yes | `catalogOptionOf(entry)` with the row's identity written over it; no `group` |
 * | catalog row | no | the row's identity; no aliases, no supervision, no instructions, no taxonomy; listed, never dropped (K22) |
 *
 * **The row's identity always wins** (name, tracking type, unit, bodyweight flag): the row is what a
 * save, a log and `newItem` use, so the picker must never promise a type the save then reads
 * differently. Because the read applies this, `newItem` matches over exactly the aliases the picker
 * shows (K23).
 */
export function catalogArmOption(
  row: CatalogArmRow,
  pickerEntry: PickerEntry | undefined,
  libraryEntry: CatalogMovement | undefined,
): CatalogArmOption {
  const fromLibrary = libraryEntry && catalogOptionOf(libraryEntry, row.publicId);
  return {
    publicId: row.publicId,
    slug: row.slug,
    name: row.name,
    unitDefault: row.unitDefault,
    isBodyweight: row.isBodyweight,
    trackingType: row.trackingType,
    owner: 'catalog',
    ...(pickerEntry ? { group: pickerEntry.group } : {}),
    aliases: joinAliases(pickerEntry?.aliases ?? [], fromLibrary?.aliases ?? []),
    taxonomy: fromLibrary
      ? {
          modality: fromLibrary.modality,
          pattern: fromLibrary.pattern,
          equipment: fromLibrary.equipment,
          primaryMuscle: fromLibrary.primaryMuscle,
          secondaryMuscles: fromLibrary.secondaryMuscles,
        }
      : null,
    supervision: fromLibrary?.supervision ?? null,
    hasInstructions: fromLibrary?.hasInstructions ?? false,
  };
}
