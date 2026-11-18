import {
  EQUIPMENT,
  MUSCLES,
  QUERY_SHORT_FORMS,
  type Equipment,
  type Muscle,
} from './catalog/vocabulary';
import {
  movementFiltersOn,
  passesMovementFilters,
  type FilterableMovement,
  type MovementFilters,
} from './movement-filters';
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
 * (`program/pieces.ts`), which is `searchMovementOptions`' `exact`, `aliasHit` or `shortFormHit`,
 * whether a typed name already names an item, and select that item if so. That corrects nothing a
 * person typed: they are the cases in which the picker withholds "use as typed", held on the
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
 * How well a spelling answers a query (CAT-3 spec P2), best first:
 * 0 it IS the query (its key, or an alias's key); 1 it starts with the query; 2 every query word
 * starts one of its words, or the compact query starts at one of its words (`trapbar`); 3 it only
 * holds the query's letters in the middle of a word (`chin` in `maCHINe`).
 */
type Quality = 0 | 1 | 2 | 3;

/**
 * How a row was found. Within one quality: by its own name, then by another name, then through a
 * short form, where the same order holds again (the expanded words spell its name, then its alias):
 * `db row` and `dumbbell row` must mean the same movement.
 */
const FOUND_BY = { name: 0, alias: 1, shortForm: 2, shortFormAlias: 3 } as const;
type FoundBy = (typeof FOUND_BY)[keyof typeof FOUND_BY];

type Prepared<T> = {
  readonly option: T;
  readonly folded: string;
  readonly compact: string;
  readonly aliases: readonly {
    readonly text: string;
    readonly folded: string;
    readonly compact: string;
  }[];
};

type Row<T> = {
  readonly option: T;
  /**
   * The option's folded name: a late tie-break, with the name as authored after it, so the order
   * does not depend on the order the options arrive in. (Two options with the same name and the
   * same owner are the one case left to input order; a household's list holds no such pair.)
   */
  readonly folded: string;
  readonly quality: Quality;
  readonly by: FoundBy;
  /**
   * The length of the spelling that matched (the name, or the alias it was found through), 🔴
   * **with the spaces out**. `Push-ups` and `Pushups` are one key and must tie here, so the
   * catalog's row comes first whichever spelling was typed; counted with its space, the
   * catalog's own spelling lost to a household's copy.
   */
  readonly length: number;
  /** The alias it was found through, as authored; `null` when it was found by its own name. */
  readonly alias: string | null;
};

function prepare<T extends MatchableMovement>(options: readonly T[]): Prepared<T>[] {
  // One row a movement, even when the caller's list holds the same option twice.
  return [...new Set(options)].map((option) => {
    const folded = foldMovementQuery(option.name);
    return {
      option,
      folded,
      compact: folded.replaceAll(' ', ''),
      aliases: (option.aliases ?? []).map((text) => {
        const foldedAlias = foldMovementQuery(text);
        return { text, folded: foldedAlias, compact: foldedAlias.replaceAll(' ', '') };
      }),
    };
  });
}

/** Quality 1 to 3 of one folded spelling for a folded query, or `null` when it does not match. */
function spellingQuality(
  spelling: string,
  words: readonly string[],
  folded: string,
): 1 | 2 | 3 | null {
  const key = folded.replaceAll(' ', '');
  const compact = spelling.replaceAll(' ', '');
  if (!(words.every((word) => spelling.includes(word)) || compact.includes(key))) return null;
  if (spelling.startsWith(folded) || compact.startsWith(key)) return 1;
  const own = spelling.split(' ');
  const everyWordStartsOne = words.every((word) => own.some((w) => w.startsWith(word)));
  const compactStartsAtAWord = own.some((_, i) => own.slice(i).join('').startsWith(key));
  return everyWordStartsOne || compactStartsAtAWord ? 2 : 3;
}

/**
 * The rows a folded query finds by NAME, or by an alias that is exactly the query: the plain match.
 * `through` says whose words these are: the typed ones, or a short form's expansion. Either way a
 * row found by its own name comes before one found by an exact alias.
 */
function plainRows<T extends MatchableMovement>(
  prepared: readonly Prepared<T>[],
  folded: string,
  through: 'typed' | 'shortForm',
): Row<T>[] {
  const by = through === 'typed' ? FOUND_BY.name : FOUND_BY.shortForm;
  const byAlias = through === 'typed' ? FOUND_BY.alias : FOUND_BY.shortFormAlias;
  const key = folded.replaceAll(' ', '');
  const words = folded.split(' ');
  const rows: Row<T>[] = [];
  for (const p of prepared) {
    if (p.compact === key) {
      rows.push({
        option: p.option,
        folded: p.folded,
        quality: 0,
        by,
        length: p.compact.length,
        alias: null,
      });
      continue;
    }
    const hit = p.aliases.find((alias) => alias.compact === key);
    if (hit) {
      // An exact alias is the query itself: quality 0, and found by another name.
      rows.push({
        option: p.option,
        folded: p.folded,
        quality: 0,
        by: byAlias,
        length: hit.compact.length,
        alias: hit.text,
      });
      continue;
    }
    const quality = spellingQuality(p.folded, words, folded);
    if (quality !== null) {
      rows.push({
        option: p.option,
        folded: p.folded,
        quality,
        by,
        length: p.compact.length,
        alias: null,
      });
    }
  }
  return rows;
}

/**
 * Best match first (CAT-3 spec P2): the quality; then own name, another name, a short form; then
 * the shorter spelling that matched; then a catalog row before a household's; then by name.
 *
 * ⚠️ **The last term compares the FOLDED strings, not `name.localeCompare(name)`.** A bare
 * `localeCompare` reads the HOST's locale, so the same catalog sorted on a phone and in a Vitest
 * run can disagree. Folded keys are lowercase and diacritic-free, so `<`/`>` is deterministic. A
 * second locale makes this an `Intl.Collator` built from the REQUEST locale and threaded in
 * (`I18N-1`), never read from the host again.
 */
function bestFirst<T extends MatchableMovement>(a: Row<T>, b: Row<T>): number {
  return (
    a.quality - b.quality ||
    a.by - b.by ||
    a.length - b.length ||
    Number(b.option.isCatalog ?? false) - Number(a.option.isCatalog ?? false) ||
    byName(a, b)
  );
}

/** By folded name, then by the name as authored: `Twin move` and `Twin-moves` still have an order. */
function byName<T extends MatchableMovement>(
  a: { readonly folded: string; readonly option: T },
  b: { readonly folded: string; readonly option: T },
): number {
  if (a.folded !== b.folded) return a.folded < b.folded ? -1 : 1;
  return a.option.name < b.option.name ? -1 : a.option.name > b.option.name ? 1 : 0;
}

/** One row a movement: its best way of being found. Then best first. */
function ranked<T extends MatchableMovement>(rows: readonly Row<T>[]): Row<T>[] {
  const best = new Map<T, Row<T>>();
  for (const row of rows) {
    const held = best.get(row.option);
    if (!held || bestFirst(row, held) < 0) best.set(row.option, row);
  }
  return [...best.values()].sort(bestFirst);
}

/** Options holding ANY query word of three letters or more, by name: the fallback list. */
function someWordsOf<T extends MatchableMovement>(
  prepared: readonly Prepared<T>[],
  words: readonly string[],
): T[] {
  return prepared
    .filter((p) =>
      words.some((word) => word.length >= MIN_SOME_WORDS_LENGTH && p.folded.includes(word)),
    )
    .map((p): Row<T> => ({
      option: p.option,
      folded: p.folded,
      quality: 3,
      by: FOUND_BY.name,
      length: 0,
      alias: null,
    }))
    .sort(bestFirst)
    .map((row) => row.option);
}

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
 * `trap bar deadlift`. Dropping it makes movements unreachable by their obvious query.
 *
 * **`someWords` only when `matches` is empty** _(UX3 6)_: `farmers walk` finds no movement, and
 * offering Farmer Carry under "matches some of your words" is better than an empty sheet over a
 * movement that exists. The 3-letter floor keeps `a` and `db` from pulling in the whole catalog.
 *
 * **Order: best match first** (CAT-3 spec P2, the maintainer's decision of 2026-11-17, which
 * replaced "alias or exact, then prefix, then the rest by name"). An exact name or an exact
 * alias; then a name that starts with the query; then a name where every query word starts a
 * word; then a name that holds the letters only mid-word (`chin` in `Machine-assisted`). Within
 * one of those: own name before another name, the shorter spelling, a catalog row before a
 * household's, then by name. Deterministic, because the first row is what Enter picks.
 *
 * **`exact` and `aliasHit` are what WITHHOLD "use as typed"** _(UX3 B2, UX1 3)_ — typing `rdl` must
 * offer Romanian Deadlift, never mint a household movement called "rdl" that nothing can delete.
 */
export function matchMovementOptions<T extends MatchableMovement>(
  options: readonly T[],
  query: string,
): MovementMatchResult<T> {
  const folded = foldMovementQuery(query);
  if (folded === '') return NO_MATCH;
  return plainMatch(prepare(options), folded).result;
}

const NO_MATCH = { matches: [], someWords: [], aliasHit: null, exact: false } as const;

/** The plain match of a folded, non-empty query, with the rows it was built from. */
function plainMatch<T extends MatchableMovement>(
  prepared: readonly Prepared<T>[],
  folded: string,
): { readonly rows: readonly Row<T>[]; readonly result: MovementMatchResult<T> } {
  const rows = ranked(plainRows(prepared, folded, 'typed'));
  const matches = rows.map((row) => row.option);
  const result = {
    matches,
    someWords: matches.length > 0 ? [] : someWordsOf(prepared, folded.split(' ')),
    // The alias of the best row that was found by one: the same row the picker tags.
    aliasHit: rows.find((row) => row.quality === 0 && row.alias !== null)?.alias ?? null,
    exact: rows.some((row) => row.quality === 0 && row.alias === null),
  };
  return { rows, result };
}

/** The alias each of these rows was found through, for the rows that were found through one. */
function aliasesOf<T>(rows: readonly Row<T>[]): Map<T, string> {
  const found = new Map<T, string>();
  for (const row of rows) if (row.alias !== null) found.set(row.option, row.alias);
  return found;
}

/**
 * The most words a query may have for the short-form, other-name and near-miss passes to run at
 * all (CAT-3 spec P6). A name is at most `MOVEMENT_NAME_MAX` characters, and nobody types a
 * twelve-word movement: the cap bounds the work per keystroke whatever is pasted into the field.
 */
export const SEARCH_WORDS_MAX = 12;

/** A query must have this many letters before part of another name finds a movement (spec P17). */
const ALIAS_PART_MIN_LENGTH = 3;
/** A word shorter than this is never a near miss: three letters must be typed as they are. */
const NEAR_MIN_LENGTH = 4;
/** From this length a word may be two edits away, not one. */
const NEAR_TWO_EDITS_FROM = 9;

/** How many edits a query word of this length may be from the word it means (CAT-3 spec P4). */
function editsAllowed(word: string): 0 | 1 | 2 {
  if (word.length >= NEAR_TWO_EDITS_FROM) return 2;
  return word.length >= NEAR_MIN_LENGTH ? 1 : 0;
}

/**
 * Whether `candidate` may be what `word` was meant to be, before any edit is counted: the same
 * first letter, and for a four-letter word the same first two (the maintainer's rule of
 * 2026-11-17: `pusg` is a push-up, `pisg` is not).
 */
function startsAlike(word: string, candidate: string): boolean {
  if (candidate[0] !== word[0]) return false;
  return word.length !== NEAR_MIN_LENGTH || candidate[1] === word[1];
}

/**
 * The edits between two folded words: an insert, a delete, a substitute, or a swap of two
 * neighbours, each one edit (the "optimal string alignment" distance). **Bounded:** the answer is
 * exact up to `max` and `max + 1` for anything further.
 *
 * **Banded:** two spellings within `max` edits differ by at most `max` in every prefix's length,
 * so only the cells within `max` of the diagonal are computed: about `(2·max + 1)` a row. (Each
 * row is still cleared at its full width, which the name cap bounds at a hundred cells.) Plain
 * loops over arrays. Nothing here builds a `RegExp` from a query or a name
 * (spec P6).
 */
export function editsWithin(a: string, b: string, max: number): number {
  const beyond = max + 1;
  if (Math.abs(a.length - b.length) > max) return beyond;
  let twoBack: number[] = [];
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, j) => (j <= max ? j : beyond));
  for (let i = 1; i <= a.length; i += 1) {
    const row: number[] = new Array<number>(b.length + 1).fill(beyond);
    if (i <= max) row[0] = i;
    let best = row[0] ?? beyond;
    const from = Math.max(1, i - max);
    const to = Math.min(b.length, i + max);
    for (let j = from; j <= to; j += 1) {
      const same = a[i - 1] === b[j - 1];
      let edits = Math.min(
        (previous[j] ?? beyond) + 1,
        (row[j - 1] ?? beyond) + 1,
        (previous[j - 1] ?? beyond) + (same ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        edits = Math.min(edits, (twoBack[j - 2] ?? beyond) + 1);
      }
      row[j] = Math.min(edits, beyond);
      if (edits < best) best = edits;
    }
    // Every cell reads from this row or the two before it; a swap costs at least what the cell
    // diagonally above it does. So a row with nothing within the limit ends the search.
    if (best > max) return beyond;
    twoBack = previous;
    previous = row;
  }
  return Math.min(previous[b.length] ?? beyond, beyond);
}

