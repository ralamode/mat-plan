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
  it('the same rows in the same order, plus only rows found by part of another name', () => {
    let compared = 0;
    let added = 0;
    // Each alias's first word, so some queries find a row by part of another name.
    const aliasParts = CATALOG_FIXTURE.flatMap((entry) =>
      entry.aliases.map((alias) => foldMovementQuery(alias).split(' ')[0] ?? ''),
    ).filter((word) => word.length >= 3);
    expect(aliasParts.length).toBeGreaterThan(2);
    for (const query of [...QUERIES, ...aliasParts].filter((q) => !hasShortForm(q))) {
      const typed = matchMovementOptions(LIBRARY, query);
      const found = search(query, LIBRARY);
      const extra = found.matches.filter((option) => !typed.matches.includes(option));
      // Every typed row is there, in the plain match's own order relative to the others.
      expect(
        found.matches.filter((option) => typed.matches.includes(option)),
        query,
      ).toEqual(typed.matches);
      // Anything else was found through an alias, and says which.
      for (const option of extra) expect(found.foundByAlias.has(option), query).toBe(true);
      // The some-words rows are the plain match's, less any row offered as a close spelling (P5).
      if (extra.length === 0) {
        expect(found.someWords, query).toEqual(
          typed.someWords.filter((option) => !found.near.includes(option)),
        );
      }
      added += extra.length;
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
    // Some of those queries did find a row through its alias and nowhere else.
    expect(added).toBeGreaterThan(0);
  });
});

describe('best match first (P2)', () => {
  const only = (...list: (string | Option)[]): Option[] =>
    list.map((item) =>
      typeof item === 'string' ? { slug: item, name: item, isCatalog: true, aliases: [] } : item,
    );

  it('🔴 exact, then starts with it, then a word starts with it, then mid-word', () => {
    const options = only(
      'Machine-assisted pull-up',
      'Weighted chin-up',
      'Chin tuck',
      'Chin-up',
      'Chin',
    );
    const wanted = ['Chin', 'Chin-up', 'Chin tuck', 'Weighted chin-up', 'Machine-assisted pull-up'];
    expect(names(matchMovementOptions(options, 'chin').matches)).toEqual(wanted);
    expect(names(search('chin', options).matches)).toEqual(wanted);
    expect(names(search('chin', [...options].reverse()).matches)).toEqual(wanted);
  });

  it('a compact query that starts at a word is a word-start match, not a mid-word one', () => {
    const options = only('Heavy trap bar carry', 'Strapbar hold');
    expect(names(matchMovementOptions(options, 'trapbar').matches)).toEqual([
      'Heavy trap bar carry',
      'Strapbar hold',
    ]);
  });

  it('🔴 two spellings of one name tie on length: the library’s is first whichever was typed', () => {
    for (const [library, household] of [
      ['Push-ups', 'Pushups'],
      ['Pushups', 'Push-ups'],
      ['Push ups', 'Push-Ups'],
    ] as const) {
      const lib: Option = { slug: 'lib', name: library, isCatalog: true, aliases: [] };
      const own: Option = { slug: 'own', name: household, isCatalog: false, aliases: [] };
      for (const typed of [library, household, 'pushups', 'push up']) {
        for (const list of [
          [lib, own],
          [own, lib],
        ]) {
          expect(search(typed, list).matches, `${library} / ${household} / ${typed}`).toEqual([
            lib,
            own,
          ]);
          expect(matchMovementOptions(list, typed).matches[0]).toBe(lib);
        }
      }
    }
    // The same for an alias written two ways.
    const a: Option = { slug: 'a', name: 'Alpha', isCatalog: false, aliases: ['Pressup'] };
    const b: Option = { slug: 'b', name: 'Beta', isCatalog: true, aliases: ['Press-up'] };
    expect(search('press up', [a, b]).matches).toEqual([b, a]);
  });

  it('two names that fold alike are ordered by the name as written, and one option is one row', () => {
    const one: Option = { slug: 'one', name: 'Twin move', isCatalog: true, aliases: [] };
    const two: Option = { slug: 'two', name: 'Twin-moves', isCatalog: true, aliases: [] };
    expect(search('twin', [two, one]).matches).toEqual(search('twin', [one, two]).matches);
    expect(search('twin', [one, one, two]).matches).toHaveLength(2);
    expect(search('twni', [one, one, two]).near).toHaveLength(2);
    expect(search('twin zzzz', [one, one, two]).someWords).toHaveLength(2);
  });

  it('within one quality: the shorter name, then the library’s before a household’s, then by name', () => {
    const own: Option = { slug: 'own', name: 'Ring row', isCatalog: false, aliases: [] };
    const options = [own, ...only('Seal row', 'Ring row', 'Band row', 'Bent-over row')];
    // Four names of one length: the library's three by name, then the household's; the longer last.
    expect(search('row', options).matches.map((o) => o.slug)).toEqual([
      'Band row',
      'Ring row',
      'Seal row',
      'own',
      'Bent-over row',
    ]);
  });

  it('a movement’s own name before another movement’s other name, at the top too', () => {
    const household: Option = { slug: 'stray', name: 'RDL', isCatalog: false, aliases: [] };
    const library: Option = {
      slug: 'lib',
      name: 'Romanian deadlift',
      isCatalog: true,
      aliases: ['RDL'],
    };
    const found = search('rdl', [library, household]);
    expect(found.matches.map((o) => o.slug)).toEqual(['stray', 'lib']);
    expect([found.exact, found.aliasHit]).toEqual([true, 'RDL']);
    expect(found.foundByAlias.get(library)).toBe('RDL');
    expect(found.foundByAlias.has(household)).toBe(false);
  });
});

