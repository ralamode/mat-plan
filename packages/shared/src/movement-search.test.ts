import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MOVEMENT_SEED_ROWS } from './catalog-movements';
import { MOVEMENT_PICKER_ALIASES } from './movement-picker-catalog';
import {
  foldMovementQuery,
  matchMovementOptions,
  movementNameKey,
  type MatchableMovement,
} from './movement-search';

/** Every seeded movement as the picker would offer it, with its aliases attached. */
const SEEDED: readonly (MatchableMovement & { slug: string })[] = MOVEMENT_SEED_ROWS.map((row) => ({
  slug: row.slug,
  name: row.name,
  isCatalog: true,
  aliases: MOVEMENT_PICKER_ALIASES.filter((a) => a.slug === row.slug).map((a) => a.alias),
}));

const named = (name: string) => SEEDED.find((o) => o.name === name)!;

describe('foldMovementQuery / movementNameKey (PICK-1 Decision 4)', () => {
  it('folds punctuation, case and spacing to one key', () => {
    const key = movementNameKey('Pull-Up');
    expect([
      movementNameKey('pull ups'),
      movementNameKey('pullups'),
      movementNameKey('PULL-UPS'),
    ]).toEqual([key, key, key]);
  });

  it("drops the possessive's orphan `s` — the case that motivates the rule", () => {
    // `Farmer's carry` → foldName → punctuation to spaces → `farmer s carry`. Without the rule the
    // orphan `s` is a query word that nothing matches, and Farmer Carry is unreachable.
    expect(foldMovementQuery("Farmer's carry")).toBe('farmer carry');
    expect(movementNameKey("Farmer's Carry")).toBe(movementNameKey('Farmer Carry'));
  });

  it.each([
    ['ups', 'up'],
    ['squats', 'squat'],
    ['raises', 'raise'],
    ['dips', 'dip'],
  ])('strips one trailing s: %j → %j', (input, expected) => {
    expect(foldMovementQuery(input)).toBe(expected);
  });

  it.each([
    ['press', 'press'], // ends in `ss` — otherwise `Pallof Press` is unreachable by typing `press`
    ['as', 'as'], // only 2 letters; stripping leaves a single letter that matches almost everything
  ])('leaves %j alone', (input, expected) => {
    expect(foldMovementQuery(input)).toBe(expected);
  });

  it('returns the empty string for a name with no letters or digits', () => {
    // Documented, and callers must not read it as "matches everything" — see the docblock.
    expect(movementNameKey('—  —')).toBe('');
  });

  it('gives every seeded movement a UNIQUE key', () => {
    // Two seeded movements folding to one key would make `exact` ambiguous, so the picker could
    // withhold "use as typed" for a name that is not actually in the list.
    const keys = MOVEMENT_SEED_ROWS.map((row) => movementNameKey(row.name));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('imports foldName rather than re-implementing the fold', () => {
    // 🔴 A source scan, because the failure it guards is INVISIBLE to a behavioural test: a local
    // `.toLowerCase().trim()` passes every vector below while disagreeing with PROF-1's duplicate
    // warning and MOV-1's rename on accents, curly quotes and zero-width characters.
    const source = readFileSync(new URL('./movement-search.ts', import.meta.url), 'utf8');
    expect(source).toContain("from './text'");
    expect(source).toContain('foldName(');
    expect(source).not.toMatch(/\.toLowerCase\(\)/);
    expect(source).not.toMatch(/normalize\(/);
  });
});

describe('matchMovementOptions — the Decision 4 vector table', () => {
  // 🔴 This table IS the contract (plan → Decision 4). Each row is a query a person actually types;
  // `withheld` means "use as typed" must NOT be offered, because minting a household movement for
  // something already in the list is the hazard PICK-1 exists to close and nothing can delete it.
  const VECTORS: readonly {
    query: string;
    expect: readonly string[];
    exact: boolean;
    withheld: boolean;
    someWords?: readonly string[];
  }[] = [
    { query: 'pull ups', expect: ['Pull-Up'], exact: true, withheld: true },
    { query: 'pullups', expect: ['Pull-Up'], exact: true, withheld: true },
    { query: 'pushups', expect: ['Push-Ups'], exact: true, withheld: true },
    { query: 'push-up', expect: ['Push-Ups'], exact: true, withheld: true },
    { query: 'push up', expect: ['Push-Ups'], exact: true, withheld: true },
    { query: "Farmer's carry", expect: ['Farmer Carry'], exact: true, withheld: true },
    // ⚠️ The plan's table says `someWords: Farmer Carry` and stops there. By its OWN rule — any query
    // word of 3+ letters — `walk` is a substring of `walking lunge`, so Walking Lunge matches too.
    // The implementation is right and the table was incomplete; a dated note records it in the plan.
    // It is also the better answer: someone typing `farmers walk` may well mean either.
    {
      query: 'farmers walk',
      expect: [],
      exact: false,
      withheld: false,
      someWords: ['Farmer Carry', 'Walking Lunge'],
    },
    { query: 'trapbar', expect: ['Trap-Bar Deadlift'], exact: false, withheld: false },
    { query: 'medball', expect: ['Med-Ball Slam'], exact: false, withheld: false },
    { query: 'rdl', expect: ['Romanian Deadlift'], exact: false, withheld: true },
    {
      query: 'bulgarian split squats',
      expect: ['Bulgarian Split Squat'],
      exact: true,
      withheld: true,
    },
  ];

  it.each(VECTORS)('$query', ({ query, expect: wanted, exact, withheld, someWords }) => {
    const result = matchMovementOptions(SEEDED, query);
    expect(result.matches.map((o) => o.name)).toEqual(wanted);
    expect(result.exact).toBe(exact);
    // "Use as typed" is withheld by EITHER signal — that is the rule the picker reads.
    expect(result.exact || result.aliasHit !== null).toBe(withheld);
    if (someWords) expect(result.someWords.map((o) => o.name)).toEqual(someWords);
  });

  it('`press` matches every …Press and is still offered as typed', () => {
    const result = matchMovementOptions(SEEDED, 'press');
    expect(result.matches.map((o) => o.name)).toContain('Pallof Press');
    expect(result.matches.map((o) => o.name)).toContain('Overhead Shoulder Press');
    expect(result.exact || result.aliasHit !== null).toBe(false);
  });

  it('an alias hits EXACTLY, so a prefix of it does not, and names WHICH alias hit', () => {
    // The authored casing, because that is what the picker's "also called RDL" tag renders — a
    // boolean here would have left the component re-deriving which alias it was.
    expect(matchMovementOptions(SEEDED, 'rdl').aliasHit).toBe('RDL');
    expect(matchMovementOptions(SEEDED, 'R.D.L.').aliasHit).toBe('RDL');
    expect(matchMovementOptions(SEEDED, 'rd').aliasHit).toBeNull();
  });

  it('someWords is empty whenever there are matches', () => {
    // The picker renders "matches some of your words" only as a fallback; a non-empty someWords
    // beside real matches would show one movement twice.
    for (const { query } of VECTORS) {
      const result = matchMovementOptions(SEEDED, query);
      if (result.matches.length > 0) expect(result.someWords).toEqual([]);
    }
  });

  it('ignores a query word shorter than 3 letters when falling back to someWords', () => {
    // `db` would otherwise pull in every Dumbbell row under "some of your words" for a query that
    // matched nothing — which reads as a bug, not a help.
    expect(matchMovementOptions(SEEDED, 'zz db').someWords).toEqual([]);
  });

  it('is deterministic — the input order does not change the output order', () => {
    const shuffled = [...SEEDED].reverse();
    const a = matchMovementOptions(SEEDED, 'squat').matches.map((o) => o.name);
    const b = matchMovementOptions(shuffled, 'squat').matches.map((o) => o.name);
    expect(a).toEqual(b);
  });

  it('🔴 ranks an EXACT key first, ahead of every other match', () => {
    // The case that makes this load-bearing, and the reason it needed its own test: the picker's
    // Enter and its status both read `matches[0]`. A household row named `Squat` plus the query
    // `squat` is an exact hit — and with the rank term gone the list is plain name order, so
    // `matches[0]` is **Back Squat**: Enter files a set against the wrong movement and the status
    // announces "Already in the list as Back Squat."
    //
    // ⚠️ The test this replaces queried `squat` and asserted only determinism. No seeded name has
    // the key `squat`, so it could not fail on the thing its name claimed — and over the 35 seeded
    // names rank changes the order for only `v` and `a`, neither of which any test used. Deleting
    // `rank(a) - rank(b) ||` left every suite green.
    const own = { name: 'Squat', isCatalog: false };
    const result = matchMovementOptions([...SEEDED, own], 'squat');
    expect(result.exact).toBe(true);
    expect(result.matches[0]?.name).toBe('Squat');
  });

  it('…then a PREFIX match, ahead of a mid-name one', () => {
    // The second half of the rank, pinned by the one query where it changes the seeded order.
    const names = matchMovementOptions(SEEDED, 'v').matches.map((o) => o.name);
    expect(names[0]).toBe('V-Sit Crunches');
    expect(names.slice(1)).toContain('Inverted Rows');
  });

  it('puts a catalog row before a household row of the same name', () => {
    const household = { name: 'Front Squat', isCatalog: false };
    const result = matchMovementOptions([household, named('Front Squat')], 'front squat');
    expect(result.matches.map((o) => o.isCatalog)).toEqual([true, false]);
  });

  it('an empty or punctuation-only query matches nothing and withholds nothing', () => {
    for (const query of ['', '   ', '—']) {
      const result = matchMovementOptions(SEEDED, query);
      expect(result).toEqual({ matches: [], someWords: [], aliasHit: null, exact: false });
    }
  });
});
