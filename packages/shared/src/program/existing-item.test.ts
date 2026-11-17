import { describe, expect, it } from 'vitest';

import { MOVEMENT_PICKER_ALIASES } from '../movement-picker-catalog';
import { matchMovementOptions, searchMovementOptions } from '../movement-search';

import { existingItem } from './pieces';
import { NEW_ITEM_NAME_MESSAGES, newItemSchema } from './program-shapes';

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
    // The sentence a form shows for it: it must not ask for a letter, since one was typed.
    const refused = newItemSchema.safeParse({ name: 'S', trackingType: 'check' });
    expect(refused.success ? null : refused.error.issues[0]?.message).toBe(
      NEW_ITEM_NAME_MESSAGES.noKey,
    );
    expect(NEW_ITEM_NAME_MESSAGES.noKey).toBe('Give the item a longer name.');
  });

  it('when two items qualify, the answer is the picker’s first row', () => {
    // A household item named after the alias, made before the rule: `RDL` is its own name, and an
    // own name comes before another name (C30; until then the catalog's item won this case).
    const stray = { id: 'stray', name: 'RDL', isCatalog: false };
    for (const options of [
      [stray, ...OPTIONS],
      [...OPTIONS, stray],
    ]) {
      expect(existingItem(options, 'rdl')?.id).toBe('stray');
      expect(existingItem(options, 'rdl')).toBe(
        searchMovementOptions(options, { query: 'rdl' }).matches[0],
      );
      // The catalog's item is still itself by its own name.
      expect(existingItem(options, 'romanian deadlift')?.id).toBe('rdl');
    }
    // Two items with one name key: the catalog's, whichever order the rows arrive in.
    const twin = { id: 'twin', name: 'Push ups', isCatalog: false };
    expect(existingItem([twin, ...OPTIONS], 'pushups')?.isCatalog).toBe(true);
    expect(existingItem([...OPTIONS, twin], 'pushups')?.isCatalog).toBe(true);
  });

  it('is exactly the three cases in which the picker withholds "add as new"', () => {
    const options = [...OPTIONS, { id: 'dbrow', name: 'Dumbbell row', isCatalog: true }];
    const typedNames = ['RDL', 'push ups', 'RDL pause', 'Dead', 'Lunge', 'bear crawl', ''];
    for (const typed of [...typedNames, 'db row', 'DB Rows', 'db', 'kb row', 'dumbbell']) {
      const { exact, aliasHit, shortFormHit } = searchMovementOptions(options, { query: typed });
      expect(existingItem(options, typed) !== undefined, typed).toBe(
        exact || aliasHit !== null || shortFormHit !== null,
      );
      // The first two are the plain match's own, as they were before short forms existed.
      const plain = matchMovementOptions(options, typed);
      expect([exact, aliasHit], typed).toEqual([plain.exact, plain.aliasHit]);
    }
  });

  it('🔴 an abbreviation that spells an item is that item (C30)', () => {
    const options = [...OPTIONS, { id: 'dbrow', name: 'Dumbbell row', isCatalog: true }];
    for (const typed of ['db row', 'DB row', 'db rows', ' Db  Row ']) {
      expect(existingItem(options, typed)?.id, typed).toBe('dbrow');
    }
    // Only when the whole name is spelt: part of it, or another abbreviation, names no item.
    for (const typed of ['db', 'db ro', 'kb row', 'db row pause', 'dbrow']) {
      expect(existingItem(options, typed), typed).toBeUndefined();
    }
    // A household item literally named "db row" is itself, by its own name, before anything else.
    const own = { id: 'own', name: 'DB row', isCatalog: false };
    expect(existingItem([...options, own], 'db row')?.id).toBe('own');
  });

  it('a part of a name, or of another name, finds a movement in the picker and names no item here', () => {
    const press = {
      id: 'ohp',
      name: 'Overhead press',
      isCatalog: true,
      aliases: ['Military press'],
    };
    const options = [...OPTIONS, press];
    for (const typed of ['roman', 'military', 'milit', 'overhead', 'rdl x']) {
      expect(searchMovementOptions(options, { query: typed }).matches.length, typed).toBe(
        typed === 'rdl x' ? 0 : 1,
      );
      expect(existingItem(options, typed), typed).toBeUndefined();
    }
    expect(existingItem(options, 'military press')?.id).toBe('ohp');
  });

  it('two spellings of one name: the catalog item, whichever spelling is typed', () => {
    const own = { id: 'own', name: 'Pushups', isCatalog: false };
    for (const options of [
      [own, ...OPTIONS],
      [...OPTIONS, own],
    ]) {
      for (const typed of ['Push-ups', 'Pushups', 'push ups']) {
        expect(existingItem(options, typed)?.id, typed).toBe('pushups');
      }
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
