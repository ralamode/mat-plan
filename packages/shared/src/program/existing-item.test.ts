import { describe, expect, it } from 'vitest';

import { MOVEMENT_PICKER_ALIASES } from '../movement-picker-catalog';
import { matchMovementOptions } from '../movement-search';

import { existingItem } from './pieces';
import { newItemSchema } from './program-shapes';

/**
 * `existingItem`: what `newItem` treats as "this item already exists" (FAM-1 contract change C8).
 * The preview's fake calls it and the real writer will (plan step 6a), so a typed name selects the
 * same item on the preview route and in production.
 */
const OPTIONS = [
  { id: 'rdl', name: 'Romanian Deadlift', isCatalog: true, aliases: ['RDL'] },
  { id: 'pushups', name: 'Push-ups', isCatalog: true, aliases: [] },
  { id: 'crawl', name: 'Bear crawl', isCatalog: false },
  { id: 'deadlift', name: 'Deadlift', isCatalog: true },
] as const;

describe('existingItem: the item a typed name already names', () => {
  it.each([
    ['Push-ups', 'pushups'],
    ['push ups', 'pushups'],
    ['  PUSHUPS ', 'pushups'],
    ['bear crawls', 'crawl'],
    ['Romanian deadlift', 'rdl'],
  ])('"%s" is an item by its name’s key', (typed, id) => {
    expect(existingItem(OPTIONS, typed)?.id).toBe(id);
  });

  it.each(['RDL', 'rdl', ' R.D.L. ', 'rdls'])('"%s" is Romanian Deadlift by its alias', (typed) => {
    expect(existingItem(OPTIONS, typed)?.id).toBe('rdl');
  });

  it.each(['RDL pause', 'rd', 'Dead', 'Romanian', 'Bear', 'push', 'Lunge'])(
    '"%s" names no item: a partial match is the picker’s list, not a duplicate',
    (typed) => {
      expect(existingItem(OPTIONS, typed)).toBeUndefined();
    },
  );

  it('a name with nothing to key on names no item, even one that is itself in the list', () => {
    for (const typed of ['', '   ', '--', '’'])
      expect(existingItem(OPTIONS, typed)).toBeUndefined();
    // `S` has a letter but the fold drops a lone `s`: its key is empty, so it matches nothing, not
    // even an item of the same name. `newItemSchema` refuses such a name for that reason.
    const withS = [...OPTIONS, { id: 's', name: 'S', isCatalog: false }];
    for (const typed of ['S', "S's", 's s']) {
      expect(existingItem(withS, typed), typed).toBeUndefined();
      expect(newItemSchema.safeParse({ name: typed, trackingType: 'check' }).success, typed).toBe(
        false,
      );
    }
    expect(newItemSchema.safeParse({ name: 'Ss', trackingType: 'check' }).success).toBe(true);
  });

  it('when two items qualify, the catalog one is the answer', () => {
    // A household item named after the alias, made before the rule; the alias still means the
    // catalog's item, whichever order the rows arrive in.
    const stray = { id: 'stray', name: 'RDL', isCatalog: false };
    expect(existingItem([stray, ...OPTIONS], 'rdl')?.id).toBe('rdl');
    expect(existingItem([...OPTIONS, stray], 'rdl')?.id).toBe('rdl');
  });

  it('is exactly the two cases in which the picker withholds "add as new"', () => {
    for (const typed of ['RDL', 'push ups', 'RDL pause', 'Dead', 'Lunge', 'bear crawl', '']) {
      const { exact, aliasHit } = matchMovementOptions(OPTIONS, typed);
      expect(existingItem(OPTIONS, typed) !== undefined, typed).toBe(exact || aliasHit !== null);
    }
  });

  it('honours every alias the catalog declares', () => {
    // Each alias reaches its own item when the options carry it, so the writer has only to pass the
    // catalog's aliases through.
    const catalog = MOVEMENT_PICKER_ALIASES.map(({ alias, slug }) => ({
      id: slug,
      name: `the movement ${slug}`,
      isCatalog: true,
      aliases: [alias],
    }));
    expect(catalog.length).toBeGreaterThan(0);
    for (const { alias, slug } of MOVEMENT_PICKER_ALIASES) {
      expect(existingItem(catalog, alias)?.id, alias).toBe(slug);
    }
  });
});
