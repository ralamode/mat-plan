import { z } from 'zod';

import { movementNameSchema, type MovementPattern, type TrackingType } from '../movements';
import type { Unit } from '../units';
import { catalogInstructionsSchema, type CatalogMovement } from './entry';
import {
  EQUIPMENT,
  MUSCLES,
  supervisionSchema,
  type Equipment,
  type Modality,
  type Muscle,
  type Supervision,
} from './vocabulary';

/**
 * What the picker knows about a library movement beyond its name (CAT-3 spec, chunk C0b-2; P11):
 * the fields a filter, a browse heading and a row's second line read.
 *
 * 🔴 **It carries the equipment SET, not an answer about it.** "Uses any of these" (today's
 * filter, P7) and "needs nothing beyond these" (a later "my equipment" filter) are two rules over
 * the same set; a boolean here would have fixed one of them into the shape.
 *
 * **`hasInstructions`, never the text.** The steps are read by slug when a row's "How to" is
 * opened (`catalogHowToOf`, spec rule 11 and P16), so the option list does not grow by a few
 * hundred characters for each of several hundred movements.
 *
 * A household's own item has none of this in Beta 0 (rule 11): the picker's option type takes
 * these fields on its `catalog` arm only.
 */
export type CatalogOptionTaxonomy = {
  readonly modality: Modality;
  /** The lift pattern: set on every strength movement, `null` on most others. */
  readonly pattern: MovementPattern | null;
  /** Everything it needs. Empty means no equipment. In the vocabulary's order (`equipmentInOrder`). */
  readonly equipment: readonly Equipment[];
  readonly primaryMuscle: Muscle | null;
  /** In the vocabulary's order (`musclesInOrder`). */
  readonly secondaryMuscles: readonly Muscle[];
  /** `null` on all but the few movements the maintainer marks (K14). Shown as text, never a gate. */
  readonly supervision: Supervision | null;
  readonly hasInstructions: boolean;
};

/**
 * A movement's equipment in the one order every reader lists it: the vocabulary's (`EQUIPMENT`).
 *
 * **The order an entry was written in means nothing** (spec K31; maintainer, 2026-11-19). The
 * tables that hold a movement's equipment keep no order either, so a read that returned "whatever
 * came back" and a mapping that returned "as authored" would word one movement's "what it needs"
 * two ways. Both call this instead. Returns a new array; a value named twice comes back once.
 *
 * ⚠️ **A code that is not in the vocabulary is left out, without an error.** An entry cannot hold
 * one (`equipmentSchema`). A read that takes codes from the tables parses them with
 * `equipmentSchema` / `muscleSchema` first, so an unknown code fails there and does not vanish here.
 */
export function equipmentInOrder(equipment: readonly Equipment[]): Equipment[] {
  return EQUIPMENT.filter((item) => equipment.includes(item));
}

/** A movement's muscles in the vocabulary's order (`MUSCLES`): `equipmentInOrder`'s rule, for muscles. */
export function musclesInOrder(muscles: readonly Muscle[]): Muscle[] {
  return MUSCLES.filter((muscle) => muscles.includes(muscle));
}

/**
 * One library movement as the picker's option read returns it (P11): the option's own fields and
 * its taxonomy. `owner: 'catalog'` is the discriminant the picker's option type already uses.
 */
export type CatalogOption = {
  readonly publicId: string;
  readonly owner: 'catalog';
  readonly name: string;
  readonly aliases: readonly string[];
  readonly trackingType: TrackingType;
  readonly unitDefault: Unit | null;
  readonly isBodyweight: boolean;
} & CatalogOptionTaxonomy;

/**
 * The option one library entry becomes, given the row's public id.
 *
 * **The one mapping from an entry to an option.** The option read (`packages/db`, P11) is compared
 * with this, the preview builds its options with it, and a fixture option is this over a fixture
 * entry: so the three cannot disagree about which field of the entry feeds which field of the
 * option. Pure, and it copies the arrays, so an option never aliases the library const.
 *
 * **Equipment and secondary muscles come back in the vocabulary's order**, whatever order the
 * entry lists them in (`equipmentInOrder`, `musclesInOrder`; spec K31). Aliases keep the entry's
 * order: search ranks by it.
 *
 * ⏳ **Until the catalog's fresh start the real picker's option is not always this** (spec K22).
 * The option read builds every catalog-arm row through `catalogArmOption`
 * (`packages/db/src/queries/program/catalog-arm-option.ts`, which owns the four-case table), with
 * this mapping's fields on the database row's identity: the row's name, tracking type, unit and
 * bodyweight flag always win, since the row is what a save and a log use. The web DAL only copies
 * what the read built. After the fresh start every global row is a catalog row seeded from the
 * const, and the option is this mapping again.
 */
export function catalogOptionOf(entry: CatalogMovement, publicId: string): CatalogOption {
  return {
    publicId,
    owner: 'catalog',
    name: entry.name,
    aliases: [...entry.aliases],
    trackingType: entry.trackingType,
    unitDefault: entry.unitDefault,
    isBodyweight: entry.isBodyweight,
    modality: entry.modality,
    pattern: entry.pattern,
    equipment: equipmentInOrder(entry.equipment),
    primaryMuscle: entry.primaryMuscle,
    secondaryMuscles: musclesInOrder(entry.secondaryMuscles),
    supervision: entry.supervision ?? null,
    hasInstructions: entry.instructions !== undefined,
  };
}

/** What "How to" shows for one movement (P16, K17): the steps, with the label that goes above them. */
export const catalogHowToSchema = z.strictObject({
  name: movementNameSchema,
  /** One step a line, as authored. */
  instructions: catalogInstructionsSchema,
  supervision: supervisionSchema.nullable(),
});
export type CatalogHowTo = Readonly<z.infer<typeof catalogHowToSchema>>;

/**
 * One entry's "How to", by slug, or `null` when there is no such entry or it has no instructions.
 *
 * It takes the entries as an argument because the library const is server-only
 * (`@mat-plan/shared/catalog/data`, spec rule 3): the server passes `CATALOG_MOVEMENTS`, the
 * preview passes the test library. 🔴 **The supervision label comes back with the text, always**
 * (K17: wherever instructions are shown, the label is shown with them), so a caller cannot show
 * one without having the other in hand.
 *
 * **By slug, and an option carries none** (a slug is the library's key, never a row's public
 * id): the read behind "How to" (a Route Handler, `app/programs/how-to/[optionId]/route.ts`,
 * FAM-1 7b) takes the option's `publicId`, finds that row's slug under the caller's scope, and
 * calls this. It builds its answer with `catalogHowToSchema`, which is strict, so no slug or id
 * can ride along; the picker's loader parses with the same schema.
 */
export function catalogHowToOf(
  entries: readonly CatalogMovement[],
  slug: string,
): CatalogHowTo | null {
  const entry = entries.find((candidate) => candidate.slug === slug);
  if (!entry || entry.instructions === undefined) return null;
  return {
    name: entry.name,
    instructions: entry.instructions,
    supervision: entry.supervision ?? null,
  };
}