export type MovementSearchResult<T> = MovementMatchResult<T> & {
  /**
   * Near misses: options a misspelt query probably means. **Only populated when `matches` is
   * empty**, and never what Enter picks (CAT-3 spec P4, P5). Closest first.
   */
  readonly near: readonly T[];
  /**
   * The option the query spells once its short forms are expanded (`db row` for Dumbbell row), or
   * `null` (spec P1). 🔴 **It withholds "Use as typed" exactly as `exact` and `aliasHit` do**: an
   * abbreviation that spells a movement is that movement (the maintainer, 2026-11-17).
   */
  readonly shortFormHit: T | null;
  /**
   * For a row found through another name, that alias as authored: an exact alias, part of one
   * (spec P17), or an alias's word a near miss needed (P4). The row says "also called …". A row
   * found by its own name is not in the map.
   */
  readonly foundByAlias: ReadonlyMap<T, string>;
  /**
   * The rows the typed name already names: an exact name, an exact alias, or the movement a short
   * form spells (P1). 🔴 **They are the first rows of `matches` whatever the filters say** (P8):
   * the picker refuses to make an item of that name, so it must show the item it means.
   */
  readonly hits: readonly T[];
  /** The `hits` that are library movements outside the filters: marked "not in your filters". */
  readonly hitsOutsideFilters: readonly T[];
  /**
   * With a filter on, the household's own items the query found (as matches, near misses or
   * some-words rows, in that order), which a filter cannot judge: one section, "Your custom items
   * (not filtered)", after the filtered matches (P9). They are then in none of the other three
   * lists. A custom item that is a hit is not here: it stays first in `matches`. Empty with no
   * filter on, when a custom item sits among `matches` like any row.
   */
  readonly custom: readonly T[];
  /**
   * How many library movements the query found that the filters removed (P10): "3 more are not in
   * your filters". `hits` are not counted; they are shown.
   */
  readonly outsideFilters: number;
  /**
   * ⏳ How many of `outsideFilters` are library rows whose taxonomy was not read (no `equipment`
   * field): they pass no filter because nothing is known about them, not because they need
   * something else, so the screen can say so. Until the catalog's fresh start these are the old
   * built-ins with no library entry (spec K22). Always at most `outsideFilters`.
   *
   * TODO(CAT-3 chunk R, the fresh start): every library row has taxonomy then, this is always 0,
   * and the field goes.
   */
  readonly outsideWithoutData: number;
  /**
   * The row Enter picks, or `null` (P5): a hit; or the only match there is to pick, when it was
   * found by its own name or through a short form. Under a filter "the only match" counts the
   * filtered matches and the custom items that MATCHED (they are on the screen, set apart), so
   * one filtered match beside one custom match is two to choose from.
   *
   * 🔴 **Never a row found by another name, a near miss or a some-words row**, and that holds for
   * a custom item set apart under a filter as for any row: those are offers, and Enter on an
   * offer would add a movement nobody chose. (The accepted prototype let Enter take a lone custom
   * near miss under a filter; its own comment and P5 say otherwise, and P5 is the rule.)
   */
  readonly enterTarget: T | null;
};

