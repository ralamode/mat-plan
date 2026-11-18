'use client';

import {
  MOVEMENT_NAME_MAX,
  EQUIPMENT_LABELS,
  MOVEMENT_PICKER_GROUPS,
  requiresNoEquipment,
  SUPERVISION_LABELS,
  TRACKING_TYPE_LABELS,
  existingItem,
  filterMovementOptions,
  equipmentFilterOrder,
  movementFilterCounts,
  movementFiltersOn,
  NO_MOVEMENT_FILTERS,
  type CatalogHowTo,
  type Equipment,
  type MovementFilters,
  movementNameSchema,
  searchMovementOptions,
} from '@mat-plan/shared';
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import {
  hasLibraryData,
  type MovementOptionDTO,
  type MovementPickerData,
} from '@/lib/movements/movement-option';
import { MOVEMENT_PICKER_COPY as COPY } from '@/lib/movements/movement-picker-copy';
import { Button } from '@/components/ui/button';
import {
  FilterPanelBody,
  FilterPanelFooter,
  type FilterChange,
} from '@/components/movements/movement-filter-panel';
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
 * the "already listed" signals are `searchMovementOptions`' and the server's `existingItem`'s
 * (Decision 4, CAT-3 C30), which are pure and tested against their vector tables; every string is `MOVEMENT_PICKER_COPY` (reuse S4). The eight gaps the
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
  /**
   * "How to" (CAT-3 P16): the steps of a library row whose entry has instructions, by its public
   * id, loaded when the row is opened, or `null` when there are none. A failure is a rejection. **The caller's**, because the steps are read by
   * slug on the server and the picker imports no server action (invariant 2); an option carries no
   * slug. With no loader, no row shows "How to": a button that never works teaches people to
   * ignore it.
   */
  howTo?: (publicId: string) => Promise<CatalogHowTo | null>;
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
    // What a filter reads (P7). A household item has neither, so a filter cannot judge it (P9).
    equipment: hasLibraryData(option) ? option.equipment : undefined,
    primaryMuscle: hasLibraryData(option) ? option.primaryMuscle : null,
    option,
  }));
}

/**
 * What the list shows (CAT-3 B1): the library's search, with short forms, part of another name and
 * near misses. Its `exact` and `aliasHit` are the plain match's for the text as typed, and
 * `shortFormHit` is the third signal beside them (spec P1, C30): any of the three means the
 * movement is already listed, as the server's `existingItem` says.
 */
export function searchPickerOptions(
  options: readonly MovementOptionDTO[],
  text: string,
  filters?: MovementFilters,
) {
  return searchMovementOptions(matchable(options), { query: text, filters });
}

/**
 * The option `text` already names (an exact name, an exact alias, or what its short forms spell),
 * or `undefined`. **It IS the server's `existingItem`**, over the same mapping, so the item form
 * and `newItem` can never name different items for one text, and "RDL" or "db row" selects the
 * listed movement rather than making a second one.
 */
export function listedAs(
  options: readonly MovementOptionDTO[],
  text: string,
): MovementOptionDTO | undefined {
  return existingItem(matchable(options), text)?.option;
}

/** A row, plus the single tag it earns. One tag per row, by precedence (panel 2 · 5). */
type Row = { option: MovementOptionDTO; tag: string | null };

/** How a row behaves: a pick (single), or a checkbox (multi); both may carry "How to". */
type RowMode = { howTo: HowToControl | null } & (
  | { kind: 'single'; currentId?: string; onPick: (option: MovementOptionDTO) => void }
  | {
      kind: 'multi';
      selected: ReadonlySet<string>;
      onPick: (option: MovementOptionDTO) => void;
    }
);

/** The one open "How to": which row on screen, which load, and where its steps are. */
type HowToState = {
  /** The row's instance, `${section}:${publicId}`. */
  key: string;
  option: MovementOptionDTO;
  /** This load's number; an answer for any other load is dropped. */
  request: number;
  /** Silenced by a newer event (a tick), so the caller's notice speaks. */
  quiet?: boolean;
} & (
  | { status: 'loading'; afterFailure: boolean }
  | { status: 'none' | 'failed' }
  | { status: 'ready'; steps: CatalogHowTo }
);

/** What a row needs to show and work its "How to" button (null: no loader, so no button). */
type HowToControl = {
  openKey: string | null;
  state: HowToState | null;
  toggle: (key: string, option: MovementOptionDTO) => void;
  retry: (key: string, option: MovementOptionDTO) => void;
  hide: () => void;
};

/**
 * A row's second line (CAT-3 P14): how it is logged, then what it needs. A household item says
 * "Custom item" there and never "No equipment": it has no equipment to show.
 */
/** A library row's supervision, or `null`: a household item has none (P13). */
function supervisionOf(option: MovementOptionDTO) {
  return hasLibraryData(option) ? option.supervision : null;
}

