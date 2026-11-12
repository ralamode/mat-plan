import { foldName } from './text';

/**
 * Movement-name folding and search — PURE, and the one "same movement" rule in the app (PICK-1
 * Decision 4).
 *
 * 🔴 **It builds on `foldName` and adds only what is MOVEMENT-specific.** `foldName` (PROF-1, in
 * `text.ts`) already settles accents, the three apostrophes, zero-width characters, whitespace and
 * case; re-implementing any of that here would give the picker and the duplicate warning two
 * different ideas of "the same", which is the failure `foldName`'s own docblock exists to prevent.
 * What is movement-specific is **plurals and punctuation**: `Pull-Ups`, `pull ups` and `pullups` are
 * one movement to a person, and `press` must not become `pres`.
 *
 * ⚠️ **None of this runs on the server before a write.** `findOrCreateMovement` still keys on
 * `movementSlug`, and auto-correcting a typed name server-side is a thing `PICK-2`'s backlog row
 * forbids (`docs/plan.md` → PICK-1/PICK-2) and would change that function's pinned contract. These
 * helpers decide what the PICKER offers; the server decides what a name resolves to.
 */

/** A word is only de-pluralised when at least this many letters precede the trailing `s`. */
const MIN_STEM_BEFORE_PLURAL_S = 2;

/**
 * A movement name or query, folded for COMPARISON: `foldName`, then punctuation to spaces, then the
 * plural and possessive rules, then collapsed.
 *
 * The two movement-specific steps, each with the case that motivates it:
 *
 * - **A lone `s` word is dropped** — `Farmer's carry` folds to `farmer's carry`, punctuation makes it
 *   `farmer s carry`, and the orphan `s` would otherwise never match `Farmer Carry`.
 * - **One trailing `s` comes off a word with ≥2 letters before it, unless the word ends in `ss`** —
 *   `ups` → `up`, `squats` → `squat`, `raises` → `raise`; but `press` keeps its `ss` (so
 *   `Pallof Press` is reachable by typing `press`) and a 2-letter word like `as` is left alone,
 *   because stripping it would leave a single letter that matches almost everything.
 *
 * ⚠️ **Not a stemmer, and deliberately not.** It handles the plural people actually type on a gym
 * floor. `-es`, `-ies` and irregulars are out of scope; a query they would break still reaches the
 * movement through `someWords` or the browse list, and `PICK-2` owns near-miss matching.
 */
