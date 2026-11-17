'use client';

import {
  MOVEMENT_NAME_MAX,
  MOVEMENT_PICKER_GROUPS,
  matchMovementOptions,
  movementNameSchema,
  searchMovementOptions,
} from '@mat-plan/shared';
import {
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import type { MovementOptionDTO, MovementPickerData } from '@/lib/movements/movement-option';
import { MOVEMENT_PICKER_COPY as COPY } from '@/lib/movements/movement-picker-copy';
import { Button } from '@/components/ui/button';
import { SHEET_COPY, Sheet, sheetStatusId } from '@/components/ui/sheet';
import { INPUT_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The movement picker (PICK-1 Decision 8) — **reusable, and it never writes.**
 *
 * 🔴 **It lives outside `app/p/[profileId]/` so `D2`'s program editor mounts the SAME component**
 * (criterion 34), and it imports no Server Action and no `app/` module — a source-scan test pins
 * that, because "it cannot write" is the property that makes it safe to reuse. A typed name is
 * created by the CALLER's save: the set's today, the program's later.
 *
 * ## What is settled elsewhere, so this file does not re-decide it
 *
 * The browse groups and aliases are `MOVEMENT_PICKER_ENTRIES` (Decision 3); the fold, the match and
 * the alias/exact rules are `matchMovementOptions` (Decision 4), which is pure and tested against
 * the plan's vector table; every string is `MOVEMENT_PICKER_COPY` (reuse S4). The eight gaps the
 * pre-implementation UX panel found in Decision 8 are decided in the plan's
 * § "UX panel, round 2" and implemented here — each marked `panel 2 · N` at its site.
 */

const SHEET_ID = 'movement-picker';
// The two ids an `htmlFor` / `aria-describedby` pair needs on both sides. Derived once: a
// `${SHEET_ID}-…` re-typed at the second site is how a label stops pointing at its field, silently.
const SEARCH_ID = `${SHEET_ID}-search`;
const TYPED_HINT_ID = `${SHEET_ID}-typed-hint`;
/** Multi mode's create button: the caller returns focus to it from its form. */
export const PICKER_CREATE_ID = `${SHEET_ID}-create`;
/** A multi row's option id, so a caller can focus the row it just selected. */
export const OPTION_ID_ATTR = 'data-option-id';

/** What the picker needs to know about the day's program, as IDS on both sides (panel 2 · 6). */
export type TodaysProgramForPicker = {
  /** The prescribed movements' option public ids, in program order. */
  readonly ids: readonly string[];
  /** Those already on a card. PR 4 resolves each card to an id; this component never sees a card. */
  readonly onFormIds: ReadonlySet<string>;
};

/**
 * Multi-select (FAM-1 step 9: the program builder's item picker). The picker still never writes:
 * rows toggle through `onToggle`, and "create" hands the typed text to `onCreate`, which the caller
 * turns into its own form. Every word specific to the caller comes in through these props.
 */
export type MultiPick = {
  /** Selected option ids, in the order they were picked. */
  readonly selected: readonly string[];
  /** `via` is `'enter'` for the search's Enter, where no row has focus to say what happened. */
  onToggle: (option: MovementOptionDTO, via?: 'tap' | 'enter') => void;
  /**
   * The typed text, trimmed (`''` from the plain "+ New item"). Never fired from Enter. A person's
   * deliberate create: from here the caller owns where the name goes (CAT-3 P6 is about the search).
   */
  onCreate: (typed: string) => void;
  /**
   * The create button's words: `''` gives the plain one, a name gives "New item: “Bear Crawl”".
   * ⚠️ **Called on every render with the live query, so it must be pure** (CAT-3 P6: the query
   * never leaves the device). It is the one prop the search text reaches before a tap.
   */
  createLabel: (typed: string) => string;
  /** Shown under the create button when nothing matches at all. */
  noMatchHint: string;
  /** The line under each row's name (what it tracks). */
  describe: (option: MovementOptionDTO) => string;
  /**
   * The caller's action ("Add 3 items"), beside the picker's own Close: side by side, so the footer
   * is one button tall and the list keeps its room with a phone's keyboard up (maintainer,
   * 2026-11-16). Close stays the last child.
   */
  footerAction: ReactNode;
  /** The caller's lines above the two buttons (the picks so far, a notice). */
  footerNote?: ReactNode;
  /** A message for the sheet's status region, in place of the count while it is set. */
  notice?: string;
  /** Every change of the search text; the caller clears a stale `notice` with it. */
  onQueryChange?: () => void;
  /** The search's label and placeholder: the caller's noun ("items"), not "movements". */
  searchLabel: string;
  searchPlaceholder: string;
  /**
   * The caller's own body and footer in place of the search and the list (the new-item form). The
   * list, the selection and the query are kept underneath.
   */
  takeover?: { body: ReactNode; footer: ReactNode } | null;
};

export type MovementPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `"Choose a movement"` on the log form; `D2` passes its own. */
  title: string;
  data: MovementPickerData;
  todaysProgram?: TodaysProgramForPicker;
  /** `D2`: movements already in the workout being edited. Absent on the log form. */
  alreadyIn?: { readonly ids: ReadonlySet<string>; readonly label: string };
  /** The card's current movement, marked `aria-current`. */
  currentId?: string;
  returnFocusTo: RefObject<HTMLElement | null>;
  /** Passed to the sheet: once per close, after focus is back (a page-level message's moment). */
  onReturned?: () => void;
} & (
  | {
      /** `typed` is a deliberate "use as typed" tap: the caller owns where the name goes (P6). */
      onPick: (
        picked: { kind: 'existing'; option: MovementOptionDTO } | { kind: 'typed'; name: string },
      ) => void;
      multiple?: never;
    }
  | { multiple: MultiPick; onPick?: never }
);

/**
 * ONE place that turns a `MovementOptionDTO` into what the matcher reads (catalog-first, aliases
 * from the catalog only). Both the list's search and `listedAs` read through it.
 */
function matchable(options: readonly MovementOptionDTO[]) {
  return options.map((option) => ({
    name: option.name,
    isCatalog: option.owner === 'catalog',
    aliases: option.owner === 'catalog' ? option.aliases : [],
    option,
  }));
}

/**
 * The picker's match over its own options. The item picker's form asks the same question through
 * `listedAs`, so "RDL" is withheld in the list and selects Romanian Deadlift in the form by one
 * rule, not two copies of it.
 */
export function matchPickerOptions(options: readonly MovementOptionDTO[], text: string) {
  return matchMovementOptions(matchable(options), text);
}

/**
 * What the list shows (CAT-3 B1): the library's search, with short forms and near misses. Its
 * `exact` and `aliasHit` are `matchPickerOptions`' own for the text as typed (spec P1), so the list
 * withholds "use as typed" exactly where `listedAs` and the server's `existingItem` say the name is
 * already listed.
 */
export function searchPickerOptions(options: readonly MovementOptionDTO[], text: string) {
  return searchMovementOptions(matchable(options), { query: text });
}

/** The option `text` already names (an exact name or an alias hit), or `undefined`. */
export function listedAs(
  options: readonly MovementOptionDTO[],
  text: string,
): MovementOptionDTO | undefined {
  const result = matchPickerOptions(options, text);
  return result.exact || result.aliasHit ? result.matches[0]?.option : undefined;
}

/** A row, plus the single tag it earns. One tag per row, by precedence (panel 2 · 5). */
type Row = { option: MovementOptionDTO; tag: string | null };

/** How a row behaves: a pick (single), or a checkbox with its meta line (multi). */
type RowMode =
  | { kind: 'single'; currentId?: string; onPick: (option: MovementOptionDTO) => void }
  | {
      kind: 'multi';
      selected: ReadonlySet<string>;
      describe: (option: MovementOptionDTO) => string;
      onPick: (option: MovementOptionDTO) => void;
    };

/**
 * Ids → options, in the given order, **dropping what the map does not have.**
 *
 * Both id-driven sections need this and both must drop silently: a recent id can name a movement
 * that has since been soft-deleted, and a prescription can name one outside the picker's map
 * (panel 2 · 6). Rendering a hole, or an `undefined` row, is the failure to avoid.
 */
function resolveOptions(
  ids: readonly string[],
  byId: Map<string, MovementOptionDTO>,
): MovementOptionDTO[] {
  return ids.map((id) => byId.get(id)).filter((o): o is MovementOptionDTO => !!o);
}

export function MovementPicker({
  open,
  onOpenChange,
  title,
  data,
  todaysProgram,
  alreadyIn,
  currentId,
  returnFocusTo,
  onPick,
  multiple,
  onReturned,
}: MovementPickerProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  // The query resets on every open (UX NIT) — a sheet that reopens holding the last search makes the
  // browse list unreachable without a manual clear.
  //
  // ⚠️ **Adjusted DURING render, not in an effect.** `setQuery('')` inside `useEffect` is React's
  // documented cascading-render smell and this repo's lint refuses it: the sheet would paint once
  // with the stale query before clearing it. Comparing against the previous `open` and setting
  // during render is the documented pattern for deriving state from a prop, and React re-renders
  // immediately without committing the intermediate paint.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery('');
  }

  // Multi: the search is cleared when the caller's takeover (the new-item form) OPENS, not when it
  // closes. The deferred query then settles while the form is up, so the list is whole the moment
  // the form goes: the row the caller focuses is the one that stays. Cleared on close instead, a
  // browser drew the row first among the matches and then again in the full list, and focus went
  // with the first one (jsdom settles the deferred value at once, so only a browser shows it).
  const inTakeover = !!multiple?.takeover;
  const [wasTakeover, setWasTakeover] = useState(inTakeover);
  if (inTakeover !== wasTakeover) {
    setWasTakeover(inTakeover);
    if (inTakeover) setQuery('');
  }

  // 🔴 **The search box takes focus only when there is no on-screen keyboard to raise** (criterion
  // 18): focusing a field on touch covers the list the sheet exists to show. `matchMedia` is absent
  // in jsdom, so the guard is a capability check and the default (the sheet's title) applies there.
  const prefersKeyboardFocus =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(pointer: coarse)').matches;

  // 🔴 **ONE query drives everything below: the deferred one.** `query` itself reaches only the
  // `<input>`'s own `value`. Filtering ~110 rows on the deferred value keeps typing responsive
  // (FE-12's intent) — but the reason the immediate value is not *also* read anywhere is
  // correctness, not performance.
  //
  // React commits the urgent render with the OLD deferred value and corrects it in a second pass. So
  // a render that mixes the two shows states that are briefly WRONG rather than merely stale. Both
  // directions were real here: typing `f` into an empty box rendered **"No matches."** plus the loud
  // create button against a match computed for `''` — so the live region announced "No matches." and
  // then "N matches" on the first keystroke of EVERY search, which is precisely the read-once
  // problem criterion 46 exists to prevent. The other way round, `rd` → `rdl` offered for one frame
  // to create `rdl` against a stale `aliasHit`, and that button mints an undeletable household
  // movement duplicating Romanian Deadlift — the exact case this component exists to withhold.
  //
  // An earlier fix held creation while the two disagreed. That patched one symptom of two; one value
  // removes the class. The cost is that the footer lags a frame behind the text on a slow device,
  // which is a thumb reaching for a button that is correct rather than one that is current.
  //
  // ⚠️ Not folded. Folding happens inside `matchMovementOptions`, and nothing in this file tests a
  // FOLDED value for emptiness — the point of panel 2 · 4, below.
  const deferredTrimmed = useDeferredValue(query).trim();

  const result = useMemo(
    () => searchPickerOptions(data.options, deferredTrimmed),
    [data.options, deferredTrimmed],
  );

  const byId = useMemo(
    () => new Map(data.options.map((o) => [o.publicId, o] as const)),
    [data.options],
  );

  /** The ONE tag a row earns, highest precedence first (Decision 8; panel 2 · 5). */
  const tagFor = (
    option: MovementOptionDTO,
    inSearchResults: boolean,
    underHouseholdHeading: boolean,
  ) => {
    if (alreadyIn?.ids.has(option.publicId)) return COPY.tagAlreadyIn(alreadyIn.label);
    // `also called` fires ONLY on an alias hit, naming the alias that hit — otherwise it would
    // outrank the group label for every aliased row in search results (panel 2 · 5, against UX1 8).
    //
    // ⚠️ The alias comes from the MATCHER (`result.aliasHit` IS its text), and the test below is
    // plain identity on authored strings. This used to re-run "fold both sides, compare keys" here,
    // which is `movement-search.ts`'s rule and would have drifted from it the first time the fold
    // changed.
    if (result.aliasHit !== null && option.owner === 'catalog') {
      if (option.aliases.includes(result.aliasHit)) return COPY.tagAlsoCalled(result.aliasHit);
    }
    if (option.publicId === currentId) return COPY.tagCurrent;
    if (inSearchResults && option.owner === 'catalog') return COPY.groupLabel(option.group);
    if (option.owner === 'household' && !underHouseholdHeading) return COPY.tagHousehold;
    return null;
  };

  const rowsFrom = (
    options: readonly MovementOptionDTO[],
    opts: { inSearchResults?: boolean; underHouseholdHeading?: boolean } = {},
  ): Row[] =>
    options.map((option) => ({
      option,
      tag: tagFor(option, opts.inSearchResults ?? false, opts.underHouseholdHeading ?? false),
    }));

  // ── The ordered candidate list, and what Enter may act on (panel 2 · 3) ─────────────────────────
  // 🔴 The match result carries the DTO it was given, so there is nothing to look up. An earlier
  // version re-keyed by `name` — which is not the identity, `publicId` is: two options sharing a
  // display name collapsed to whichever was last in `data.options`, defeating the catalog-first tie
  // rule and duplicating a React `key`. `MovementPickerData` promises no name uniqueness, so the
  // component must not depend on Decision 5's read happening to shadow it.
  const matches = result.matches.map((m) => m.option);
  // Near misses and some-words are only filled when `matches` is empty (the contract's rule). A row
  // in both is shown, and counted, once: under the similar names (CAT-3 P5).
  const near = result.near.map((m) => m.option);
  const nearIds = new Set(near.map((o) => o.publicId));
  const someWords = result.someWords.map((m) => m.option).filter((o) => !nearIds.has(o.publicId));
  /** Anything listed for the query: what makes the create button the quiet one (UX2 B1, P5). */
  const hasCandidates = matches.length > 0 || near.length > 0 || someWords.length > 0;
  /**
   * The row the create hint names: the closest similar name, and only that. A some-words row is not
   * similar, and naming the first of several (by name) would point a new movement at an arbitrary
   * one (review of B1: `zercher squat` named Back Squat).
   */
  const similar = near[0];
  // Enter picks `matches[0]` iff unambiguous. Two `exact` hits resolve to the first — catalog-first by
  // Decision 4's tie rule, which is also the row the status names. A similar name and a some-words
  // row NEVER pick (P5): a typo and Enter must not choose a guess.
  const enterTarget =
    result.exact || result.aliasHit || matches.length === 1 ? matches[0] : undefined;

  // ── "Use as typed": offered for non-empty text that is not already in the list ─────────────────
  // 🔴 **Emptiness is tested on the RAW text, never on the fold** (panel 2 · 4). `🙂` and `---` fold
  // to `''`; a fold-based check would drop them into browse mode and never render the disabled
  // footer Decision 8 promises for them. Probed by replacing this with a fold-based test, which
  // reddens the aria-disabled cases.
  const offersTyped = deferredTrimmed !== '' && !result.exact && !result.aliasHit;
  // The reason comes from the SCHEMA, so the UI never hand-composes a rule the boundary owns. A name
  // breaking two rules shows the first, by `typedMovementNameIssues`' order.
  const typedNameIssue = useMemo(() => {
    if (!offersTyped) return null;
    const parsed = movementNameSchema.safeParse(deferredTrimmed);
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  }, [offersTyped, deferredTrimmed]);

  // ── The status region: ONE shape, `{count}. {reason}`, one reason by precedence (panel 2 · 1-2) ──
  const status = (() => {
    if (deferredTrimmed === '') return COPY.statusEmpty; // mounts silent — Announcer's rule 1
    // With no matches: "No matches." once, then each list's own count, similar names first (P5).
    const count =
      matches.length > 0
        ? COPY.statusCount(matches.length)
        : COPY.statusNone(near.length, someWords.length);
    const reason =
      (result.exact || result.aliasHit) && matches[0]
        ? COPY.statusAlreadyListed(matches[0].name)
        : typedNameIssue;
    return reason ? `${count} ${reason}` : count;
  })();

  const pickExisting = (option: MovementOptionDTO) => {
    // Multi: a row toggles and the sheet stays open.
    if (multiple) return multiple.onToggle(option);
    onPick({ kind: 'existing', option });
    onOpenChange(false);
  };

  const selectedSet = useMemo(() => new Set(multiple?.selected ?? []), [multiple?.selected]);
  const mode: RowMode = multiple
    ? { kind: 'multi', selected: selectedSet, describe: multiple.describe, onPick: pickExisting }
    : { kind: 'single', currentId, onPick: pickExisting };

  // Empty groups are omitted, so `wrestling` simply does not render until `C3` seeds it. The DTO
  // carries the group the DAL read out of `MOVEMENT_PICKER_ENTRIES`, so this trusts the DTO rather
  // than re-deriving it — one source, read once, at the boundary.
  //
  // ⚠️ **Rendered to ELEMENTS here, not to data.** Two branches show the browse groups — the empty
  // query, and "no matches at all" — and as a `.map()` written out at both sites the two had already
  // drifted by one prop during review.
  const browseGroups = MOVEMENT_PICKER_GROUPS.map((group) => ({
    group,
    rows: rowsFrom(data.options.filter((o) => o.owner === 'catalog' && o.group === group)),
  }))
    .filter(({ rows }) => rows.length > 0)
    .map(({ group, rows }) => (
      <Section
        key={group}
        mode={mode}
        id={`${headingId}-${group}`}
        heading={COPY.groupLabel(group)}
        rows={rows}
      />
    ));

  return (
    <Sheet
      id={SHEET_ID}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      returnFocusTo={returnFocusTo}
      onReturned={onReturned}
      initialFocus={prefersKeyboardFocus && !multiple?.takeover ? searchRef : undefined}
      status={multiple?.notice || status}
      headerExtra={
        multiple?.takeover ? undefined : (
          <div>
            <label className="sr-only" htmlFor={SEARCH_ID}>
              {multiple?.searchLabel ?? COPY.searchLabel}
            </label>
            <input
              ref={searchRef}
              id={SEARCH_ID}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                multiple?.onQueryChange?.();
              }}
              onKeyDown={(e) => {
                // Enter picks only when unambiguous, and NEVER fires "use as typed" (UX3 N8).
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (!enterTarget) {
                  // Nothing to pick. On a phone the Search key still puts the keyboard away, so
                  // the rows it is covering show: several matches, similar names, some-words.
                  if (!prefersKeyboardFocus && hasCandidates) {
                    e.currentTarget.blur();
                  }
                  return;
                }
                if (!multiple) return pickExisting(enterTarget);
                // Multi: Enter SELECTS (never deselects, never creates), then clears for the next.
                if (!selectedSet.has(enterTarget.publicId)) multiple.onToggle(enterTarget, 'enter');
                setQuery('');
                if (!prefersKeyboardFocus) e.currentTarget.blur();
              }}
              maxLength={MOVEMENT_NAME_MAX}
              autoComplete="off"
              // ⚠️ `autoCorrect` stays OFF — `rdl` → `roll` would be actively worse than no help.
              autoCorrect="off"
              // 🔴 **`words`, NOT `off`, and the reason is the CREATE half of this field.** Decision 8
              // chose `autocapitalize off` for a search box; this box also creates. With it off, a kid
              // typing `zercher squat` on a phone and tapping the footer puts **`zercher squat`** in
              // the household's list, next to `Back Squat`, permanently — no rename until `MOV-1`, no
              // delete until `V1-9b` — and the hint asks them to "check the spelling", which case is
              // not. Capitalising costs matching NOTHING: every comparison goes through `foldName`,
              // so `Rdl` still alias-hits `RDL` (probed). Found by the UX review of the built
              // component; neither earlier panel weighed the create side.
              autoCapitalize="words"
              spellCheck={false}
              enterKeyHint="search"
              placeholder={multiple?.searchPlaceholder ?? COPY.searchPlaceholder}
              aria-describedby={sheetStatusId(SHEET_ID)}
              // The placeholder is the field's only visible label: muted text, not the 3.74:1 default.
              className={cn(INPUT_CLASS, 'placeholder:text-muted-foreground w-full')}
            />
          </div>
        )
      }
      footer={
        multiple?.takeover ? (
          multiple.takeover.footer
        ) : multiple ? (
          // The caller's action beside the picker's own Close, which stays LAST (panel 2 · 7).
          <div className="flex flex-col gap-2">
            {multiple.footerNote}
            <div className="grid grid-cols-2 gap-2">
              {multiple.footerAction}
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full text-base"
                onClick={() => onOpenChange(false)}
              >
                {SHEET_COPY.close}
              </Button>
            </div>
          </div>
        ) : (
          // 🔴 **ALWAYS a footer, and Close is ALWAYS its last child** (panel 2 · 7). U0 renders a
          // full-width outline Close when no footer is passed, so a conditional footer made the slot
          // swap Close for an outline "Use as typed" at the same thumb position two keystrokes apart —
          // and that button mints a household movement with no in-app undo until V1-9b.
          <div className="flex flex-col gap-2">
            {offersTyped ? (
              <>
                <Button
                  type="button"
                  // Quiet with candidates above, loud with none (UX2 B1). `someWords` counts as
                  // candidates (panel 2 · 8): UX3 6 exists to steer toward them; so does `near` (P5).
                  variant={hasCandidates ? 'ghost' : 'outline'}
                  size="lg"
                  aria-disabled={typedNameIssue !== null}
                  aria-describedby={TYPED_HINT_ID}
                  onClick={() => {
                    // focusable but inert, with the reason in the hint
                    if (typedNameIssue) return;
                    onPick({ kind: 'typed', name: deferredTrimmed });
                    onOpenChange(false);
                  }}
                  // `button.tsx` is `whitespace-nowrap`; a long typed name must wrap, not clip.
                  // ⚠️ **`aria-disabled:` styles, because `Button` only styles `disabled:`.** Round 1
                  // chose `aria-disabled` so a keyboard user could REACH the reason, not so a sighted
                  // user would lose the inert cue — without these the button looks live, the tap does
                  // nothing, and the only signal is a `text-xs` line underneath.
                  className="h-auto min-h-11 w-full whitespace-normal wrap-anywhere text-base aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                >
                  {COPY.asTyped(deferredTrimmed)}
                </Button>
                {/* `wrap-anywhere`: the hint quotes the typed name, up to MOVEMENT_NAME_MAX with no
                    space, and must wrap at 360px as the button above it does. */}
                <p id={TYPED_HINT_ID} className="text-muted-foreground text-sm wrap-anywhere">
                  {typedNameIssue ??
                    (similar
                      ? COPY.asTypedHintNear(similar.name, deferredTrimmed)
                      : COPY.asTypedHint(deferredTrimmed))}
                </p>
              </>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full text-base"
              onClick={() => onOpenChange(false)}
            >
              {SHEET_COPY.close}
            </Button>
          </div>
        )
      }
    >
      {multiple?.takeover ? (
        multiple.takeover.body
      ) : (
        <>
          {multiple ? (
            <CreateTop
              multiple={multiple}
              typed={deferredTrimmed}
              offersTyped={offersTyped}
              issue={typedNameIssue}
              loud={!hasCandidates}
              noMatch={deferredTrimmed !== '' && !hasCandidates}
              similar={offersTyped ? similar?.name : undefined}
            />
          ) : null}
          {deferredTrimmed === '' ? (
            <>
              {data.recentIds && data.recentIds.length > 0 ? (
                <Section
                  mode={mode}
                  id={`${headingId}-recent`}
                  heading={COPY.recent}
                  rows={rowsFrom(resolveOptions(data.recentIds, byId))}
                />
              ) : null}
              {todaysProgram && !alreadyIn ? (
                <TodaysProgram
                  headingId={`${headingId}-program`}
                  program={todaysProgram}
                  byId={byId}
                  rowsFrom={rowsFrom}
                  mode={mode}
                />
              ) : null}
              {browseGroups}
              <Section
                mode={mode}
                id={`${headingId}-household`}
                heading={COPY.household}
                rows={rowsFrom(
                  data.options.filter((o) => o.owner === 'household'),
                  { underHouseholdHeading: true },
                )}
              />
            </>
          ) : matches.length > 0 ? (
            <Section
              mode={mode}
              id={`${headingId}-matches`}
              heading={COPY.matches}
              rows={rowsFrom(matches, { inSearchResults: true })}
            />
          ) : near.length > 0 || someWords.length > 0 ? (
            // Similar names first, then some-words (P5); each section omits itself when empty.
            <>
              <Section
                mode={mode}
                id={`${headingId}-near`}
                heading={COPY.near}
                rows={rowsFrom(near, { inSearchResults: true })}
              />
              <Section
                mode={mode}
                id={`${headingId}-some`}
                heading={COPY.someWords}
                rows={rowsFrom(someWords, { inSearchResults: true })}
              />
            </>
          ) : (
            // No matches at all: the browse list stays reachable under the "No matches" status, so the
            // sheet is never a dead end.
            <>{browseGroups}</>
          )}
        </>
      )}
    </Sheet>
  );
}