/** The search before the filters: every field that does not depend on them. */
type Found<T> = Omit<
  MovementSearchResult<T>,
  'hitsOutsideFilters' | 'custom' | 'outsideFilters' | 'outsideWithoutData' | 'enterTarget'
>;

/**
 * The movement library's search (CAT-3 spec, chunks C0b-1 and C30): {@link matchMovementOptions},
 * plus what a library of hundreds needs that a list of thirty-five did not.
 *
 * 1. **Equipment short forms** (`QUERY_SHORT_FORMS`: `db`, `kb`, `bb`, `ez`, `trx`). A query word
 *    that is one is also read as the words it stands for: `db row` finds Dumbbell row. Such a row
 *    has the quality its expanded words would have had, and within that quality comes after rows
 *    found by name or by another name (P3).
 * 2. **Part of another name** (P17). From three letters, a query whose every word is in one of an
 *    option's aliases finds it: `military` finds Overhead press, also called Military press. 🔴 An
 *    alias matched this way is never better than "a word starts with it": another name does not
 *    outrank a movement's own name of the same quality.
 * 3. **Near misses** (`near`): when nothing matches, the options the query is a typo of.
 *
 * 🔴 **`exact` and `aliasHit` are `matchMovementOptions`' own, for the query as typed** (P1), and
 * `shortFormHit` is the third signal beside them. Any of the three means the movement is already
 * in the list; the server's `existingItem` answers the same three. A near miss or part of an alias
 * never does: `skull` finds a movement and still lets a household make an item called "skull".
 *
 * **With no short form in the query and no alias matched as typed, `matches` and `someWords` are
 * `matchMovementOptions`' too** (P2): the same rows in the same order.
 *
 * **A near miss, for one option** (P4): every query word is either part of its name, or within its
 * edits of a word of its name or of an alias that starts alike: one edit from four letters (with
 * the first two letters agreeing for a four-letter word), two from nine. Or the same test on the
 * whole query and the whole name or alias with the spaces out (`chinnup` for Chin-up). A word of
 * three letters or fewer is never a near miss, and a query made only of such words has none
 * (`chn up` finds nothing; `chnup` finds Chin-up).
 *
 * **Bounded** (P6): the query is cut to `MOVEMENT_NAME_MAX` characters before anything reads it,
 * and a query of more than `SEARCH_WORDS_MAX` words gets the plain match only. (So for a query
 * longer than a name may be, the three signals are those of its first `MOVEMENT_NAME_MAX`
 * characters; the field's own limit and the name schema keep such a query from being typed or
 * saved.) It is pure and runs on the device: the query goes nowhere.
 *
 * **Filters** (P7 to P10; `movement-filters.ts`). The query is always read over every option
 * first: `exact`, `aliasHit`, `shortFormHit`, `foundByAlias` and `hits` do not depend on the
 * filters, and `near` is computed only when nothing matched before filtering. Then, with a filter
 * on: a library row that does not pass leaves `matches`, `near` and `someWords` and is counted in
 * `outsideFilters`; a household's own row moves to `custom`; `hits` stay first in `matches`; and
 * nothing is reordered. With no filter on the result is the unfiltered one.
 *
 * `someWords` never repeats a row of `near` (P5).
 */