describe('part of another name finds the movement (P17)', () => {
  const press: Option = {
    slug: 'ohp',
    name: 'Overhead press',
    isCatalog: true,
    aliases: ['OHP', 'Military press'],
  };
  const pushUp: Option = { slug: 'pu', name: 'Push-up', isCatalog: true, aliases: ['Press-up'] };
  const others: Option[] = ['Z press', 'Bench press', 'Pallof press', 'Military drill'].map(
    (name) => ({
      slug: name,
      name,
      isCatalog: true,
      aliases: [],
    }),
  );
  const options = [press, pushUp, ...others];

  it('from three letters, and the row says which name', () => {
    const found = search('milit', [press, pushUp]);
    expect(names(found.matches)).toEqual(['Overhead press']);
    expect(found.foundByAlias.get(press)).toBe('Military press');
    expect(names(search('mi', [press, pushUp]).matches)).toEqual([]);
    expect(names(search('mil', [press, pushUp]).matches)).toEqual(['Overhead press']);
  });

  it('🔴 never makes the name "already in the list"', () => {
    for (const query of ['military', 'milit', 'press-u', 'oh']) {
      const found = search(query, options);
      expect([found.exact, found.aliasHit, found.shortFormHit], query).toEqual([false, null, null]);
    }
    // The whole other name still does, as before.
    expect(search('military press', options).aliasHit).toBe('Military press');
  });

  it('🔴 another name never outranks a movement’s own name of the same quality', () => {
    // "Press-up" STARTS with the query; the presses only have a word that starts with it.
    expect(names(search('press', options).matches)).toEqual([
      'Z press',
      'Bench press',
      'Pallof press',
      'Overhead press',
      'Push-up',
    ]);
    // A name that starts with the query still comes before any of them.
    expect(names(search('military', options).matches)).toEqual([
      'Military drill',
      'Overhead press',
    ]);
  });

  it('counts as a match: nothing is offered as a near miss or as some of your words', () => {
    const found = search('military', [press, pushUp]);
    expect(found.someWords).toEqual([]);
    expect(found.near).toEqual([]);
  });

  it('lists a movement once, by its best way of being found', () => {
    // "press" is in Overhead press's own name and in its alias.
    const found = search('press', [press]);
    expect(names(found.matches)).toEqual(['Overhead press']);
    expect(found.foundByAlias.has(press)).toBe(false);
  });

  it('past the word cap, an exact alias still says which row it belongs to', () => {
    const long = Array.from({ length: SEARCH_WORDS_MAX + 1 }, () => 'ab').join(' ');
    const item: Option = { slug: 'x', name: 'Other', isCatalog: true, aliases: [long] };
    const own: Option = { slug: 'y', name: long, isCatalog: false, aliases: [] };
    const found = search(long, [item, own]);
    expect(found.matches.map((o) => o.slug)).toEqual(['y', 'x']);
    expect([...found.foundByAlias]).toEqual([[item, long]]);
  });

  it('is not read past the word cap', () => {
    // Short words, so the length cut does not get there first.
    const repeated = (count: number) => Array.from({ length: count }, () => 'mil').join(' ');
    expect(names(search(repeated(SEARCH_WORDS_MAX), [press]).matches)).toEqual(['Overhead press']);
    expect(search(repeated(SEARCH_WORDS_MAX + 1), [press]).matches).toEqual([]);
  });
});