export function rowMeta(option: MovementOptionDTO): string {
  const tracking = TRACKING_TYPE_LABELS[option.trackingType];
  if (option.owner === 'household') return COPY.rowMeta(tracking, COPY.customItem);
  // ⏳ An old built-in with no library entry (until the fresh start) has no equipment to show, and
  // saying "No equipment" would be a claim nobody made: just how it is logged.
  if (!hasLibraryData(option)) return tracking;
  const needs = requiresNoEquipment(option)
    ? COPY.emptyEquipment
    : COPY.equipmentList(option.equipment.map((item) => EQUIPMENT_LABELS[item]));
  return COPY.rowMeta(tracking, needs);
}

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
  howTo,
}: MovementPickerProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  // ── Filters (CAT-3 P7 to P10, B2-ii) ─────────────────────────────────────────────────────────────
  // 🔴 **Kept across opens, reset on leaving the workout** (P7): the state lives here and the
  // caller keeps this component mounted while its editor is, so a reopen still has them and leaving
  // the editor drops them. The panel REPLACES the body and footer while open (panel row 11).
  const [filters, setFilters] = useState<MovementFilters>(NO_MOVEMENT_FILTERS);
  const filtersOn = movementFiltersOn(filters);
  const [panelOpen, setPanelOpen] = useState(false);
  /** The panel's last change, said once in the sheet's one region (P15, panel row 12). */
  const [panelNote, setPanelNote] = useState<Omit<FilterChange, 'next'> | null>(null);
  const [shownBeyond, setShownBeyond] = useState<ReadonlySet<Equipment>>(() => new Set());
  /** Said once after a reopen with filters still on (panel row 10). */
  const [keptNote, setKeptNote] = useState('');
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  // Where focus goes once the next render has drawn it: the panel's heading, or the Filters button
  // the panel hid. A ref and an effect, because the target does not exist until after the render.
  const focusNext = useRef<'heading' | 'filters' | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'heading') panelHeadingRef.current?.focus();
    if (target === 'filters') filtersButtonRef.current?.focus();
  });
  /** The panel's own state, as a close and a reopen both leave it. */
  const resetPanel = () => {
    setPanelOpen(false);
    setPanelNote(null);
    setShownBeyond(new Set());
  };
  const openPanel = () => {
    setHow(null);
    setPanelNote(null);
    // The reopen's line was said; Back must not say it again (review of B2-ii).
    setKeptNote('');
    setPanelOpen(true);
    focusNext.current = 'heading';
  };
  const closePanel = () => {
    resetPanel();
    focusNext.current = 'filters';
  };
  const changeFilters = (change: FilterChange) => {
    // A ticked item stays listed after it is unticked while the panel is open (panel row 13).
    setShownBeyond((shown) => new Set([...shown, ...filters.chosenEquipment]));
    setFilters(change.next);
    setPanelNote({ choice: change.choice, on: change.on });
    setKeptNote('');
  };
  const clearFilters = (from: 'panel' | 'list') => {
    setFilters(NO_MOVEMENT_FILTERS);
    setKeptNote('');
    if (from === 'panel') {
      setPanelNote({ choice: COPY.filtersCleared, on: null });
      focusNext.current = 'heading';
    } else {
      // The line holding the button goes with the filters: focus moves to Filters (panel row 13).
      focusNext.current = 'filters';
    }
  };
  // The reopen's line is set AFTER the sheet has mounted its region: a region that mounts with its
  // text is silent (Announcer's rule 1). So the reopen marks it pending (below, during render) and
  // a timer says it once the region is there.
  const [keptPending, setKeptPending] = useState(false);
  useEffect(() => {
    if (!keptPending) return;
    const timer = setTimeout(() => {
      setKeptPending(false);
      if (filtersOn > 0) setKeptNote(COPY.statusFiltersKept(filtersOn));
    }, 0);
    return () => clearTimeout(timer);
  }, [keptPending, filtersOn]);

  // ── "How to" (CAT-3 P16): one row open at a time, its steps loaded by the caller's `howTo` ──────
  // 🔴 **Keyed by the row ON SCREEN** (`${section}:${publicId}`), not the movement: a movement can
  // be listed twice (Recent and its group), and two open boxes would share an id. Each load carries
  // its own number, and an answer is applied only while THAT load is still the open one, read from
  // state: so every path that resets `how` (reopen, a search change, the takeover) drops a late
  // answer without having to remember a counter.
  const [how, setHow] = useState<HowToState | null>(null);
  const howRequest = useRef(0);
  const loadHowTo = (key: string, option: MovementOptionDTO, afterFailure = false) => {
    if (!howTo) return;
    const request = (howRequest.current += 1);
    setHow({ key, option, request, status: 'loading', afterFailure });
    const settle = (next: HowToState) =>
      setHow((current) =>
        current && current.request === request && current.key === key ? next : current,
      );
    // Through `Promise.resolve().then`, so a loader that THROWS (not rejects) is a failure too, and
    // the box never sits "loading" forever.
    Promise.resolve()
      .then(() => howTo(option.publicId))
      .then(
        (steps) =>
          settle(
            steps
              ? { key, option, request, status: 'ready', steps }
              : { key, option, request, status: 'none' },
          ),
        () => settle({ key, option, request, status: 'failed' }),
      );
  };
  const howToControl: HowToControl | null = howTo
    ? {
        openKey: how?.key ?? null,
        state: how,
        toggle: (key, option) => (how?.key === key ? setHow(null) : loadHowTo(key, option)),
        retry: (key, option) => loadHowTo(key, option, true),
        hide: () => setHow(null),
      }
    : null;
  /**
   * Said in the sheet's one status region while a load has failed, and kept through its retry (so
   * the region does not fall back to re-reading the search count, criterion 46). It goes with the
   * box: Hide, a search change or a reopen ends it. **It wins over the caller's `notice`** while it
   * stands, being the newer event, until a tick or a create silences it (`quiet`).
   */
  const howMessage =
    how && !how.quiet && (how.status === 'failed' || (how.status === 'loading' && how.afterFailure))
      ? COPY.statusHowToFailed(how.option.name)
      : '';

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
    if (open) {
      setQuery('');
      setHow(null);
    }
    // The panel never reopens with the sheet: it opens on the list, filters kept (P7).
    resetPanel();
    setKeptNote('');
    setKeptPending(open && filtersOn > 0);
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
    if (inTakeover) {
      setQuery('');
      setHow(null);
    }
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
  // ⚠️ Not folded. Folding happens inside the search, and nothing in this file tests a
  // FOLDED value for emptiness — the point of panel 2 · 4, below.
  const deferredTrimmed = useDeferredValue(query).trim();

  const matchableOptions = useMemo(() => matchable(data.options), [data.options]);
  const result = useMemo(
    () => searchMovementOptions(matchableOptions, { query: deferredTrimmed, filters }),
    [matchableOptions, deferredTrimmed, filters],
  );
  /**
   * The search with no filter, for what must not depend on them (panel row 9): whether the create
   * button is loud, and the similar name its hint names. A filter hides rows; it never makes a
   * name new, so a duplicate is still a duplicate under one.
   */
  const unfiltered = useMemo(
    () =>
      filtersOn > 0 ? searchMovementOptions(matchableOptions, { query: deferredTrimmed }) : result,
    [filtersOn, matchableOptions, deferredTrimmed, result],
  );
  /**
   * Whether any row has the library's data, so a filter can judge it. A taxonomy-less built-in
   * (`BuiltInWithoutLibrary`, until CAT-3 chunk R) is a catalog row that every filter empties, so
   * it does not count: a list of only those gets no filter panel (7a-ii review).
   */
  const hasLibrary = useMemo(() => data.options.some(hasLibraryData), [data.options]);
  /** The panel's numbers (P7), only while it is open. */
  const panelCounts = useMemo(
    () =>
      panelOpen
        ? movementFilterCounts(matchableOptions, { query: deferredTrimmed, filters })
        : null,
    [panelOpen, matchableOptions, deferredTrimmed, filters],
  );
  /** The equipment list's order, ranked with no muscle on, so ticking a muscle never reshuffles it. */
  const equipmentOrder = useMemo(
    () =>
      panelOpen
        ? equipmentFilterOrder(
            movementFilterCounts(matchableOptions, {
              query: deferredTrimmed,
              filters: NO_MOVEMENT_FILTERS,
            }),
          )
        : [],
    [panelOpen, matchableOptions, deferredTrimmed],
  );

  const byId = useMemo(
    () => new Map(data.options.map((o) => [o.publicId, o] as const)),
    [data.options],
  );

  /** The ONE tag a row earns, highest precedence first (Decision 8; panel 2 · 5). */
  const tagFor = (option: MovementOptionDTO, inSearchResults: boolean) => {
    if (alreadyIn?.ids.has(option.publicId)) return COPY.tagAlreadyIn(alreadyIn.label);
    // An exact hit the filters would hide is listed anyway, and says why it is there (P8).
    if (hitsOutside.has(option.publicId)) {
      return hasLibraryData(option) ? COPY.tagNotInFilters : COPY.tagNoLibraryData;
    }
    // `also called` fires ONLY for a row the search found through another name, naming that alias:
    // an exact alias, part of one, or a near miss of one (C30's `foundByAlias`). Otherwise it would
    // outrank the group label for every aliased row in search results (panel 2 · 5, against UX1 8).
    //
    // ⚠️ The alias comes from the MATCHER, never re-derived here: "fold both sides, compare keys"
    // is `movement-search.ts`'s rule and a copy in a component drifts the first time it changes.
    const alias = aliasFound.get(option.publicId);
    if (alias !== undefined) return COPY.tagAlsoCalled(alias);
    if (option.publicId === currentId) return COPY.tagCurrent;
    if (inSearchResults && option.owner === 'catalog' && option.group) {
      return COPY.groupLabel(option.group);
    }
    // No `household` tag: the row's second line already says "Custom item" (P14), everywhere.
    return null;
  };

  const rowsFrom = (
    options: readonly MovementOptionDTO[],
    opts: { inSearchResults?: boolean } = {},
  ): Row[] =>
    options.map((option) => ({
      option,
      tag: tagFor(option, opts.inSearchResults ?? false),
    }));

  /** The alias each row was found through, by option id (C30's `foundByAlias`). */
  const aliasFound = new Map(
    [...result.foundByAlias].map(([row, alias]) => [row.option.publicId, alias] as const),
  );

  // ── The ordered candidate list, and what Enter may act on (panel 2 · 3) ─────────────────────────
  // 🔴 The match result carries the DTO it was given, so there is nothing to look up. An earlier
  // version re-keyed by `name` — which is not the identity, `publicId` is: two options sharing a
  // display name collapsed to whichever was last in `data.options`, defeating the contract's tie
  // rules and duplicating a React `key`. `MovementPickerData` promises no name uniqueness, so the
  // component must not depend on Decision 5's read happening to shadow it.
  const matches = result.matches.map((m) => m.option);
  // Near misses and some-words are only filled when `matches` is empty (the contract's rule). A row
  // in both is shown, and counted, once: under "Did you mean" (CAT-3 P5).
  const near = result.near.map((m) => m.option);
  const nearIds = new Set(near.map((o) => o.publicId));
  const someWords = result.someWords.map((m) => m.option).filter((o) => !nearIds.has(o.publicId));
  /** Under a filter, the household's items the query found: their own section (P9). */
  const custom = result.custom.map((m) => m.option);
  /** Hits a filter would hide, listed first anyway (P8). Only under a filter. */
  const hitsOutside = new Set(result.hitsOutsideFilters.map((m) => m.option.publicId));
  /** The hits lead `matches` with no heading under a filter (P8, panel row 15). */
  const hitCount = filtersOn > 0 ? result.hits.length : 0;
  /** Rows on the screen for the query. */
  const shown = matches.length + custom.length + near.length + someWords.length;
  /**
   * Anything listed for the query, filters or not: what makes the create button the quiet one
   * (UX2 B1, P5). 🔴 **Read before the filters** (panel row 9): a match the filters hide is still
   * a movement of that name, and a loud create beside it invites a permanent duplicate.
   */
  const hasCandidates =
    unfiltered.matches.length > 0 || unfiltered.near.length > 0 || unfiltered.someWords.length > 0;
  /**
   * The row the create hint names: the closest similar name, and only that. A some-words row is not
   * similar, and naming the first of several (by name) would point a new movement at an arbitrary
   * one (review of B1: `zercher squat` named Back Squat). From the unfiltered search, so a filter
   * never hides the name a person may mean; the hint then says it is outside the filters.
   */
  const similar = unfiltered.near[0]?.option;
  const similarOutside =
    similar !== undefined &&
    !near.some((o) => o.publicId === similar.publicId) &&
    !custom.some((o) => o.publicId === similar.publicId);
  /**
   * The movement the text already names, by the server's three signals (spec P1, C30): an exact
   * name or exact alias is the first row, else the row its short forms spell. The status names it,
   * Enter picks it, and "use as typed" is withheld for it. ⚠️ This is `existingItem`'s rule read off
   * the result the list already has; a test holds it and `listedAs` (which IS `existingItem`) to
   * one answer, so a change to the server's rule turns that test red rather than drifting.
   */
  const listed =
    result.exact || result.aliasHit !== null
      ? matches[0]
      : (result.shortFormHit?.option ?? undefined);
  // Enter picks the search's own target (P5, P8): a hit, whatever the filters, or the one match
  // there is when it was found by its own name. Never a similar name or a some-words row: a typo
  // and Enter must not choose a guess. A test holds it to `listed` for every hit.
  const enterTarget = result.enterTarget?.option;

  // ── "Use as typed": offered for non-empty text that is not already in the list ─────────────────
  // 🔴 **Emptiness is tested on the RAW text, never on the fold** (panel 2 · 4). `🙂` and `---` fold
  // to `''`; a fold-based check would drop them into browse mode and never render the disabled
  // footer Decision 8 promises for them. Probed by replacing this with a fold-based test, which
  // reddens the aria-disabled cases.
  const offersTyped = deferredTrimmed !== '' && !listed;
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
    // With no matches: "No matches." once, then each list's own count, close spellings first (P5).
    // Custom items set apart under a filter are on the screen, so they are counted (P9), each as
    // what it was found as: the search fills near misses and some-words only when nothing at all
    // matched, so with unfiltered matches every custom row is a match, and otherwise it is a near
    // miss or a some-words row (review of B2-ii: a custom near miss was announced as "1 match.").
    const customMatched = unfiltered.matches.length > 0 ? custom.length : 0;
    const nearIdsUnfiltered = new Set(unfiltered.near.map((m) => m.option.publicId));
    const customNear =
      customMatched > 0 ? 0 : custom.filter((o) => nearIdsUnfiltered.has(o.publicId)).length;
    const customSome = custom.length - customMatched - customNear;
    const count =
      matches.length + customMatched > 0
        ? COPY.statusCount(matches.length + customMatched)
        : near.length + customNear + someWords.length + customSome > 0
          ? COPY.statusNone(near.length + customNear, someWords.length + customSome)
          : result.outsideFilters > 0
            ? COPY.statusOutsideOnly(result.outsideFilters)
            : COPY.statusNone(0, 0);
    const reason = listed
      ? hitsOutside.has(listed.publicId)
        ? hasLibraryData(listed)
          ? COPY.statusAlreadyListedOutside(listed.name)
          : COPY.statusAlreadyListedNoData(listed.name)
        : COPY.statusAlreadyListed(listed.name)
      : typedNameIssue;
    return reason ? `${count} ${reason}` : count;
  })();

  const pickExisting = (option: MovementOptionDTO) => {
    // Multi: a row toggles and the sheet stays open. A tick is the newer event: the caller's notice
    // about it speaks, not a How-to failure still standing.
    if (multiple) {
      setHow((current) => (current ? { ...current, quiet: true } : current));
      return multiple.onToggle(option);
    }
    onPick({ kind: 'existing', option });
    onOpenChange(false);
  };

  const selectedSet = useMemo(() => new Set(multiple?.selected ?? []), [multiple?.selected]);
  const mode: RowMode = multiple
    ? { kind: 'multi', selected: selectedSet, onPick: pickExisting, howTo: howToControl }
    : { kind: 'single', currentId, onPick: pickExisting, howTo: howToControl };

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

  // Browsing with a filter on (P9; P12's heading until B3's tree): the household's items first,
  // folded to one line and marked "not filtered", then the library movements that fit, in the
  // browse groups' order, each row tagged with its group. Recent and Today's program are not shown.
  const groupIndex = (option: MovementOptionDTO) => {
    const index =
      option.owner === 'catalog' && option.group
        ? MOVEMENT_PICKER_GROUPS.indexOf(option.group)
        : -1;
    return index === -1 ? MOVEMENT_PICKER_GROUPS.length : index;
  };
  const filteredBrowse =
    filtersOn > 0
      ? (() => {
          const { fitting, custom: own } = filterMovementOptions(matchableOptions, filters);
          const fits = fitting.map((m) => m.option).sort((a, b) => groupIndex(a) - groupIndex(b));
          return (
            <>
              <FoldedSection
                headingId={`${headingId}-household-folded`}
                heading={COPY.householdNotFiltered}
                rows={rowsFrom(own.map((m) => m.option))}
                mode={mode}
                count
              />
              {fits.length > 0 ? (
                <Section
                  mode={mode}
                  id={`${headingId}-fit`}
                  heading={COPY.fitHeading}
                  rows={rowsFrom(fits, { inSearchResults: true })}
                />
              ) : (
                <ListLine text={COPY.noneFit} />
              )}
            </>
          );
        })()
      : null;

  return (
    <Sheet
      id={SHEET_ID}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      returnFocusTo={returnFocusTo}
      onReturned={onReturned}
      initialFocus={prefersKeyboardFocus && !multiple?.takeover ? searchRef : undefined}
      status={
        panelOpen
          ? panelNote && panelCounts
            ? panelNote.on === null
              ? COPY.panelStatusChoice(panelNote.choice, panelCounts.total, deferredTrimmed !== '')
              : COPY.panelStatus(
                  panelNote.choice,
                  panelNote.on,
                  panelCounts.total,
                  deferredTrimmed !== '',
                )
            : ''
          : howMessage || multiple?.notice || keptNote || status
      }
      onEscapeKeyDown={
        panelOpen
          ? (event) => {
              // Escape closes the panel only, as a nested dialog's would (panel row 11).
              event.preventDefault();
              closePanel();
            }
          : undefined
      }
      headerExtra={
        multiple?.takeover ? undefined : (
          // Hidden, not unmounted, while the panel is open (panel row 11): the query and the button
          // focus returns to are kept.
          // Wraps at 200 % text, where the button beside the box would leave it a few letters wide.
          <div hidden={panelOpen} className="flex flex-wrap items-center gap-2">
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
                setKeptNote('');
                // Typing closes an open "How to" (the prototype's rule): the row may leave the list.
                if (how) setHow(null);
                multiple?.onQueryChange?.();
              }}
              onKeyDown={(e) => {
                // Enter picks only when unambiguous, and NEVER fires "use as typed" (UX3 N8).
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (!enterTarget) {
                  // Nothing to pick. On a phone the Search key still puts the keyboard away, so
                  // the rows it is covering show: several matches, near misses, some-words.
                  if (!prefersKeyboardFocus && shown > 0) {
                    e.currentTarget.blur();
                  }
                  return;
                }
                if (!multiple) return pickExisting(enterTarget);
                // Multi: Enter SELECTS (never deselects, never creates), then clears for the next.
                if (!selectedSet.has(enterTarget.publicId)) multiple.onToggle(enterTarget, 'enter');
                setQuery('');
                setHow(null);
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
              className={cn(
                INPUT_CLASS,
                'placeholder:text-muted-foreground min-w-48 flex-1 basis-48',
              )}
            />
            {hasLibrary ? (
              <Button
                ref={filtersButtonRef}
                type="button"
                variant="outline"
                size="lg"
                aria-label={COPY.filtersName(filtersOn)}
                onClick={openPanel}
                className="shrink-0 text-base"
              >
                {COPY.filters(filtersOn)}
              </Button>
            ) : null}
          </div>
        )
      }
      footer={
        multiple?.takeover ? (
          multiple.takeover.footer
        ) : panelOpen && panelCounts ? (
          <FilterPanelFooter
            filters={filters}
            total={panelCounts.total}
            searching={deferredTrimmed !== ''}
            onClear={() => clearFilters('panel')}
            onShow={closePanel}
          />
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
                      ? similarOutside
                        ? COPY.asTypedHintOutside(similar.name, deferredTrimmed)
                        : COPY.asTypedHintNear(similar.name, deferredTrimmed)
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
      ) : panelOpen && panelCounts ? (
        <FilterPanelBody
          filters={filters}
          counts={panelCounts}
          equipmentOrder={equipmentOrder}
          onChange={changeFilters}
          onBack={closePanel}
          headingRef={panelHeadingRef}
          shownBeyond={shownBeyond}
        />
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
              // Never a ticked row: tapping it would untick what the person meant to keep.
              similar={
                offersTyped && similar && !selectedSet.has(similar.publicId)
                  ? { name: similar.name, outside: similarOutside }
                  : undefined
              }
            />
          ) : null}
          {filtersOn > 0 ? (
            <ListLine text={COPY.filtersOnLine(filtersOn)}>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => clearFilters('list')}
                className="shrink-0 text-base"
              >
                {COPY.clearFilters}
              </Button>
            </ListLine>
          ) : null}
          {deferredTrimmed === '' && filtersOn > 0 ? (
            filteredBrowse
          ) : filtersOn > 0 ? (
            // Under a query with a filter on (P8 to P10): the hits first with no heading, the
            // filtered matches, the custom items set apart, then the near misses and some-words.
            <>
              {hitCount > 0 ? (
                <div className="mb-4">
                  <OptionList
                    rows={rowsFrom(matches.slice(0, hitCount), { inSearchResults: true })}
                    mode={mode}
                    scope={`${headingId}-hits`}
                  />
                </div>
              ) : null}
              <Section
                mode={mode}
                id={`${headingId}-matches`}
                heading={hitCount > 0 ? COPY.moreMatches : COPY.matches}
                rows={rowsFrom(matches.slice(hitCount), { inSearchResults: true })}
              />
              <Section
                mode={mode}
                id={`${headingId}-custom`}
                heading={COPY.householdNotFiltered}
                rows={rowsFrom(custom, { inSearchResults: true })}
              />
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
              {result.outsideFilters > 0 ? (
                <ListLine
                  text={COPY.outsideLine(
                    result.outsideFilters,
                    result.outsideWithoutData,
                    deferredTrimmed,
                    shown > 0,
                  )}
                >
                  {/* Its own Clear filters: after a scroll, the line at the top is out of reach. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={() => clearFilters('list')}
                    className="shrink-0 text-base"
                  >
                    {COPY.clearFilters}
                  </Button>
                </ListLine>
              ) : null}
              {/* No match at all: the list beneath is the filtered one, never the whole (P10). With
                  matches the filters hide, it is not shown: a kid reads it as results for the query
                  (the accepted prototype shows it only when nothing matched). */}
              {shown === 0 && result.outsideFilters === 0 ? filteredBrowse : null}
            </>
          ) : deferredTrimmed === '' ? (
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
                rows={rowsFrom(data.options.filter((o) => o.owner === 'household'))}
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
            // "Did you mean" first, then some-words (P5); each section omits itself when empty.
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
 * with candidates, loud with none (UX2 B1); withheld when the text already names a movement (an exact name or alias, or what its
 * short forms spell), where the status says
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
  similar?: { name: string; outside: boolean };
}) {
  if (typed !== '' && !offersTyped) return null;
  const hint =
    issue ??
    (noMatch
      ? multiple.noMatchHint
      : similar
        ? similar.outside
          ? COPY.similarOutside(similar.name)
          : COPY.similarListed(similar.name, 'below')
        : null);
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
    <FoldedSection
      headingId={headingId}
      heading={allOnForm ? COPY.todaysProgramAllOnForm : COPY.todaysProgram}
      rows={rowsFrom(options)}
      mode={mode}
      open={!allOnForm}
    />
  );
}

/**
 * A line in the list with an optional control beside it: the filters-on line (panel row 10) and
 * the counts outside the filters (P10). Plain text: the sheet's one region says the count.
 */
function ListLine({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      {/* `wrap-anywhere`: the outside line quotes the query, which may have no space. */}
      <p className="text-sm font-medium wrap-anywhere">{text}</p>
      {children}
    </div>
  );
}

/**
 * A section folded to one line: Today's program (open while any of it is not yet on a card) and,
 * under a filter, the household's items (P9), whose summary carries its count.
 *
 * 🔴 **It opens itself while it holds a ticked row** (multi mode). A caller focuses the row it just
 * made or selected (the item form's Create), and a row inside a closed `<details>` cannot take
 * focus in a browser: focus would fall to the page and the new item would look lost, inviting a
 * second, permanent create (review of B2-ii).
 */
function FoldedSection({
  headingId,
  heading,
  rows,
  mode,
  open = false,
  count = false,
}: {
  headingId: string;
  heading: string;
  rows: Row[];
  mode: RowMode;
  open?: boolean;
  /** Show the rows' count in the summary. */
  count?: boolean;
}) {
  const holdsTicked =
    mode.kind === 'multi' && rows.some(({ option }) => mode.selected.has(option.publicId));
  // The TICK is a latch, not a live value: once a ticked row held the section open it stays held
  // (the caller's `open` stays live). If `open` followed `holdsTicked` live, unticking the last ticked row would drop
  // the attribute, React would close the section under the person's thumb, and the focused row
  // would vanish with nowhere for focus to go. A tap on the summary still closes it: the browser
  // owns the attribute after that, and React re-applies nothing while the prop stays `true`.
  // Adjusted during render (React's pattern), as the sheet's reset is above.
  const [held, setHeld] = useState(holdsTicked);
  if (holdsTicked && !held) setHeld(true);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mb-4">
      <details open={open || held || undefined}>
        {/*
          ⚠️ **The `h3` is INSIDE the `summary`**, not replaced by it. Every other section here is
          headed by an `h3`, and a screen-reader user navigating by heading — which is how you skim a
          long sheet — skipped straight past the one section holding the day's actual program,
          because a bare `summary` is a disclosure button and not a heading. Nesting them keeps the
          disclosure behaviour and puts the section back in the heading list.
        */}
        <summary className="min-h-11">
          <h3 id={headingId} className="text-muted-foreground mb-1 inline text-sm font-semibold">
            {count ? COPY.foldedCount(heading, rows.length) : heading}
          </h3>
        </summary>
        <OptionList rows={rows} mode={mode} scope={headingId} />
      </details>
    </section>
  );
}

