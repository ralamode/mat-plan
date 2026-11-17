import { z } from 'zod';

import {
  movementLabelSchema,
  movementNameSchema,
  movementPatternSchema,
  movementSlug,
  trackingTypeSchema,
} from '../movements';
import { hasALetter, hasCommaOrLineBreak } from '../text';
import { unitSchema } from '../units';
import {
  equipmentSchema,
  mediaKindSchema,
  MODALITY,
  modalitySchema,
  muscleSchema,
  supervisionSchema,
} from './vocabulary';

/** The most characters an entry's instructions may have: a few short lines, read on a phone. */
export const CATALOG_INSTRUCTIONS_MAX = 600;

/**
 * A character a reader cannot see, or one that reorders what they do see: a control character, a
 * format character (a zero-width space, a bidi override) or a line or paragraph separator.
 * A literal class with no interpolation.
 */
const UNSEEN_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * How to do the movement, **in our own words** (decision K17): one or more lines, each a plain
 * sentence or two. Written here and reviewed with the entry; never taken from a source (K16).
 *
 * Held to its written form, so the approval hash is of what a person will read:
 *
 * - lines are split on `\n`; no line is blank, has a space at either end, or lacks a letter;
 * - **no character a reader cannot see**: no control or format character (a zero-width space, a
 *   bidi override, a carriage return) and no line or paragraph separator, which would show as a
 *   break the split never saw;
 * - **no web address** (`://`, `www.`), for the reasons `media` holds none: a link sends a child's
 *   device to a third party, can change after review, and is how an entry would name a source.
 *
 * It describes the movement. It names no load, no dose and no readiness or medical claim (K13).
 */
export const catalogInstructionsSchema = z
  .string()
  .min(1)
  .max(CATALOG_INSTRUCTIONS_MAX)
  .refine(
    (text) =>
      text.split('\n').every((line) => line !== '' && line === line.trim() && hasALetter(line)),
    'each line has words and no space at either end',
  )
  .refine(
    (text) => text.split('\n').every((line) => !UNSEEN_PATTERN.test(line)),
    'no character a reader cannot see',
  )
  .refine((text) => !/:\/\/|www\./i.test(text), 'no web address');

/** The most characters a media key may have. */
export const CATALOG_MEDIA_KEY_MAX = 80;

/**
 * A pointer to a video or an animation of the movement (decision K18). **Reserved: no entry has
 * one yet**, and none may until media has its own plan (where it is hosted, who can see it).
 *
 * 🔴 **`key` names a file in the app's own media store. It is never a URL.** An address on someone
 * else's site would send a child's device to a third party, could change after it was reviewed,
 * and would put an outbound link in reviewed data. So a key is lower-case words joined by `-` or
 * `_`: nothing that can spell a scheme, a host or a path.
 */
export const catalogMediaSchema = z.strictObject({
  kind: mediaKindSchema,
  key: z
    .string()
    .max(CATALOG_MEDIA_KEY_MAX)
    .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'lower-case words joined by - or _'),
});
export type CatalogMedia = z.infer<typeof catalogMediaSchema>;

/**
 * One movement of the library, as the catalog const holds it
 * ([spec](../../../../docs/specs/cat-3-movement-library.md), chunk C0a, V2).
 *
 * **Strict, and with no id.** A catalog row's `public_id` is minted when the row is seeded and is
 * never committed (spec rule 5), so there is no field for one, and no field says where an entry
 * came from (decision K16: the library is authored and reviewed in-house).
 *
 * What the schema holds, beyond each field's own type:
 *
 * - **`name` passes `movementNameSchema`.** The CSV export prints a movement's slug, and a comma or
 *   a line break in a name would fail a household's whole month (`typedMovementNameIssues`).
 * - **The slug is `movementSlug` of the name or of an alias** (spec rule 4). A new entry's slug is
 *   `movementSlug(name)`; a shipped slug never changes, so a corrected name keeps its slug and the
 *   old name becomes an alias. The lockfile (`./data/shipped.json`) is what stops a shipped slug or
 *   its tracking type changing.
 * - **The slug has no comma and no line break**, whichever name it came from. The slug is what the
 *   export prints, and an alias, unlike a name, may hold a comma.
 * - **A `strength` entry has a `pattern` and a primary muscle.** Other modalities may have
 *   neither: a run has no lift pattern and no one muscle.
 * - **The primary muscle is not also a secondary**, and no list repeats a member.
 * - **`instructions` and `media` are optional** (`catalogInstructionsSchema`,
 *   `catalogMediaSchema`). Like aliases and the supervision label they stay in the const and are
 *   read by slug (spec rule 11): reviewed text is never copied into a row that could drift from it.
 */
export const catalogMovementSchema = z
  .strictObject({
    slug: z.string().min(1),
    name: movementNameSchema,
    /** Other names people type for it, old names included. Matched by `movementNameKey`. */
    aliases: z.array(movementLabelSchema),
    modality: modalitySchema,
    pattern: movementPatternSchema.nullable(),
    /** One of FAM-1's seven, set once (plan D1, D25). The lockfile pins it. */
    trackingType: trackingTypeSchema,
    unitDefault: unitSchema.nullable(),
    /** The load is chiefly the body's own mass. Not the same as needing no equipment. */
    isBodyweight: z.boolean(),
    /** Everything it needs: a required SET. Empty means no equipment. */
    equipment: z.array(equipmentSchema),
    primaryMuscle: muscleSchema.nullable(),
    secondaryMuscles: z.array(muscleSchema),
    /** Absent on all but the few movements the maintainer marks (K14). */
    supervision: supervisionSchema.optional(),
    /** How to do it, in our own words (K17). Absent until written. */
    instructions: catalogInstructionsSchema.optional(),
    /** Reserved (K18): absent on every entry until media has its own plan. */
    media: catalogMediaSchema.optional(),
  })
  .superRefine((entry, ctx) => {
    const names = [entry.name, ...entry.aliases];
    if (!names.some((name) => movementSlug(name) === entry.slug)) {
      ctx.addIssue({
        code: 'custom',
        path: ['slug'],
        message: 'the slug is movementSlug of the name or of an alias',
      });
    }
    if (hasCommaOrLineBreak(entry.slug)) {
      ctx.addIssue({
        code: 'custom',
        path: ['slug'],
        message: 'a slug has no comma and no line break: the CSV export prints it',
      });
    }
    if (entry.modality === MODALITY.strength && (!entry.pattern || !entry.primaryMuscle)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pattern'],
        message: 'a strength movement has a pattern and a primary muscle',
      });
    }
    if (entry.primaryMuscle && entry.secondaryMuscles.includes(entry.primaryMuscle)) {
      ctx.addIssue({
        code: 'custom',
        path: ['secondaryMuscles'],
        message: 'the primary muscle is not also a secondary',
      });
    }
    for (const key of ['aliases', 'equipment', 'secondaryMuscles'] as const) {
      if (new Set<string>(entry[key]).size !== entry[key].length) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'no member twice' });
      }
    }
  });

export type CatalogMovement = z.infer<typeof catalogMovementSchema>;

/**
 * Whether a movement needs no equipment at all: its required set is empty.
 *
 * 🔴 **The one definition, and it is computed.** Nothing stores this answer (spec V5): a stored
 * flag would drift from the set the first time an entry's equipment was corrected. It takes
 * anything that carries the set, so the picker passes an option and the seed an entry.
 */
export function requiresNoEquipment(movement: { equipment: readonly unknown[] }): boolean {
  return movement.equipment.length === 0;
}