describe('an abbreviation that spells a movement is that movement (P1)', () => {
  const row: Option = { slug: 'row', name: 'Dumbbell row', isCatalog: true, aliases: [] };
  const bench: Option = {
    slug: 'bench',
    name: 'Bench press',
    isCatalog: true,
    aliases: ['Barbell bench'],
  };
  const options = [row, bench, ...OPTIONS.filter((o) => o.name !== 'Dumbbell row')];

  it('🔴 shortFormHit is the movement the expanded words spell, by name or by alias', () => {
    expect(search('db row', options).shortFormHit).toBe(row);
    expect(search('DB rows', options).shortFormHit).toBe(row);
    expect(search('bb bench', options).shortFormHit).toBe(bench);
    expect(search('bb bench', options).foundByAlias.get(bench)).toBe('Barbell bench');
  });

  it('is null for a part of a name, for no short form, and for a name as typed', () => {
    for (const query of ['db', 'db ro', 'db row pause', 'dumbbell row', 'row', 'kb row', '']) {
      expect(search(query, options).shortFormHit, query).toBeNull();
    }
    // The name as typed is `exact`, which is the plain match's signal.
    expect(search('dumbbell row', options).exact).toBe(true);
  });

  it('lists that movement first', () => {
    expect(search('db row', options).matches[0]).toBe(row);
  });

  it('🔴 an abbreviation and the words it stands for mean the same movement', () => {
    // A movement's own name before another movement's other name, through a short form too.
    const bent: Option = {
      slug: 'bent',
      name: 'Bent row',
      isCatalog: true,
      aliases: ['Dumbbell row'],
    };
    const household: Option = {
      slug: 'mine',
      name: 'Barbell bench',
      isCatalog: false,
      aliases: [],
    };
    for (const list of [
      [bent, row, bench, household],
      [household, bench, row, bent],
    ]) {
      expect(search('db row', list).shortFormHit, 'db row').toBe(row);
      expect(search('dumbbell row', list).matches[0], 'dumbbell row').toBe(row);
      expect(search('db row', list).matches.slice(0, 2)).toEqual([row, bent]);
      expect(search('bb bench', list).shortFormHit, 'bb bench').toBe(household);
      expect(search('barbell bench', list).matches[0], 'barbell bench').toBe(household);
    }
  });

  it('🔴 a short-form row of a better quality comes before a typed row of a worse one (P3)', () => {
    // "db" is only in the middle of "Bedbug"; the dumbbell movements start with the word it means.
    const bug: Option = { slug: 'bug', name: 'Bedbug hold', isCatalog: true, aliases: [] };
    const curl: Option = { slug: 'curl', name: 'Dumbbell curl', isCatalog: true, aliases: [] };
    const incline: Option = {
      slug: 'inc',
      name: 'Incline dumbbell press',
      isCatalog: true,
      aliases: [],
    };
    const own: Option = { slug: 'own', name: 'DB special', isCatalog: false, aliases: [] };
    expect(names(matchMovementOptions([bug, curl, incline, own], 'db').matches)).toEqual([
      'DB special',
      'Bedbug hold',
    ]);
    for (const list of [
      [bug, curl, incline, own, row],
      [row, own, incline, curl, bug],
    ]) {
      expect(names(search('db', list).matches)).toEqual([
        'DB special', // starts with what was typed
        'Dumbbell row', // starts with what it stands for; the shorter of the two
        'Dumbbell curl',
        'Incline dumbbell press', // a word starts with it
        'Bedbug hold', // only holds the letters
      ]);
    }
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

  it('🔴 within one quality, a row found through a short form comes after a typed one', () => {
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
    ['hng', 'three letters: never a near miss'],
    ['rusg', 'four letters, and the first letter differs'],
    ['pisg', 'four letters, and the second letter differs'],
    ['sprat', 'two edits in five letters, so not a squat'],
    ['siutcsae', 'two edits in an eight-letter word'],
    ['zzzzzz', 'nothing like it'],
    ['kb swnig', 'a short word that is in no name'],
  ])('%j finds nothing (%s)', (query) => {
    expect(search(query).matches).toEqual([]);
    expect(search(query).near).toEqual([]);
  });

  it('🔴 a four-letter word may be one edit off, when its first two letters agree', () => {
    // The maintainer's rule (2026-11-17). It overturns "a four-letter word is never a near miss".
    expect(names(search('hanf').near).sort()).toEqual(['Dead hang', 'Hang power clean']);
    expect(names(search('pusg').near)).toEqual(expect.arrayContaining(['Incline push-up']));
    expect(names(search('hand').near).sort()).toEqual(['Dead hang', 'Hang power clean']);
    expect(names(search('chim').near)).toEqual(expect.arrayContaining(['Chin-up']));
    // The second letter must agree for four letters; from five, only the first.
    expect(search('hing').near).toEqual([]);
    expect(names(search('plnak').near)).toEqual(['Side plank']);
    expect(names(search('alnk side').near)).toEqual([]);
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

  it('says which alias a near miss was found through, and nothing for one found by its name', () => {
    const viaAlias = search('strcit press', LIBRARY);
    const [overhead] = viaAlias.near;
    expect(overhead?.name).toBe('Overhead press');
    expect(overhead && viaAlias.foundByAlias.get(overhead)).toBe('Strict press');
    const viaName = search('dedlift', LIBRARY);
    expect(viaName.near.length).toBeGreaterThan(0);
    expect(viaName.foundByAlias.size).toBe(0);
  });

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

  it('🔴 a word of three letters must be part of the NAME; a longer one may be near an alias', () => {
    const item: Option = {
      slug: 'x',
      name: 'Lying extension',
      isCatalog: true,
      aliases: ['Skull crusher'],
    };
    // `sku` is three letters: never a near miss, and it is in no name.
    expect(search('sku extension', [item]).near).toEqual([]);
    // Four letters or more may be a near miss of an alias's word, and the result says which alias.
    for (const typo of ['skul extension', 'skulll extension']) {
      const found = search(typo, [item]);
      expect(names(found.near), typo).toEqual(['Lying extension']);
      expect(found.foundByAlias.get(item), typo).toBe('Skull crusher');
    }
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

  it('🔴 agrees with a plain, unbounded count on thousands of pairs, at every limit', () => {
    // The banded count fills only the cells near the diagonal; this is the whole table.
    const plain = (a: string, b: string): number => {
      const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
      );
      for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
          let v = Math.min(
            d[i - 1]![j]! + 1,
            d[i]![j - 1]! + 1,
            d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
          );
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
            v = Math.min(v, d[i - 2]![j - 2]! + 1);
          d[i]![j] = v;
        }
      }
      return d[a.length]![b.length]!;
    };
    let seed = 20261117;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const word = () => Array.from({ length: next(9) }, () => 'abc'[next(3)]).join('');
    let checked = 0;
    for (let i = 0; i < 6000; i += 1) {
      const a = word();
      const b = word();
      for (const max of [0, 1, 2, 3]) {
        expect(editsWithin(a, b, max), `${a} ${b} ${max}`).toBe(Math.min(plain(a, b), max + 1));
        checked += 1;
      }
    }
    expect(checked).toBe(24000);
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
      shortFormHit: null,
      foundByAlias: new Map(),
      hits: [],
      hitsOutsideFilters: [],
      custom: [],
      outsideFilters: 0,
      outsideWithoutData: 0,
      enterTarget: null,
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