export function searchMovementOptions<T extends MatchableMovement & FilterableMovement>(
  options: readonly T[],
  search: { readonly query: string; readonly filters?: MovementFilters },
): MovementSearchResult<T> {
  const found = findMovementOptions(options, search.query);
  const filters = search.filters;
  const isHit = new Set<T>(found.hits);
  const beyondHits = found.matches.filter((option) => !isHit.has(option));
  if (filters === undefined || movementFiltersOn(filters) === 0) {
    return {
      ...found,
      hitsOutsideFilters: [],
      custom: [],
      outsideFilters: 0,
      outsideWithoutData: 0,
      enterTarget: enterTargetOf(found, beyondHits),
    };
  }
  const fits = (option: T) => passesMovementFilters(option, filters);
  const kept = (rows: readonly T[]) => rows.filter((option) => option.isCatalog && fits(option));
  const everyRow = [...new Set([...beyondHits, ...found.near, ...found.someWords])];
  const keptMatches = kept(beyondHits);
  const outside = everyRow.filter((option) => option.isCatalog && !fits(option));
  return {
    ...found,
    matches: [...found.hits, ...keptMatches],
    near: kept(found.near),
    someWords: kept(found.someWords),
    hitsOutsideFilters: found.hits.filter((option) => option.isCatalog && !fits(option)),
    custom: everyRow.filter((option) => !option.isCatalog),
    outsideFilters: outside.length,
    outsideWithoutData: outside.filter((option) => option.equipment === undefined).length,
    // Only a custom item that MATCHED stands beside the filtered matches as something to pick.
    enterTarget: enterTargetOf(found, [
      ...keptMatches,
      ...beyondHits.filter((option) => !option.isCatalog),
    ]),
  };
}

