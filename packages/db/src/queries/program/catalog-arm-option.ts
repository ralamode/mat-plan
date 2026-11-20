import {
  catalogOptionOf,
  equipmentInOrder,
  equipmentSchema,
  modalitySchema,
  movementNameKey,
  movementPatternSchema,
  muscleSchema,
  musclesInOrder,
  type CatalogMovement,
  type CatalogOptionTaxonomy,
  type MovementPickerEntry,
  type MovementPickerGroup,
  type TrackingType,
  type Unit,
} from '@mat-plan/shared';

/**
 * The taxonomy on a catalog-arm option (CAT-3 P11). **A catalog row's comes from the tables**
 * (P11-ii-b: `modality` and `pattern` from `movements`, the rest from `movement_equipment` and
 * `movement_muscles`, assembled by `catalogTaxonomyOf`). **An old built-in's comes from the library
 * entry on its slug**, or it has none. `null` means none, never a placeholder: an empty `equipment`
 * MEANS "No equipment" (`apps/web/lib/movements/movement-option.ts`'s 🔴).
 */
export type CatalogArmTaxonomy = Pick<
  CatalogOptionTaxonomy,
  'modality' | 'pattern' | 'equipment' | 'primaryMuscle' | 'secondaryMuscles'
>;

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
} & Pick<CatalogOptionTaxonomy, 'supervision' | 'hasInstructions'>;

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

/** One join row as `catalogTaxonomyRows` returns it: the movement's internal id and a code, unparsed. */
export type CatalogJoinRow = { readonly movementId: number; readonly code: string };

/**
 * The raw join rows for the listed catalog ids (`catalogTaxonomyRows`, P11-ii-b (b2)). The primary
 * muscle and the secondaries are separate reads, never one read ordered "by role".
 */
export type CatalogTaxonomyRows = {
  readonly equipment: readonly CatalogJoinRow[];
  readonly primaryMuscles: readonly CatalogJoinRow[];
  readonly secondaryMuscles: readonly CatalogJoinRow[];
};

/** A listed catalog row's own taxonomy columns, unparsed, with the internal id the joins key on. */
export type CatalogTaxonomyRow = {
  readonly id: number;
  readonly modality: string | null;
  readonly pattern: string | null;
};

/**
 * 🔴 **A catalog row's taxonomy, from the tables** (CAT-3 P11-ii-b; plan
 * `docs/plans/cat-3-p11-ii-option-taxonomy.md`, (b1)–(b4)). Pure: the read hands it the listed catalog
 * rows and their join rows, and it returns each row's taxonomy by internal id.
 *
 * - **(b2) A join row for an id not listed THROWS.** `catalogTaxonomyRows` reads listed ids only, so a
 *   stray row means the read's filter broke, and is never attached to an option or silently dropped.
 * - **(b3) Order:** equipment and secondary muscles in the vocabulary's order (`equipmentInOrder`,
 *   `musclesInOrder`; spec K31), as `catalogOptionOf` lists an entry's. The tables keep no order.
 * - **(b4) Every value is parsed** (`modalitySchema`, `movementPatternSchema`, `equipmentSchema`,
 *   `muscleSchema`), as the read parses a unit. The foreign keys and the modality CHECK hold every code,
 *   so a failure means a code left the shared vocabulary while rows still hold it, which A3 must not do.
 *   A second primary muscle throws too (the one-primary index forbids it).
 */
export function catalogTaxonomyOf(
  listed: readonly CatalogTaxonomyRow[],
  rows: CatalogTaxonomyRows,
): Map<number, CatalogArmTaxonomy> {
  const ids = new Set(listed.map((row) => row.id));
  const byId = <T>(join: readonly CatalogJoinRow[], what: string, parse: (code: string) => T) => {
    const out = new Map<number, T[]>();
    for (const row of join) {
      if (!ids.has(row.movementId))
        throw new Error(
          `catalogTaxonomyOf: a ${what} row for movement ${row.movementId}, which the read did not list`,
        );
      out.set(row.movementId, [...(out.get(row.movementId) ?? []), parse(row.code)]);
    }
    return out;
  };
  const equipment = byId(rows.equipment, 'movement_equipment', (c) => equipmentSchema.parse(c));
  const primary = byId(rows.primaryMuscles, 'primary movement_muscles', (c) =>
    muscleSchema.parse(c),
  );
  const secondary = byId(rows.secondaryMuscles, 'secondary movement_muscles', (c) =>
    muscleSchema.parse(c),
  );
  return new Map(
    listed.map((row) => {
      const primaries = primary.get(row.id) ?? [];
      if (primaries.length > 1)
        throw new Error(
          `catalogTaxonomyOf: movement ${row.id} has ${primaries.length} primary muscles`,
        );
      return [
        row.id,
        {
          modality: modalitySchema.parse(row.modality),
          pattern: row.pattern === null ? null : movementPatternSchema.parse(row.pattern),
          equipment: equipmentInOrder(equipment.get(row.id) ?? []),
          primaryMuscle: primaries[0] ?? null,
          secondaryMuscles: musclesInOrder(secondary.get(row.id) ?? []),
        },
      ];
    }),
  );
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
 * | catalog row | yes | `catalogOptionOf(entry)` with the row's identity written over it, and **the tables' taxonomy**; no `group` |
 * | catalog row | no | the row's identity; no aliases, no supervision, no instructions; **the tables' taxonomy**; listed, never dropped (K22) |
 *
 * **Which rows are catalog rows is the read's call** (`movementIsCatalog()`, selected as a column): it
 * passes `tables` for exactly those, so an old built-in is never given the tables' (empty) answer.
 *
 * **The row's identity always wins** (name, tracking type, unit, bodyweight flag): the row is what a
 * save, a log and `newItem` use, so the picker must never promise a type the save then reads
 * differently. Because the read applies this, `newItem` matches over exactly the aliases the picker
 * shows (K23).
 */
export function catalogArmOption(
  row: CatalogArmRow,
  pickerEntry: MovementPickerEntry | undefined,
  libraryEntry: CatalogMovement | undefined,
  /** A catalog row's taxonomy from the tables (`catalogTaxonomyOf`); `undefined` for an old built-in. */
  tables?: CatalogArmTaxonomy,
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
    taxonomy:
      tables ??
      (fromLibrary
        ? {
            modality: fromLibrary.modality,
            pattern: fromLibrary.pattern,
            equipment: fromLibrary.equipment,
            primaryMuscle: fromLibrary.primaryMuscle,
            secondaryMuscles: fromLibrary.secondaryMuscles,
          }
        : null),
    supervision: fromLibrary?.supervision ?? null,
    hasInstructions: fromLibrary?.hasInstructions ?? false,
  };
}

/**
 * A read option as `existingItem` matches it: `isCatalog` from `owner`, and a catalog item's aliases
 * only (a household item's typed name is never an alias). **The one mapping** `newItem` uses over the
 * read's options, so it matches the fields the picker's search reads (CAT-3 K23). ⏳ The client's own
 * copy (`movement-picker.tsx`'s `matchable`) predates this; folding it in is a follow-up.
 */
export function matchableOption<
  O extends { readonly owner: 'catalog' | 'household'; readonly aliases?: readonly string[] },
>(option: O): O & { readonly isCatalog: boolean; readonly aliases: readonly string[] } {
  return {
    ...option,
    isCatalog: option.owner === 'catalog',
    aliases: option.owner === 'catalog' ? (option.aliases ?? []) : [],
  };
}
