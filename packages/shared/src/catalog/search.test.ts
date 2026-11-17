import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  editsWithin,
  foldMovementQuery,
  matchMovementOptions,
  movementNameKey,
  searchMovementOptions,
  SEARCH_WORDS_MAX,
  type MatchableMovement,
} from '../movement-search';
import { MOVEMENT_NAME_MAX } from '../movements';
import { SRC } from '../test-support/source-graph';
import { CATALOG_FIXTURE } from './fixture';
import { QUERY_SHORT_FORMS } from './vocabulary';

/**
 * CAT-3's contract, chunk C0b-1 (docs/specs/cat-3-movement-library.md): the library's search,
 * criteria P1 to P4 and the contract's half of P6, on `CATALOG_FIXTURE`.
 */

type Option = MatchableMovement & { slug: string };
/** The test library as the picker will offer it. */
const OPTIONS: readonly Option[] = CATALOG_FIXTURE.map((entry) => ({
  slug: entry.slug,
  name: entry.name,
  isCatalog: true,
  aliases: entry.aliases,
}));
/** The test library plus the three names the spec's own near-miss examples use. */
const LIBRARY: readonly Option[] = [
  ...OPTIONS,
  ...['Bulgarian split squat', 'Kettlebell swing', 'Kettlebell press'].map((name) => ({
    slug: name,
    name,
    isCatalog: true,
    aliases: [],
  })),
];

const search = (query: string, options: readonly Option[] = OPTIONS) =>
  searchMovementOptions(options, { query });
const names = (found: readonly Option[]) => found.map((option) => option.name);

describe('the vector table, ported onto the test library (P2)', () => {
  // The legacy table (`movement-search.test.ts`) is the picker's contract over the 35 seeded
  // names. These are the same kinds of query over `CATALOG_FIXTURE`: a plural, a compact form, a
  // possessive, a short alias, some-words. `withheld` is "Use as typed must NOT be offered".
  const VECTORS: readonly {
    query: string;
    expect: readonly string[];
    exact: boolean;
    withheld: boolean;
    someWords?: readonly string[];
  }[] = [
    { query: 'chin ups', expect: ['Chin-up', 'Weighted chin-up'], exact: true, withheld: true },
    { query: 'chinups', expect: ['Chin-up', 'Weighted chin-up'], exact: true, withheld: true },
    { query: 'push-up', expect: ['Incline push-up'], exact: false, withheld: false },
    { query: "Suitcase's carry", expect: ['Suitcase carry'], exact: true, withheld: true },
    {
      query: 'suitcase walk',
      expect: [],
      exact: false,
      withheld: false,
      someWords: ['Suitcase carry'],
    },
    { query: 'trapbar', expect: ['Trap bar carry'], exact: false, withheld: false },
    { query: 'slrdl', expect: ['Single-leg Romanian deadlift'], exact: false, withheld: true },
    { query: 'reverse lunges', expect: ['Reverse lunge'], exact: true, withheld: true },
    {
      query: 'row',
      expect: ['Rowing machine', 'Rowing machine intervals', 'Dumbbell row'],
      exact: false,
      withheld: false,
    },
  ];

  it.each(VECTORS)('$query', ({ query, expect: wanted, exact, withheld, someWords }) => {
    const result = search(query);
    expect(names(result.matches)).toEqual(wanted);
    expect(result.exact).toBe(exact);
    expect(result.exact || result.aliasHit !== null).toBe(withheld);
    if (someWords) expect(names(result.someWords)).toEqual(someWords);
  });

  it('an alias hits exactly, and names which alias hit', () => {
    expect(search('slrdl').aliasHit).toBe('SLRDL');
    // Punctuation folds away. (Not `S.L.R.D.L.`: a lone `s` is dropped as a possessive's.)
    expect(search('SL-RDL').aliasHit).toBe('SLRDL');
    expect(search('slrd').aliasHit).toBeNull();
    expect(search('strict press').aliasHit).toBe('Strict press');
  });
});

/** Queries of every kind the rules below are about, for the two "equals" properties. */
const QUERIES = [
  ...CATALOG_FIXTURE.flatMap((entry) => [entry.name, ...entry.aliases]),
  ...CATALOG_FIXTURE.map((entry) => entry.name.slice(0, 4)),
  ...['', '   ', '—', 'v', 'row', 'press', 'chin ups', 'trapbar', 'suitcase walk', 'zzzz'],
  ...['db', 'db row', 'DB Row', 'dbs', 'kb swing', 'bb', 'ez curl', 'trx row', 'zz db'],
  ...['éz curl', 'ｄｂ row', 'db2 row', 'dbrow'],
  ...['dedlift', 'chinnup', 'kettelbell swing', 'dress', 'hand', 'split', 'bulgarain'],
];
/** Whether the code reads a short form in this query: its own fold, its own lookup. */
const hasShortForm = (query: string) =>
  foldMovementQuery(query)
    .split(' ')
    .some((word) => Object.hasOwn(QUERY_SHORT_FORMS, word));

