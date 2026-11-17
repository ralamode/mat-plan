import { QUERY_SHORT_FORMS } from './catalog/vocabulary';
import { MOVEMENT_NAME_MAX } from './movements';
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
 * ⚠️ **None of this runs on the server before a LOGGING write.** `findOrCreateMovement` still keys
 * on `movementSlug`, and auto-correcting a typed name server-side is a thing `PICK-2`'s backlog row
 * forbids (`docs/plan.md` → PICK-1/PICK-2) and would change that function's pinned contract. There
 * these helpers decide what the PICKER offers; the server decides what a name resolves to.
 * **One server reader is planned, since FAM-1 contract change C8: the program builder's `newItem`**
 * (its writer is plan step 6a; today only the preview's fake calls it). It will ask `existingItem`
 * (`program/pieces.ts`), which is `matchMovementOptions`' `exact` or `aliasHit`, whether a typed
 * name already names an item, and select that item if so. That corrects nothing a person typed: it is the same two cases in which the picker withholds "use as typed", held on the
 * server for a stale page or a call that did not come from the picker.
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
 * `exact` test and its alias hit, `MOV-1`'s rename-collision check, and the program builder's
 * `existingItem` and `newItemSchema` (`program/`). Two surfaces disagreeing about what a duplicate
 * is would let a rename refuse a name the picker had just offered.
 *
 * ⚠️ **It can return `''`** — a name of only punctuation or combining marks folds to nothing, and so
 * does a name made only of the letter `s` (`S`, `s s`: the fold drops a lone `s`).
 * Callers must not read `''` as "matches everything". `movementNameSchema` refuses the first kind at
 * the boundary (a name needs a letter) but NOT the second, which has one; `newItemSchema` refuses
 * both, and `matchMovementOptions` matches nothing for an empty key.
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

/**
 * The most words a query may have for the short-form and near-miss passes to run at all (CAT-3
 * spec P6). A name is at most `MOVEMENT_NAME_MAX` characters, and nobody types a twelve-word
 * movement: the cap bounds the near-miss work per keystroke whatever is pasted into the field.
 */
export const SEARCH_WORDS_MAX = 12;

/** A query word shorter than this is never matched by a near miss: `hand` is not `hang`. */
const NEAR_MIN_LENGTH = 5;
/** From this length a word may be two edits away, not one. */
const NEAR_TWO_EDITS_FROM = 9;

/** How many edits a query word of this length may be from the word it means (CAT-3 spec P4). */
function editsAllowed(word: string): 0 | 1 | 2 {
  if (word.length >= NEAR_TWO_EDITS_FROM) return 2;
  return word.length >= NEAR_MIN_LENGTH ? 1 : 0;
}

/**
 * The edits between two folded words: an insert, a delete, a substitute, or a swap of two
 * neighbours, each one edit (the "optimal string alignment" distance). **Bounded:** the answer is
 * exact up to `max` and `max + 1` for anything further, and it stops as soon as that is certain.
 *
 * Plain loops over arrays. Nothing here builds a `RegExp` from a query or a name (spec P6).
 */
export function editsWithin(a: string, b: string, max: number): number {
  const beyond = max + 1;
  if (Math.abs(a.length - b.length) > max) return beyond;
  let twoBack: number[] = [];
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let previousBest = 0;
  for (let i = 1; i <= a.length; i += 1) {
    const row: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const same = a[i - 1] === b[j - 1];
      let edits = Math.min(
        (previous[j] ?? beyond) + 1,
        (row[j - 1] ?? beyond) + 1,
        (previous[j - 1] ?? beyond) + (same ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        edits = Math.min(edits, (twoBack[j - 2] ?? beyond) + 1);
      }
      row.push(edits);
      if (edits < best) best = edits;
    }
    // A cell reads from this row, the last one and (for a swap) the one before: once two rows in a
    // row are past the limit, nothing below can come back under it.
    if (best > max && previousBest > max) return beyond;
    twoBack = previous;
    previous = row;
    previousBest = best;
  }
  return Math.min(previous[b.length] ?? beyond, beyond);
}

export type MovementSearchResult<T> = MovementMatchResult<T> & {
  /**
   * Near misses: options a misspelt query probably means. **Only populated when `matches` is
   * empty**, and never what Enter picks (CAT-3 spec P4, P5). Closest first.
   */
  readonly near: readonly T[];
};

/**
 * The movement library's search (CAT-3 spec, chunk C0b-1): {@link matchMovementOptions}, plus two
 * things a library of hundreds needs that a list of thirty-five did not.
 *
 * 1. **Equipment short forms** (`QUERY_SHORT_FORMS`: `db`, `kb`, `bb`, `ez`, `trx`). A query word
 *    that is one is also read as the words it stands for: `db row` finds Dumbbell row. Rows found
 *    only that way come after the others and count as matches.
 * 2. **Near misses** (`near`): when nothing matches, the options the query is a typo of.
 *
 * 🔴 **`exact` and `aliasHit` are `matchMovementOptions`' own, for the query as typed** (P1). They
 * are what withholds "Use as typed", and the server's `existingItem` reads the same two: neither a
 * short form nor a near miss may ever make a name "already in the list". `db` is not Dumbbell.
 *
 * **With no short form in the query, `matches` and `someWords` are `matchMovementOptions`' too**
 * (P2): the same rows in the same order.
 *
 * **A near miss, for one option** (P4): every query word is either part of its name, or (five
 * letters or more) within one edit of a word of its name or of an alias that starts with the same
 * letter; two edits from nine letters. Or the same test on the whole query and the whole name or
 * alias with the spaces out (`chinnup` for Chin-up). A word under five letters is never a near
 * miss, so `hand` does not find a hang; the first letter must agree, so `dress` does not find a
 * press. A query made only of short words has no near miss.
 *
 * **Bounded** (P6): the query is cut to `MOVEMENT_NAME_MAX` characters before anything reads it,
 * and a query of more than `SEARCH_WORDS_MAX` words gets the plain match only: no short form is
 * expanded and no near miss is looked for. It is pure and runs on the
 * device: the query goes nowhere.
 *
 * `search` is an object because the filters join it in the next chunk (C0b-2).
 */
export function searchMovementOptions<T extends MatchableMovement>(
  options: readonly T[],
  search: { readonly query: string },
): MovementSearchResult<T> {
  const query = search.query.trim().slice(0, MOVEMENT_NAME_MAX);
  const typed = matchMovementOptions(options, query);

  const words = foldMovementQuery(query).split(' ').filter(Boolean);
  // 🔴 A query of more words than the cap gets the plain match and nothing added. Reading only its
  // first words would let a row "match" without a word that was typed.
  if (words.length > SEARCH_WORDS_MAX) return { ...typed, near: [] };
  const expanded = words.flatMap((word) => shortFormWords(word) ?? [word]);
  const hasShortForm = expanded.length !== words.length || expanded.some((w, i) => w !== words[i]);
  const viaShortForm = hasShortForm ? matchMovementOptions(options, expanded.join(' ')) : null;

  const matches = viaShortForm ? inOrder(typed.matches, viaShortForm.matches) : typed.matches;
  if (matches.length > 0) {
    return { matches, someWords: [], near: [], aliasHit: typed.aliasHit, exact: typed.exact };
  }
  return {
    matches,
    someWords: viaShortForm ? inOrder(typed.someWords, viaShortForm.someWords) : typed.someWords,
    near: nearMisses(options, expanded),
    aliasHit: typed.aliasHit,
    exact: typed.exact,
  };
}

/** The folded words a short form stands for, or `undefined` for any other word. */
function shortFormWords(word: string): readonly string[] | undefined {
  // `Object.hasOwn`, so a query word like `constructor` is a word and not a property.
  if (!Object.hasOwn(QUERY_SHORT_FORMS, word)) return undefined;
  return foldMovementQuery(QUERY_SHORT_FORMS[word as keyof typeof QUERY_SHORT_FORMS]).split(' ');
}

/** `first`, then whatever of `then` it does not already hold. */
function inOrder<T>(first: readonly T[], then: readonly T[]): readonly T[] {
  const seen = new Set(first);
  return [...first, ...then.filter((option) => !seen.has(option))];
}

function nearMisses<T extends MatchableMovement>(
  options: readonly T[],
  words: readonly string[],
): readonly T[] {
  if (!words.some((word) => editsAllowed(word) > 0)) return [];
  const compact = words.join('');
  const found: { option: T; folded: string; edits: number }[] = [];
  for (const option of options) {
    const folded = foldMovementQuery(option.name);
    const spellings = [folded, ...(option.aliases ?? []).map(foldMovementQuery)];
    const edits = Math.min(wordEdits(words, folded, spellings), compactEdits(compact, spellings));
    if (Number.isFinite(edits)) found.push({ option, folded, edits });
  }
  return found
    .sort(
      (a, b) =>
        a.edits - b.edits ||
        Number(b.option.isCatalog ?? false) - Number(a.option.isCatalog ?? false) ||
        (a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : 0),
    )
    .map((entry) => entry.option);
}

/**
 * The edits it takes for EVERY query word to be in this option: none for a word that is part of
 * its name, else the fewest edits to a word of its name or of an alias that starts with the same
 * letter. `Infinity` when any word is neither.
 */
function wordEdits(words: readonly string[], name: string, spellings: readonly string[]): number {
  const candidates = spellings.flatMap((spelling) => spelling.split(' '));
  let total = 0;
  for (const word of words) {
    if (name.includes(word)) continue;
    const allowed = editsAllowed(word);
    if (allowed === 0) return Infinity;
    let fewest = allowed + 1;
    for (const candidate of candidates) {
      if (candidate[0] !== word[0]) continue;
      fewest = Math.min(fewest, editsWithin(word, candidate, allowed));
    }
    if (fewest > allowed) return Infinity;
    total += fewest;
  }
  return total;
}

/** The same test on the whole query and a whole name or alias, spaces out. `Infinity` for none. */
function compactEdits(compact: string, spellings: readonly string[]): number {
  const allowed = editsAllowed(compact);
  if (allowed === 0) return Infinity;
  let fewest = Infinity;
  for (const spelling of spellings) {
    const candidate = spelling.replaceAll(' ', '');
    if (candidate[0] !== compact[0]) continue;
    const edits = editsWithin(compact, candidate, allowed);
    if (edits <= allowed) fewest = Math.min(fewest, edits);
  }
  return fewest;
}