/** A hit; or the one pickable match, when it was not found through another name (P5, P17). */
function enterTargetOf<T>(found: Found<T>, pickable: readonly T[]): T | null {
  const hit = found.hits[0];
  if (hit !== undefined) return hit;
  const [only, ...others] = pickable;
  if (only === undefined || others.length > 0) return null;
  return found.foundByAlias.has(only) ? null : only;
}

function findMovementOptions<T extends MatchableMovement>(
  options: readonly T[],
  typedQuery: string,
): Found<T> {
  const folded = foldMovementQuery(typedQuery.trim().slice(0, MOVEMENT_NAME_MAX));
  if (folded === '') {
    return { ...NO_MATCH, near: [], shortFormHit: null, foundByAlias: new Map(), hits: [] };
  }
  const prepared = prepare(options);
  const { rows: typedRows, result: typed } = plainMatch(prepared, folded);
  const words = folded.split(' ');
  // 🔴 A query of more words than the cap gets the plain match and nothing added. Reading only its
  // first words would let a row "match" without a word that was typed.
  if (words.length > SEARCH_WORDS_MAX) {
    return {
      ...typed,
      near: [],
      shortFormHit: null,
      foundByAlias: aliasesOf(typedRows),
      hits: hitsOf(typedRows, null),
    };
  }

  const expanded = words.flatMap((word) => shortFormWords(word) ?? [word]);
  const expandedFolded = expanded.join(' ');
  const hasShortForm = expandedFolded !== folded;

  const rows: Row<T>[] = [...typedRows];
  const viaShortForm = hasShortForm ? plainRows(prepared, expandedFolded, 'shortForm') : [];
  rows.push(...viaShortForm);
  if (folded.replaceAll(' ', '').length >= ALIAS_PART_MIN_LENGTH)
    rows.push(...aliasPartRows(prepared, words, folded));

  const all = ranked(rows);
  const matches = all.map((row) => row.option);
  const shortFormHit = ranked(viaShortForm.filter((row) => row.quality === 0))[0]?.option ?? null;
  const foundByAlias = aliasesOf(all);

  if (matches.length > 0) {
    return {
      matches,
      someWords: [],
      near: [],
      aliasHit: typed.aliasHit,
      exact: typed.exact,
      shortFormHit,
      foundByAlias,
      hits: hitsOf(all, shortFormHit),
    };
  }
  const near = nearMisses(prepared, expanded);
  const isNear = new Set(near.map((miss) => miss.option));
  const someWords = hasShortForm
    ? inOrder(typed.someWords, someWordsOf(prepared, expanded))
    : typed.someWords;
  for (const miss of near) if (miss.alias !== null) foundByAlias.set(miss.option, miss.alias);
  return {
    matches,
    // A row offered as a close spelling is not offered again for one of its words (P5).
    someWords: someWords.filter((option) => !isNear.has(option)),
    near: near.map((miss) => miss.option),
    aliasHit: typed.aliasHit,
    exact: typed.exact,
    shortFormHit,
    foundByAlias,
    hits: [],
  };
}