/** A section's rows. `scope` is the section's id: it keys each row's "How to" (one per row on screen). */
function OptionList({ rows, mode, scope }: { rows: Row[]; mode: RowMode; scope: string }) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map(({ option, tag }) => (
        <OptionRow
          key={option.publicId}
          option={option}
          tag={tag}
          mode={mode}
          rowKey={`${scope}:${option.publicId}`}
        />
      ))}
    </ul>
  );
}

/**
 * One option, in either mode (CAT-3 P13, P14, P16). The pick control holds the name, the
 * supervision label and the second line; "How to" sits beside it, and its steps open under the row.
 *
 * - **Multi:** a `button role="checkbox"` with the box on the LEFT (the accepted prototype's), so
 *   ticks line up whether or not a row has "How to", and no thumb aimed at the box lands on it
 *   (UX panel, B2). A ticked row is outlined, never filled: muted text on the accent fill is under AA.
 * - **Single:** a button, `aria-current` on the card's movement. Hover outlines it too, for the same
 *   contrast reason, now that the row has a muted second line.
 * - The tag joins the second line: three lines and a tag line left under two rows on a phone with
 *   the keyboard up (UX panel, B2).
 * - With a loader, a row without steps keeps the "How to" column empty (the prototype's spacer), so
 *   the rows' outlines end at one edge and names wrap at one width.
 */