/**
 * Multi mode's create control, at the TOP of the body (FAM-1 step 9): with the keyboard up the
 * footer scrolls to the end of a long list, so a create button there is about 110 rows away. Quiet
 * with candidates, loud with none (UX2 B1); withheld on an exact or alias hit, where the status says
 * what is already listed; a plain "+ New item" when the query is empty. Never fired from Enter.
 */
function CreateTop({
  multiple,
  typed,
  offersTyped,
  issue,
  loud,
  noMatch,
  similar,
}: {
  multiple: MultiPick;
  typed: string;
  offersTyped: boolean;
  issue: string | null;
  loud: boolean;
  noMatch: boolean;
  /**
   * The closest similar name, while one is listed. The button sits above the list (the
   * maintainer's placement, 2026-11-16) and carries the person's own spelling, so its hint names
   * the movement they may mean, for sight and for a screen reader alike (UX panel, B1).
   */
  similar?: string;
}) {
  if (typed !== '' && !offersTyped) return null;
  const hint =
    issue ??
    (noMatch ? multiple.noMatchHint : similar ? COPY.similarListed(similar, 'below') : null);
  return (
    <div className="mb-4 flex flex-col gap-1">
      <Button
        id={PICKER_CREATE_ID}
        type="button"
        // The plain "+ New item" is a button that looks like one (the prototype's), and so is the
        // only path when nothing matches; with candidates above, it is quiet.
        variant={typed === '' || loud ? 'outline' : 'ghost'}
        size="lg"
        aria-disabled={issue !== null || undefined}
        aria-describedby={hint ? TYPED_HINT_ID : undefined}
        onClick={() => {
          if (issue) return;
          multiple.onCreate(typed);
        }}
        className="h-auto min-h-11 w-full justify-start whitespace-normal wrap-anywhere text-base aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {multiple.createLabel(typed)}
      </Button>
      {hint ? (
        <p id={TYPED_HINT_ID} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function TodaysProgram({
  headingId,
  program,
  byId,
  rowsFrom,
  mode,
}: {
  headingId: string;
  program: TodaysProgramForPicker;
  byId: Map<string, MovementOptionDTO>;
  rowsFrom: (options: readonly MovementOptionDTO[]) => Row[];
  mode: RowMode;
}) {
  // ⚠️ A prescribed id with no option is DROPPED before the open/closed decision (panel 2 · 6) —
  // otherwise the `<details>` opens over a row it cannot render. It happens when a prescription names
  // a movement outside the picker map, or a household row that fell off Decision 5's list.
  const options = resolveOptions(program.ids, byId);
  if (options.length === 0) return null;
  // Open while any prescribed movement is NOT yet on a card; the list always shows every prescribed
  // row, so a second card for one stays one tap away — only the summary changes.
  const allOnForm = options.every((o) => program.onFormIds.has(o.publicId));
  return (
    <section aria-labelledby={headingId} className="mb-4">
      <details open={!allOnForm}>
        {/*
          ⚠️ **The `h3` is INSIDE the `summary`**, not replaced by it. Every other section here is
          headed by an `h3`, and a screen-reader user navigating by heading — which is how you skim a
          long sheet — skipped straight past the one section holding the day's actual program,
          because a bare `summary` is a disclosure button and not a heading. Nesting them keeps the
          disclosure behaviour and puts the section back in the heading list.
        */}
        <summary className="min-h-11">
          <h3 id={headingId} className="text-muted-foreground mb-1 inline text-sm font-semibold">
            {allOnForm ? COPY.todaysProgramAllOnForm : COPY.todaysProgram}
          </h3>
        </summary>
        <OptionList rows={rowsFrom(options)} mode={mode} />
      </details>
    </section>
  );
}

function OptionList({ rows, mode }: { rows: Row[]; mode: RowMode }) {
  if (mode.kind === 'multi') {
    return (
      <ul className="flex flex-col gap-1">
        {rows.map(({ option, tag }) => {
          const checked = mode.selected.has(option.publicId);
          return (
            <li key={option.publicId}>
              {/*
                A checkbox row (FAM-1 step 9): one target that carries its state, so VoiceOver
                reads "Bear Crawl, Reps, checkbox, checked". Two columns: the name and its meta
                line wrap in the first; the box keeps its own column, so ticks line up at 360px.
              */}
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                {...{ [OPTION_ID_ATTR]: option.publicId }}
                onClick={() => mode.onPick(option)}
                // A ticked row is OUTLINED, not filled: muted text on the accent fill is 4.34:1,
                // under AA (docs/design.md, the rail's open row). The box carries the state, and
                // the `done` green is not used: it means "logged" (docs/design.md).
                className="focus-visible:ring-ring hover:border-border aria-checked:border-foreground grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left outline-none focus-visible:ring-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-base wrap-anywhere">{option.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {[mode.describe(option), tag].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'border-muted-foreground flex size-6 items-center justify-center rounded border text-sm',
                    checked && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {checked ? '✓' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
  const { currentId, onPick } = mode;
  return (
    <ul className="flex flex-col gap-1">
      {rows.map(({ option, tag }) => (
        <li key={option.publicId}>
          <button
            type="button"
            onClick={() => onPick(option)}
            // `aria-current` marks the card's movement; `min-h-12` is the ≥44px tap target.
            aria-current={option.publicId === currentId ? true : undefined}
            className="focus-visible:ring-ring hover:bg-accent flex min-h-12 w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-3"
          >
            <span className="min-w-0 break-words text-base">{option.name}</span>
            {/*
              ⚠️ `aria-current` on the row already announces it, so the VISIBLE `current` tag is
              hidden from assistive tech — otherwise the row reads "Back Squat, current, current".
              Compared against the const itself because only THIS tag duplicates the state:
              `already in Push A` and `also called RDL` outrank it and say something
              `aria-current` does not.
            */}
            {tag ? (
              <span
                aria-hidden={tag === COPY.tagCurrent || undefined}
                className="text-muted-foreground shrink-0 rounded border px-2 text-xs"
              >
                {tag}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One labelled section of the list. **Module scope, not nested in `MovementPicker`** — a component
 * defined inside another is a new type on every render, which remounts its whole subtree and loses
 * focus; this repo's lint refuses it ("Cannot create components during render").
 */
function Section({
  id,
  heading,
  rows,
  mode,
}: {
  id: string;
  heading: string;
  rows: Row[];
  mode: RowMode;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mb-4">
      <h3 id={id} className="text-muted-foreground mb-1 text-sm font-semibold">
        {heading}
      </h3>
      <OptionList rows={rows} mode={mode} />
    </section>
  );
}