/**
 * The rows that ARE the typed name: found as typed at quality 0 (by name, then by alias), then
 * the movement a short form spells. In `matches`' order, of which they are the first rows.
 */
function hitsOf<T>(ranked: readonly Row<T>[], shortFormHit: T | null): T[] {
  const typed = ranked
    .filter((row) => row.quality === 0 && (row.by === FOUND_BY.name || row.by === FOUND_BY.alias))
    .map((row) => row.option);
  return shortFormHit === null || typed.includes(shortFormHit) ? typed : [...typed, shortFormHit];
}

export type MovementFilterCounts = {
  /** Rows on the screen under the filters as they are. */
  readonly total: number;
  /** If the equipment choice were "Any equipment", with the muscles as they are. */
  readonly equipmentAny: number;
  /** If the equipment choice were "No equipment", with the muscles as they are. */
  readonly equipmentNone: number;
  /**
   * If the equipment choice were "Uses at least one of…", with the items already ticked
   * (`chosenEquipment`, kept while another choice is on) and the muscles as they are. With
   * nothing ticked it filters nothing, so it equals `equipmentAny`.
   */
  readonly equipmentChosen: number;
  /** For each item: if it alone were ticked under "chosen", with the muscles as they are. */
  readonly equipment: ReadonlyMap<Equipment, number>;
  /** For each muscle: if it alone were ticked, with the equipment choice as it is. */
  readonly muscles: ReadonlyMap<Muscle, number>;
};