function OptionRow({
  option,
  tag,
  mode,
  rowKey,
}: {
  option: MovementOptionDTO;
  tag: string | null;
  mode: RowMode;
  rowKey: string;
}) {
  const howButton = useRef<HTMLButtonElement>(null);
  const supervision = supervisionOf(option);
  const hasHowTo = mode.howTo !== null && hasLibraryData(option) && option.hasInstructions;
  const howState = hasHowTo && mode.howTo?.openKey === rowKey ? mode.howTo.state : null;
  const howId = `how-to-${rowKey}`;
  const checked = mode.kind === 'multi' && mode.selected.has(option.publicId);
  // The row's accessible name reads its parts apart, "Pull-Up, Learn with a coach present, Reps ·
  // Pull-up bar": stacked spans carry no space between them, so the name ran "Pull-UpLearn with…".
  const pause = <span className="sr-only">{', '}</span>;
  const text = (
    <span className="flex min-w-0 flex-col">
      <span className="text-base wrap-anywhere">{option.name}</span>
      {supervision ? (
        <>
          {pause}
          {/* Full contrast in every row state (the prototype's `.sup`; P0 left the contrast owed). */}
          <span className="text-foreground text-sm font-medium">
            {SUPERVISION_LABELS[supervision]}
          </span>
        </>
      ) : null}
      {pause}
      <span className="text-muted-foreground text-sm wrap-anywhere">
        {rowMeta(option)}
        {tag ? (
          <>
            {COPY.rowMetaJoin}
            {/*
              ⚠️ `aria-current` on a single row already announces it, so the VISIBLE `current` tag
              is hidden from assistive tech: otherwise the row reads "current, current".
            */}
            <span data-row-tag aria-hidden={tag === COPY.tagCurrent || undefined}>
              {tag}
            </span>
          </>
        ) : null}
      </span>
    </span>
  );
  return (
    <li>
      <div className="flex items-stretch gap-1">
        {mode.kind === 'multi' ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            {...{ [OPTION_ID_ATTR]: option.publicId }}
            onClick={() => mode.onPick(option)}
            className="focus-visible:ring-ring hover:border-border aria-checked:border-foreground grid min-h-12 min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left outline-none focus-visible:ring-3"
          >
            <span
              aria-hidden
              className={cn(
                'border-muted-foreground flex size-6 items-center justify-center rounded border text-sm',
                checked && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              {checked ? '✓' : ''}
            </span>
            {text}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => mode.onPick(option)}
            // `aria-current` marks the card's movement; `min-h-12` is the ≥44px tap target.
            aria-current={option.publicId === mode.currentId ? true : undefined}
            className="focus-visible:ring-ring hover:border-border min-h-12 min-w-0 flex-1 rounded-lg border border-transparent px-3 py-2 text-left outline-none focus-visible:ring-3"
          >
            {text}
          </button>
        )}
        {hasHowTo ? (
          <button
            ref={howButton}
            type="button"
            aria-label={COPY.howToFor(option.name)}
            aria-expanded={howState !== null}
            // Only while open: a reference to an element that is not there points at nothing.
            aria-controls={howState ? howId : undefined}
            onClick={() => mode.howTo?.toggle(rowKey, option)}
            // Looks like its own button beside the pick target (the prototype's): underlined, medium,
            // and a divider at 3:1, so a thumb can tell where the row ends.
            className="focus-visible:ring-ring hover:bg-muted border-muted-foreground/60 min-h-11 w-17 shrink-0 rounded-lg border-l px-2 text-sm font-medium underline underline-offset-3 outline-none focus-visible:ring-3"
          >
            {COPY.howTo}
          </button>
        ) : mode.howTo !== null ? (
          <span aria-hidden className="w-17 shrink-0" />
        ) : null}
      </div>
      {howState && mode.howTo ? (
        <HowToSteps
          id={howId}
          option={option}
          state={howState}
          // Focus first, then change: Try again and Hide are inside what they replace (UX panel).
          onRetry={() => {
            howButton.current?.focus();
            mode.howTo?.retry(rowKey, option);
          }}
          onHide={() => {
            howButton.current?.focus();
            mode.howTo?.hide();
          }}
        />
      ) : null}
    </li>
  );
}