export function foldMovementQuery(value: string): string {
  return foldName(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((word) => word !== '' && word !== 's')
    .map((word) =>
      word.endsWith('s') && !word.endsWith('ss') && word.length > MIN_STEM_BEFORE_PLURAL_S
        ? word.slice(0, -1)
        : word,
    )
    .join(' ')
    .trim();
}

/**
 * 🔴 **THE "same movement" key.** {@link foldMovementQuery} with the spaces removed, so `pull ups`,
 * `pullups` and `Pull-Ups` all key to `pullup`.
 *
 * One definition, several consumers, which is the whole point (AGENTS.md → constants): the picker's
 * `exact` test and its alias hit, and `MOV-1`'s rename-collision check. Two surfaces disagreeing
 * about what a duplicate is would let a rename refuse a name the picker had just offered.
 *
 * ⚠️ **It can return `''`** — a name of only punctuation or combining marks folds to nothing.
 * Callers must not read `''` as "matches everything": `movementNameSchema` refuses such a name at the
 * boundary, so it never reaches a comparison from a submit, and the picker withholds "use as typed"
 * for it on its own rule.
 */
export function movementNameKey(value: string): string {
  return foldMovementQuery(value).replaceAll(' ', '');
}

/** What {@link matchMovementOptions} needs off an option: its name, and the aliases that reach it. */
export type MatchableMovement = {
  readonly name: string;
  /** Catalog rows sort before household rows on a tie. */
  readonly isCatalog?: boolean;
  readonly aliases?: readonly string[];
};

export type MovementMatchResult<T> = {
  /** Options the query matches, in display order. */
  readonly matches: readonly T[];
  /** Only populated when `matches` is empty: options matching ANY query word of 3+ letters. */
  readonly someWords: readonly T[];
  /**
   * The alias the query hit, **as authored** (`'RDL'`), or `null`. Exact only, so `rd` does not hit
   * `RDL`.
   *
   * 🔴 **The TEXT, not a boolean, so no consumer re-derives the rule.** The picker tags an aliased
   * row *also called RDL*, and with a boolean here it had to find the alias itself — a second copy of
   * "fold both sides, compare keys" in a component, which would drift from this file the first time
   * the fold changes. Truthiness still reads the same at every guard that only asks whether there
   * was a hit.
   */
  readonly aliasHit: string | null;
  /** The query's key equals some option's key — the movement is already in the list. */
  readonly exact: boolean;
};

/** A query word must be at least this long to pull in `someWords` candidates. */
const MIN_SOME_WORDS_LENGTH = 3;

/**
 * Match `options` against a typed `query` — pure, deterministic, and the input to everything the
 * picker shows.
 *
 * **An option matches when either test passes** _(UX3 B1, UX1 4, correctness S2)_:
 *
 * 1. every query word is a substring of the option's folded name (`bench press` → Dumbbell Bench
 *    Press), or
 * 2. the query's **compact** form is a substring of the name's compact form.
 *
 * ⚠️ **Test 2 is not redundant.** Someone typing `trapbar` or `medball` — no space, which is how
 * these get typed on a phone — fails test 1, because `trapbar` is not a substring of
 * `trap bar deadlift`. Dropping it makes two seeded movements unreachable by their obvious query.
 *
 * **`someWords` only when `matches` is empty** _(UX3 6)_: `farmers walk` finds no movement, and
 * offering Farmer Carry under "matches some of your words" is better than an empty sheet over a
 * movement that exists. The 3-letter floor keeps `a` and `db` from pulling in the whole catalog.
 *
 * **Order:** alias hit, then exact, then prefix, then the rest by name; catalog before household on a
 * tie. Deterministic because the picker's option list is read from the database and a stable order is
 * what makes the first row safe to pick with Enter.
 *
 * **`exact` and `aliasHit` are what WITHHOLD "use as typed"** _(UX3 B2, UX1 3)_ — typing `rdl` must
 * offer Romanian Deadlift, never mint a household movement called "rdl" that nothing can delete.
 */
export function matchMovementOptions<T extends MatchableMovement>(
  options: readonly T[],
  query: string,
): MovementMatchResult<T> {
  const folded = foldMovementQuery(query);
  const key = movementNameKey(query);
  if (folded === '') return { matches: [], someWords: [], aliasHit: null, exact: false };

  const words = folded.split(' ');
  const prepared = options.map((option) => {
    const optionFolded = foldMovementQuery(option.name);
    return {
      option,
      folded: optionFolded,
      compact: optionFolded.replaceAll(' ', ''),
      key: movementNameKey(option.name),
      // The alias that hit, found ONCE, here — `aliasHit`, the match test and the rank all read it,
      // and so does the picker's tag, via the result. One expression of the rule.
      matchedAlias: (option.aliases ?? []).find((a) => movementNameKey(a) === key),
    };
  });

  const exact = prepared.some((p) => p.key === key);
  const aliasHit = prepared.find((p) => p.matchedAlias !== undefined)?.matchedAlias ?? null;

  const matched = prepared.filter(
    (p) =>
      words.every((word) => p.folded.includes(word)) ||
      p.compact.includes(key) ||
      p.matchedAlias !== undefined,
  );

  // Rank: an alias hit or an exact key first, then a name that STARTS with the query, then the rest.
  // Within a rank, by name, catalog before household — so the order never depends on query order or
  // on how the database happened to return the rows.
  const rank = (p: (typeof prepared)[number]): number => {
    if (p.matchedAlias !== undefined || p.key === key) return 0;
    if (p.folded.startsWith(folded) || p.compact.startsWith(key)) return 1;
    return 2;
  };
  // ⚠️ **The last term compares the FOLDED strings, not `name.localeCompare(name)`.** A bare
  // `localeCompare` reads the HOST's locale, so the same catalog sorted on a phone and in a Vitest
  // run can disagree — under a comment two lines up promising the order never depends on anything
  // but the data. Folded keys are lowercase and diacritic-free, so `<`/`>` is both deterministic and
  // the comparison a reader expects. A second locale makes this an `Intl.Collator` built from the
  // REQUEST locale and threaded in (`I18N-1`), never read from the host again.
  const byRankThenName = (a: (typeof prepared)[number], b: (typeof prepared)[number]): number =>
    rank(a) - rank(b) ||
    Number(b.option.isCatalog ?? false) - Number(a.option.isCatalog ?? false) ||
    (a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : 0);

  const matches = [...matched].sort(byRankThenName).map((p) => p.option);

  const someWords =
    matches.length > 0
      ? []
      : [...prepared]
          .filter((p) =>
            words.some((word) => word.length >= MIN_SOME_WORDS_LENGTH && p.folded.includes(word)),
          )
          .sort(byRankThenName)
          .map((p) => p.option);

  return { matches, someWords, aliasHit, exact };
}