/**
 * What each filter choice would leave on the screen (P7): the number beside it in the panel, and
 * 🔴 **zero means the choice is shown greyed and cannot be ticked** _(maintainer, 2026-11-17)_, for
 * an equipment item as for a muscle. A choice already ticked stays tickable so it can be unticked.
 *
 * **What is counted is what the list would show**, as the accepted prototype's panel counts it.
 * With no query: the library movements that fit (the custom items are their own section and are
 * not in the number). With a query: the hits and the custom items the query found, which are
 * shown whatever the filters (P8, P9), plus the library rows that pass. So while an exact name
 * is typed no choice greys: every one of them still leaves that row.
 *
 * Each number is for that choice ALONE of its kind, with the other kind's filters as they are.
 * Items are joined by "any of" and so are muscles, so a choice that counts zero alone can add no
 * row to whatever is already ticked: greying it hides nothing. Every vocabulary code has an
 * entry, in the vocabulary's order; `equipmentFilterOrder` gives the order the panel lists them.
 *
 * **The three equipment choices each have their number here** (`equipmentAny`, `equipmentNone`,
 * `equipmentChosen`), so a panel showing a number beside each calls this once, not once per
 * choice _(maintainer, 2026-11-17, from the filter panel's review)_. The one that is the choice
 * in force equals `total`.
 */
export function movementFilterCounts<T extends MatchableMovement & FilterableMovement>(
  options: readonly T[],
  search: { readonly query: string; readonly filters: MovementFilters },
): MovementFilterCounts {
  const found = findMovementOptions(options, search.query);
  const isHit = new Set<T>(found.hits);
  const browsing = foldMovementQuery(search.query.trim().slice(0, MOVEMENT_NAME_MAX)) === '';
  const rows = [
    ...new Set(browsing ? options : [...found.matches, ...found.near, ...found.someWords]),
  ].filter((option) => !isHit.has(option));
  const library = rows.filter((option) => option.isCatalog);
  // Shown whatever the filters: nothing when browsing, where the number is the library's alone.
  const always = browsing ? 0 : found.hits.length + (rows.length - library.length);
  const count = (filters: MovementFilters) =>
    always +
    (movementFiltersOn(filters) === 0
      ? library.length
      : library.filter((option) => passesMovementFilters(option, filters)).length);
  const { filters } = search;
  return {
    total: count(filters),
    equipmentAny: count({ ...filters, equipment: 'any' }),
    equipmentNone: count({ ...filters, equipment: 'none' }),
    equipmentChosen: count({ ...filters, equipment: 'chosen' }),
    equipment: new Map(
      EQUIPMENT.map((item) => [
        item,
        count({ ...filters, equipment: 'chosen', chosenEquipment: [item] }),
      ]),
    ),
    muscles: new Map(MUSCLES.map((muscle) => [muscle, count({ ...filters, muscles: [muscle] })])),
  };
}

/**
 * The equipment items in the order the panel lists them (P7): by how many movements each would
 * leave, most first, ties in the vocabulary's order. The first `EQUIPMENT_FILTER_SHOWN_FIRST` are
 * shown and the rest sit behind "Show all equipment"; an item that counts zero is listed greyed,
 * after the others (the accepted prototype left it out; production greys it, by the same decision
 * as for a muscle).
 */
export function equipmentFilterOrder(counts: MovementFilterCounts): readonly Equipment[] {
  return [...counts.equipment]
    .map(([item, count], index) => ({ item, count, index }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ item }) => item);
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