/**
 * The open "How to" (CAT-3 P16, K17): a named region with the name as its heading, **the
 * supervision label first** whenever the movement has one (from the option, so a loader that leaves
 * it out cannot drop it), then the steps. All text at full contrast: the box is `bg-muted`, where
 * muted text is under AA.
 */
function HowToSteps({
  id,
  option,
  state,
  onRetry,
  onHide,
}: {
  id: string;
  option: MovementOptionDTO;
  state: HowToState;
  onRetry: () => void;
  onHide: () => void;
}) {
  const supervision =
    supervisionOf(option) ?? (state.status === 'ready' ? state.steps.supervision : null);
  const steps =
    state.status === 'ready'
      ? state.steps.instructions
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  const titleId = `${id}-title`;
  return (
    <div
      id={id}
      role="region"
      aria-labelledby={titleId}
      aria-busy={state.status === 'loading' || undefined}
      className="bg-muted text-foreground mt-1 flex flex-col gap-2 rounded-lg p-3 text-sm"
    >
      <h4 id={titleId} className="font-semibold">
        {COPY.howToFor(option.name)}
      </h4>
      {supervision ? <p className="font-medium">{SUPERVISION_LABELS[supervision]}</p> : null}
      {state.status === 'loading' ? <p>{COPY.howToLoading}</p> : null}
      {state.status === 'none' || (state.status === 'ready' && steps.length === 0) ? (
        <p>{COPY.howToNone}</p>
      ) : null}
      {state.status === 'failed' ? (
        <>
          <p>{COPY.howToFailed}</p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="self-start"
            onClick={onRetry}
          >
            {COPY.howToRetry}
          </Button>
        </>
      ) : null}
      {steps.length > 0 ? (
        <ol className="list-decimal pl-5">
          {steps.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      ) : null}
      {/* Outline, not ghost: a ghost's hover fill is the box's own colour, so it read as text. */}
      <Button type="button" variant="outline" size="lg" className="self-start" onClick={onHide}>
        {COPY.howToHide}
      </Button>
    </div>
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
      <OptionList rows={rows} mode={mode} scope={id} />
    </section>
  );
}