describe('what the server and "Use as typed" read (P1)', () => {
  it.each([OPTIONS, LIBRARY])(
    '🔴 exact and aliasHit are matchMovementOptions’ for the query as typed, always',
    (...options) => {
      for (const query of QUERIES) {
        const typed = matchMovementOptions(options, query);
        const found = searchMovementOptions(options, { query });
        expect([found.exact, found.aliasHit], query).toEqual([typed.exact, typed.aliasHit]);
      }
    },
  );

  it('🔴 a short form never makes a name "already in the list"', () => {
    // `db row` finds Dumbbell row, and a household may still make an item called "db row".
    const found = search('db row');
    expect(names(found.matches)).toEqual(['Dumbbell row']);
    expect(found.exact).toBe(false);
    expect(found.aliasHit).toBeNull();
    expect(movementNameKey('db row')).not.toBe(movementNameKey('Dumbbell row'));
  });

  it('nor does a near miss', () => {
    const found = search('dedlift');
    expect(found.near).not.toEqual([]);
    expect(found.exact || found.aliasHit !== null).toBe(false);
  });
});

describe('with no short form, the matches are matchMovementOptions’ (P2)', () => {
  it('the same rows in the same order, and the same some-words', () => {
    let compared = 0;
    for (const query of QUERIES.filter((q) => !hasShortForm(q))) {
      const typed = matchMovementOptions(LIBRARY, query);
      const found = search(query, LIBRARY);
      expect(found.matches, query).toEqual(typed.matches);
      expect(found.someWords, query).toEqual(typed.someWords);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(60);
    // The split itself: the short-form queries are the ones left out, and there are some.
    expect(QUERIES.filter(hasShortForm)).toEqual(
      expect.arrayContaining(['db', 'db row', 'dbs', 'kb swing', 'zz db', 'éz curl', 'ｄｂ row']),
    );
    // An accent and a full-width letter fold to the short form; a digit beside it does not.
    expect(hasShortForm('db2 row')).toBe(false);
    expect(hasShortForm('dbrow')).toBe(false);
  });
});

describe('equipment short forms (P3)', () => {
  it('a short form is also read as the words it stands for', () => {
    expect(names(search('db row').matches)).toEqual(['Dumbbell row']);
    expect(names(search('DB Row').matches)).toEqual(['Dumbbell row']);
    expect(names(search('db').matches)).toEqual(names(search('dumbbell').matches));
    expect(names(search('dbs').matches)).toEqual(names(search('dumbbell').matches));
    expect(search('dumbbell').matches.length).toBeGreaterThan(1);
  });

  it('every short form in the vocabulary expands to its own words', () => {
    for (const [short, long] of Object.entries(QUERY_SHORT_FORMS)) {
      const item: Option = { slug: long, name: `${long} thing`, isCatalog: true, aliases: [] };
      expect(names(search(`${short} thing`, [item]).matches), short).toEqual([item.name]);
    }
  });

  it('only as a whole word', () => {
    expect(search('dbrow').matches).toEqual([]);
    expect(search('adb row').matches).toEqual([]);
  });

  it('🔴 rows found only through a short form come after the rows the typed words find', () => {
    const own: Option = { slug: 'own', name: 'DB special', isCatalog: false, aliases: [] };
    const found = search('db', [...OPTIONS, own]);
    expect(names(found.matches)).toEqual([
      'DB special',
      ...names(matchMovementOptions(OPTIONS, 'dumbbell').matches),
    ]);
    // And they count as matches: nothing is offered as "some of your words" or as a near miss.
    expect(found.someWords).toEqual([]);
    expect(found.near).toEqual([]);
  });

  it('lists no row twice when the typed words and the short form both find it', () => {
    const both: Option = { slug: 'x', name: 'DB dumbbell row', isCatalog: false, aliases: [] };
    const found = names(search('db', [...OPTIONS, both]).matches);
    expect(new Set(found).size).toBe(found.length);
    expect(found[0]).toBe('DB dumbbell row');
  });

  it('with nothing matched, the expanded words still offer some-words', () => {
    // `zz db` matched nothing in the legacy list and offered nothing, because `db` was two
    // letters. Here `db` means dumbbell, so the dumbbell rows are the helpful fallback.
    expect(search('zz db').matches).toEqual([]);
    expect(names(search('zz db').someWords)).toEqual(
      names(matchMovementOptions(OPTIONS, 'dumbbell').matches),
    );
  });

  it('a word that is a property of every object is a word', () => {
    for (const query of ['constructor', 'toString', '__proto__', 'hasOwnProperty row']) {
      expect(() => search(query)).not.toThrow();
    }
    expect(search('constructor').matches).toEqual([]);
  });
});

describe('near misses (P4)', () => {
  it.each([
    ['bulgarain', ['Bulgarian split squat']],
    ['dedlift', ['Single-leg Romanian deadlift']],
    ['kettelbell swing', ['Kettlebell swing']],
    ['chinnup', ['Chin-up']],
    ['strcit press', ['Overhead press']],
    ['db inclien', ['Incline dumbbell press']],
  ])('%j finds %j', (query, wanted) => {
    const found = search(query, LIBRARY);
    expect(found.matches).toEqual([]);
    expect(names(found.near)).toEqual(wanted);
  });

  it.each([
    ['dress', 'the first letter must agree, so not a press'],
    ['split', 'three edits from squat'],
    ['hand', 'four letters: never a near miss, so not a hang'],
    ['siutcsae', 'two edits in an eight-letter word'],
    ['zzzzzz', 'nothing like it'],
    ['kb swnig', 'a short word that is in no name'],
  ])('%j finds nothing (%s)', (query) => {
    expect(search(query).matches).toEqual([]);
    expect(search(query).near).toEqual([]);
  });

  it('allows two edits from nine letters, and one below', () => {
    // rommanain → romanian: one letter out, one pair swapped.
    expect(names(search('rommanain').near)).toEqual(['Single-leg Romanian deadlift']);
    expect('rommanain').toHaveLength(9);
    expect(editsWithin('rommanain', 'romanian', 2)).toBe(2);
    expect(search('rommanai').near).toEqual([]);
  });

  it('every word must be in the option: one misspelt word does not bring its whole family', () => {
    const found = names(search('kettelbell swing', LIBRARY).near);
    expect(found).not.toContain('Kettlebell press');
    expect(names(search('kettelbell', LIBRARY).near).sort()).toEqual([
      'Kettlebell press',
      'Kettlebell swing',
    ]);
  });

  it('🔴 is empty whenever anything matches', () => {
    for (const query of QUERIES) {
      const found = search(query, LIBRARY);
      if (found.matches.length > 0) expect(found.near, query).toEqual([]);
    }
    // A query that is one edit from another name and also matches one is a match.
    expect(names(search('chin-up').matches)).toContain('Chin-up');
    expect(search('chin-up').near).toEqual([]);
  });

  const only = (...list: (string | Option)[]): Option[] =>
    list.map((item) =>
      typeof item === 'string' ? { slug: item, name: item, isCatalog: true, aliases: [] } : item,
    );

  it('🔴 lists the closest first: one edit before two', () => {
    // Alphabetical order would put the two-edit name first.
    const options = only('Dandlifft', 'Deadlift');
    expect(editsWithin('deadlifft', 'dandlifft', 2)).toBe(2);
    expect(editsWithin('deadlifft', 'deadlift', 2)).toBe(1);
    expect(names(search('deadlifft', options).near)).toEqual(['Deadlift', 'Dandlifft']);
    expect(names(search('deadlifft', [...options].reverse()).near)).toEqual([
      'Deadlift',
      'Dandlifft',
    ]);
  });

  it('on a tie, the library’s entry before a household’s own', () => {
    const own: Option = { slug: 'own', name: 'Deadlift', isCatalog: false, aliases: [] };
    const library: Option = { slug: 'lib', name: 'Deadlift', isCatalog: true, aliases: [] };
    expect(search('dedlift', [own, library]).near.map((o) => o.slug)).toEqual(['lib', 'own']);
    expect(search('dedlift', [library, own]).near.map((o) => o.slug)).toEqual(['lib', 'own']);
  });

  it('🔴 the whole-name test needs the same first letter too', () => {
    // Only the spaces-out test could match these: each name is one word, one edit away.
    expect(search('dress', only('Press')).near).toEqual([]);
    expect(search('shinup', only('Chin-up')).near).toEqual([]);
    expect(names(search('chinnup', only('Chin-up')).near)).toEqual(['Chin-up']);
  });

  it('🔴 a short word must be part of the NAME: an alias does not stand in for it', () => {
    const item: Option = {
      slug: 'x',
      name: 'Lying extension',
      isCatalog: true,
      aliases: ['Skull crusher'],
    };
    // `skul` is four letters: never a near miss, and it is in no name.
    expect(search('skul extension', [item]).near).toEqual([]);
    // Five letters or more may be a near miss of an alias's word.
    expect(names(search('skulll extension', [item]).near)).toEqual(['Lying extension']);
  });

  it('lists the closest first, and is the same whatever order the options come in', () => {
    const near: Option[] = ['Deadlifts heavy', 'Deadlift', 'Dead lift pause'].map((name) => ({
      slug: name,
      name,
      isCatalog: true,
      aliases: [],
    }));
    const first = names(search('deadlfit', near).near);
    expect(first[0]).toBe('Deadlift');
    expect(names(search('deadlfit', [...near].reverse()).near)).toEqual(first);
  });

  it('may sit beside some-words: the two are separate lists', () => {
    const found = search('dedlift hang', OPTIONS);
    expect(found.matches).toEqual([]);
    expect(found.near).toEqual([]);
    expect(names(found.someWords)).toEqual(expect.arrayContaining(['Dead hang']));
  });
});

describe('the edit count', () => {
  it.each([
    ['deadlift', 'deadlift', 0],
    ['dedlift', 'deadlift', 1],
    ['deadlifts', 'deadlift', 1],
    ['daedlift', 'deadlift', 1],
    ['deadlfit', 'deadlift', 1],
    ['xeadlift', 'deadlift', 1],
    ['ca', 'abc', 3],
    ['kitten', 'sitting', 3],
  ])('%j to %j is %i', (a, b, edits) => {
    expect(editsWithin(a, b, 5)).toBe(edits);
    expect(editsWithin(b, a, 5)).toBe(edits);
  });

  it('answers one more than the limit for anything further, however far', () => {
    expect(editsWithin('kitten', 'sitting', 2)).toBe(3);
    expect(editsWithin('a', 'a'.repeat(50), 2)).toBe(3);
    expect(editsWithin('abcdefghij', 'zyxwvutsrq', 1)).toBe(2);
    expect(editsWithin('', 'ab', 2)).toBe(2);
    expect(editsWithin('', '', 0)).toBe(0);
  });
});

describe('bounded (P6, the contract’s half)', () => {
  it('reads the first MOVEMENT_NAME_MAX characters of a query and nothing after', () => {
    const long = `${'z'.repeat(MOVEMENT_NAME_MAX)} chin up`;
    expect(search(long)).toEqual(search('z'.repeat(MOVEMENT_NAME_MAX)));
    const padded = `chin up${' '.repeat(5 * MOVEMENT_NAME_MAX)}`;
    expect(names(search(padded).matches)).toEqual(names(search('chin up').matches));
  });

  it('🔴 a query of more than SEARCH_WORDS_MAX words gets the plain match and nothing added', () => {
    const options: Option[] = ['Dumbbell bench press', 'Dumbbell row'].map((name) => ({
      slug: name,
      name,
      isCatalog: true,
      aliases: [],
    }));
    // `p` is in "press" and not in "row".
    const filler = (count: number) => Array.from({ length: count }, () => 'p').join(' ');
    // Twelve words: the short form is read, and every typed word is in the row it finds.
    const twelve = `db ${filler(SEARCH_WORDS_MAX - 1)}`;
    expect(names(search(twelve, options).matches)).toEqual(['Dumbbell bench press']);
    // Thirteen: reading only the first twelve would "match" rows that lack the last word.
    const thirteen = `db ${filler(SEARCH_WORDS_MAX - 1)} zzz`;
    expect(search(thirteen, options)).toEqual({
      ...matchMovementOptions(options, thirteen),
      near: [],
    });
    expect(search(thirteen, options).matches).toEqual([]);
    // The same for a near miss: `prss` is word thirteen and is in no name.
    const near = `bench ${filler(SEARCH_WORDS_MAX - 1)} prss`;
    expect(search(near, options).near).toEqual([]);
    expect(names(search('bench presss', options).near)).toEqual(['Dumbbell bench press']);
  });

  it('answers a pasted page of text without doing a page of work', () => {
    const pasted = Array.from({ length: 4000 }, (_, i) => `kettelbell${i}`).join(' ');
    const started = performance.now();
    expect(search(pasted, LIBRARY).matches).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('🔴 builds no RegExp from a query or a name', () => {
    const source = readFileSync(resolve(SRC, 'movement-search.ts'), 'utf8');
    expect(source).not.toMatch(/new RegExp|RegExp\(/);
    // Every regular expression in the file is a literal with no interpolation.
    expect(source.match(/\/\[\^\\p\{L\}\\p\{N\}\]\+\/gu/g)).toHaveLength(1);
    expect(source).not.toMatch(/\.match\(|\.search\(|matchAll\(/);
  });
});