/**
 * Rows found by PART of an alias (spec P17): every query word is in the alias. The alias's own
 * quality is capped at 2, "a word starts with it", so it never ranks with names that start with
 * the query. An alias that IS the query is the plain match's (quality 0), not this.
 */
function aliasPartRows<T extends MatchableMovement>(
  prepared: readonly Prepared<T>[],
  words: readonly string[],
  folded: string,
): Row<T>[] {
  const rows: Row<T>[] = [];
  for (const p of prepared) {
    for (const alias of p.aliases) {
      if (!words.every((word) => alias.folded.includes(word))) continue;
      const own = spellingQuality(alias.folded, words, folded);
      if (own === null) continue;
      const quality: Quality = own === 1 ? 2 : own;
      rows.push({
        option: p.option,
        folded: p.folded,
        quality,
        by: FOUND_BY.alias,
        length: alias.compact.length,
        alias: alias.text,
      });
    }
  }
  return rows;
}

type NearMiss<T> = { option: T; folded: string; edits: number; alias: string | null };

function nearMisses<T extends MatchableMovement>(
  prepared: readonly Prepared<T>[],
  words: readonly string[],
): NearMiss<T>[] {
  if (!words.some((word) => editsAllowed(word) > 0)) return [];
  const compact = words.join('');
  const found: NearMiss<T>[] = [];
  for (const p of prepared) {
    const byWords = wordEdits(words, p);
    const byCompact = compactEdits(compact, p);
    const best = byCompact.edits < byWords.edits ? byCompact : byWords;
    if (Number.isFinite(best.edits)) found.push({ option: p.option, folded: p.folded, ...best });
  }
  return found.sort(
    (a, b) =>
      a.edits - b.edits ||
      Number(b.option.isCatalog ?? false) - Number(a.option.isCatalog ?? false) ||
      byName(a, b),
  );
}

const NO_MISS = { edits: Infinity, alias: null } as const;

/**
 * The edits it takes for EVERY query word to be in this option: none for a word that is part of
 * its name, else the fewest edits to a word of its name, else to a word of an alias (the alias is
 * then what the row was found through). `Infinity` when any word is neither.
 */
function wordEdits<T>(
  words: readonly string[],
  p: Prepared<T>,
): { edits: number; alias: string | null } {
  const nameWords = p.folded.split(' ');
  let total = 0;
  let through: string | null = null;
  for (const word of words) {
    if (p.folded.includes(word)) continue;
    const allowed = editsAllowed(word);
    if (allowed === 0) return NO_MISS;
    let fewest = fewestEdits(word, nameWords, allowed);
    if (fewest > allowed) {
      for (const alias of p.aliases) {
        const edits = fewestEdits(word, alias.folded.split(' '), allowed);
        if (edits < fewest) {
          fewest = edits;
          through = alias.text;
        }
      }
    }
    if (fewest > allowed) return NO_MISS;
    total += fewest;
  }
  return { edits: total, alias: through };
}

/** The fewest edits from `word` to any candidate that starts alike; `allowed + 1` when none is within `allowed`. */
function fewestEdits(word: string, candidates: readonly string[], allowed: number): number {
  let fewest = allowed + 1;
  for (const candidate of candidates) {
    if (!startsAlike(word, candidate)) continue;
    fewest = Math.min(fewest, editsWithin(word, candidate, allowed));
  }
  return fewest;
}

/** The same test on the whole query and a whole name or alias, spaces out. */
function compactEdits<T>(compact: string, p: Prepared<T>): { edits: number; alias: string | null } {
  const allowed = editsAllowed(compact);
  if (allowed === 0) return NO_MISS;
  const own = startsAlike(compact, p.compact)
    ? editsWithin(compact, p.compact, allowed)
    : allowed + 1;
  if (own <= allowed) return { edits: own, alias: null };
  let best: { edits: number; alias: string | null } = NO_MISS;
  for (const alias of p.aliases) {
    if (!startsAlike(compact, alias.compact)) continue;
    const edits = editsWithin(compact, alias.compact, allowed);
    if (edits <= allowed && edits < best.edits) best = { edits, alias: alias.text };
  }
  return best;
}
