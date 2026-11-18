import { MOVEMENT_PICKER_GROUP_LABELS, type MovementPickerGroup } from '@mat-plan/shared';

import { APP_LOCALE } from '@/lib/i18n/locale';
import { formatList, plural, quote } from '@/lib/i18n/plural';

/** See `asTypedHint` below for why every word of it is load-bearing. */
const asTypedHintText = (name: string) =>
  `Adds ${quote(name)} to the list for everyone in your household. It can't be deleted, so check the spelling.`;

const statusNoMatches = 'No matches.';
/** "12 movements": a filter choice's count, and the panel's. */
const movementCount = (n: number) => plural(n, { one: `${n} movement`, other: `${n} movements` });
/** Between the parts of a row's second line, and before its tag. */
const ROW_META_JOIN = ' · ';
/** A FRAGMENT of `statusNone`'s sentence, not a sentence: it has no terminal period. */
const statusSomeWords = (n: number) => `${n} with some of your words`;
/**
 * The near misses' count, as the accepted prototype words it ("1 close spelling"): a FRAGMENT of
 * `statusNone`'s sentence. The heading over them is "Did you mean" (spec P5, amended at the
 * prototype's sign-off).
 */
const statusNear = (n: number) =>
  plural(n, { one: `${n} close spelling`, other: `${n} close spellings` });
/**
 * Leads the create hint while a similar name is listed (UX panel, B1): the button carries the
 * person's own spelling, so the hint next to it names the movement they may mean and says what to
 * do, without claiming a typo. `where` is where the list sits from the button: above the footer in
 * single mode, below the top in multi.
 */
/** The household's section, in the maintainer's words (P9); the filtered form adds to it. */
const HOUSEHOLD = 'Your custom items';
const FILTERS = 'Filters';
/** Between a filter choice's label and its count, in its accessible name ("Lats, 12 movements"). */
const CHOICE_JOIN = ', ';
/**
 * The near miss a person may mean, when the filters hide it (panel row 9; reworded at B2-ii's
 * review: the row is NOT on screen, so "is listed" sent people looking for it).
 */
const similarHidden = (name: string) =>
  `${quote(name)} already exists, but your filters hide it. Clear filters to see it.`;
/** Rows on screen, in the panel's one noun for the case: results under a query, else movements. */
const shownCount = (n: number, searching: boolean) =>
  searching ? plural(n, { one: `${n} result`, other: `${n} results` }) : movementCount(n);
const similarListed = (name: string, where: 'above' | 'below') =>
  `${quote(name)} is ${where}. Tap it if that's the one.`;

/**
 * Every string the movement picker shows — the picker itself, the card hint, the Save line and the
 * footer's guard copy (PICK-1 Decision 8, reuse S4).
 *
 * 🔴 **Its own module, NOT `lib/constants.ts`.** `AUTH-1` 1c edits that file, and a whole feature's
 * copy landing in it is a guaranteed conflict for no benefit. `MOV-1` **adds to THIS file** — its
 * plan's file table lists this path as `EDIT (PICK-1 creates it)` and puts `MOVEMENT_RENAME_COPY`
 * beside this const (`mov-1-rename-movement.md`, § Files). Nothing is renamed later; an earlier
 * version of this comment invented a `movement-copy.ts` and an obligation to converge on it.
 *
 * ⚠️ **Several of these are functions, not strings, and that is deliberate** — a template literal
 * built at the call site is how the same sentence ends up phrased two ways on two screens. The
 * pluralisation lives here too, for the same reason.
 */
export const MOVEMENT_PICKER_COPY = {
  /** The sheet's title on the log form. `D2`'s editor passes its own. */
  title: 'Choose a movement',
  /** The search field's label. `sr-only` — the sheet's title already says what this is. */
  searchLabel: 'Search movements',
  searchPlaceholder: 'Search or type a new movement',
  close: 'Close',

  // ── Section headings ────────────────────────────────────────────────────────────────────────────
  recent: 'Recent',
  todaysProgram: "Today's program",
  /** The `<details>` summary when every prescribed movement is already on a card (UX1 2). */
  /** ⚠️ "added", not "on your form" — "form" is our word for it, not a twelve-year-old's. */
  todaysProgramAllOnForm: "Today's program (already added)",
  /** A household's own items (CAT-3 P9: "Your custom items", the maintainer's words). */
  household: HOUSEHOLD,
  matches: 'Matches',
  someWords: 'Has some of your words',
  /** Near misses (CAT-3 spec P5 as amended at the prototype's sign-off, 2026-11-17). */
  near: 'Did you mean',
  groupLabel: (group: MovementPickerGroup) => MOVEMENT_PICKER_GROUP_LABELS[group],

  // ── Row tags, one per row by precedence (UX2 S2, UX3 4, UX1 8) ──────────────────────────────────
  tagAlreadyIn: (label: string) => `already in ${label}`,
  /** Only on an alias HIT, naming the alias that hit — panel round 2, gap 5. */
  tagAlsoCalled: (alias: string) => `also called ${alias}`,
  tagCurrent: 'current',

  // ── The row's second line (CAT-3 P13, P14) ──────────────────────────────────────────────────────
  /**
   * A library movement whose equipment set is empty: just you and the floor. A LABEL, computed on
   * the row from the set (`requiresNoEquipment`'s rule); the answer is stored nowhere (spec V5,
   * whose scan forbids naming a field for it).
   */
  emptyEquipment: 'No equipment',
  /** The equipment a library row needs, as a locale's list ("Barbell, Bench"), never a `.join`. */
  equipmentList: (labels: readonly string[]) => formatList(labels, APP_LOCALE, 'unit'),
  /** The row's second line (P14): how it is logged, then what it needs. The tag joins with the same mark. */
  rowMeta: (tracking: string, needs: string) => `${tracking}${ROW_META_JOIN}${needs}`,
  rowMetaJoin: ROW_META_JOIN,
  /**
   * A household's own item, in place of its equipment. 🔴 **Never "No equipment"**: it has no
   * equipment field at all, and saying it needs none is a claim nobody made (P14).
   */
  customItem: 'Custom item',

  // ── "How to" (CAT-3 P16) ────────────────────────────────────────────────────────────────────────
  howTo: 'How to',
  howToFor: (name: string) => `How to do ${name}`,
  howToHide: 'Hide',
  howToLoading: 'Loading…',
  howToFailed: "Couldn't load the steps.",
  howToRetry: 'Try again',
  howToNone: 'No steps for this movement yet.',
  /** Said once when the steps fail to load: the box's text is not a live region. */
  statusHowToFailed: (name: string) => `Couldn't load the steps for ${name}.`,

  // ── Filters (CAT-3 P7 to P10, B2-ii) ────────────────────────────────────────────────────────────
  // ⚠️ `filters`, `filtersName`, `showAllEquipment` and `statusOutsideOnly` show a number with no
  // counted noun beside it, so they need no `plural()` (invariant 10 is about counted nouns).
  /** The control's visible text: "Filters", or "Filters · 3" while three are on. */
  filters: (on: number) => (on === 0 ? FILTERS : `${FILTERS} · ${on}`),
  /** Its accessible name carries how many are on (P15). */
  filtersName: (on: number) => (on === 0 ? `${FILTERS}, none on` : `${FILTERS}, ${on} on`),
  filtersHeading: FILTERS,
  filtersBack: 'Back to the list',
  equipmentLegend: 'Equipment',
  equipmentAny: 'Any equipment',
  /** The "No equipment" radio's hint. The radio's label is `emptyEquipment`, a row's same words. */
  equipmentNoneHint: 'Just you and the floor. A wall, a towel or a partner counts as equipment.',
  equipmentChosen: 'Uses at least one of…',
  equipmentChosenHint:
    'A movement may need more than the one you tick. Each row lists what it needs.',
  /** The items' own fieldset, under "Uses at least one of…". */
  equipmentItemsLegend: 'Equipment to use',
  showAllEquipment: (n: number) => `Show all equipment (${n})`,
  showFewerEquipment: 'Show fewer',
  musclesLegend: 'Main muscle',
  /** A choice's accessible name: its label, then its count said ("Lats, 12 movements"). */
  choiceName: (label: string, n: number) => `${label}${CHOICE_JOIN}${movementCount(n)}`,
  choiceJoin: CHOICE_JOIN,
  clearFilters: 'Clear filters',
  /** What the panel says after Clear filters: "Filters cleared. 120 movements." */
  filtersCleared: `${FILTERS} cleared`,
  /** The panel's button that shows the list: "Show 12 movements", or "Show 3 results" under a query. */
  showResults: (n: number, searching: boolean) => `Show ${shownCount(n, searching)}`,
  nothingFits: 'Nothing fits',
  /** The panel's visible count (plain text), in the same noun as its button. */
  panelCount: (n: number, searching: boolean) => `${shownCount(n, searching)}.`,
  /** Said once per change, in the sheet's one region while the panel is open (P15). */
  panelStatus: (choice: string, on: boolean, n: number, searching: boolean) =>
    `${choice} ${on ? 'on' : 'off'}. ${shownCount(n, searching)}.`,
  /**
   * Said for a radio or Clear filters: the choice, then the count. A label that already ends in
   * an ellipsis ("Uses at least one of…") takes no second stop.
   */
  panelStatusChoice: (choice: string, n: number, searching: boolean) =>
    `${choice}${choice.endsWith('…') ? '' : '.'} ${shownCount(n, searching)}.`,
  /** The line at the top of the list while filters are on (panel row 10). */
  filtersOnLine: (on: number) =>
    plural(on, { one: `${on} filter on.`, other: `${on} filters on.` }),
  /** Under a query, after the rows that pass (P10). */
  outsideMore: (n: number) =>
    plural(n, {
      one: `${n} more is not in your filters.`,
      other: `${n} more are not in your filters.`,
    }),
  /** Under a query, when nothing found passes (P10). */
  outsideAll: (n: number, query: string) =>
    plural(n, {
      one: `${n} movement for ${quote(query)} is not in your filters.`,
      other: `${n} movements for ${quote(query)} are not in your filters.`,
    }),
  /** Browsing with nothing that fits (P10). */
  noneFit: 'No movements fit your filters.',
  /** Browsing with a filter on, until B3's tree (P12's heading). */
  fitHeading: 'Movements that fit your filters',
  /** The household's items under a filter: a filter cannot judge them (P9). */
  householdNotFiltered: `${HOUSEHOLD} (not filtered)`,
  /** A folded section's summary carries its count, so a person can tell whether to open it. */
  foldedCount: (heading: string, n: number) => `${heading} · ${n}`,
  /** After a headingless hit (panel row 15): the hit is a match too. */
  moreMatches: 'More matches',
  tagNotInFilters: 'not in your filters',
  /** The create hint (multi mode) when the filters hide the similar name (row 9). */
  similarOutside: similarHidden,
  /** Single mode's footer hint in the same case: that, then the warning. */
  asTypedHintOutside: (similar: string, typed: string) =>
    `${similarHidden(similar)} ${asTypedHintText(typed)}`,
  /** The status with nothing in the filters and some outside them (the prototype's words). */
  statusOutsideOnly: (n: number) => `Nothing in your filters. ${n} outside them.`,
  /** Said once after the picker opens with filters still on (panel row 10). */
  statusFiltersKept: (on: number) =>
    plural(on, {
      one: `${on} filter still on.`,
      other: `${on} filters still on.`,
    }),

  // ── The status region (criterion 46), as ONE shape: `{count}. {reason}` ─────────────────────────
  /**
   * 🔴 **The empty query announces NOTHING**, and that is a requirement rather than a choice:
   * `Announcer`'s rule 1 is that a region which mounts WITH its text is silent, and the sheet mounts
   * the region and resets the query in the same commit. A count here would also be the first thing
   * to violate U0's own "mounted before any text" test.
   */
  statusEmpty: '',
  /**
   * ⚠️ **The terminal period is part of the shape, not punctuation taste.** Panel 2 · 2 decided
   * `{count}. {reason}`; without it a screen reader reads "1 match Already in the list as Pull-Up"
   * as one breathless clause. Every count SENTENCE ends in one (`statusCount`, `statusNoMatches`,
   * `statusNone`); `statusNear` and `statusSomeWords` are fragments that `statusNone` joins.
   */
  /**
   * ⚠️ **The `one` form interpolates `${n}` rather than writing `1`.** `one` is not "the number one"
   * — in Russian, Ukrainian and Croatian it is the category for 21, 31, 101, … , so a hardcoded
   * digit renders "1 match." for twenty-one matches the moment a locale lands. Every `one` form in
   * this file carries the count for that reason; in English the two are indistinguishable, which is
   * precisely why it has to be a rule rather than a thing noticed later.
   */
  statusCount: (n: number) => plural(n, { one: `${n} match.`, other: `${n} matches.` }),
  statusNoMatches,
  statusSomeWords,
  statusNear,
  /**
   * The status with no matches (CAT-3 P5): "No matches." once, then each list's own count, close
   * spellings first, each only when it holds a row: "No matches. 1 close spelling, 2 with some of
   * your words." (the accepted prototype's sentence).
   */
  statusNone: (near: number, someWords: number) => {
    const parts = [
      near > 0 ? statusNear(near) : null,
      someWords > 0 ? statusSomeWords(someWords) : null,
    ].filter(Boolean);
    return parts.length === 0 ? statusNoMatches : `${statusNoMatches} ${parts.join(', ')}.`;
  },
  /** The ONE reason, when "use as typed" is unavailable because the movement is already listed. */
  statusAlreadyListed: (name: string) => `Already in the list as ${name}.`,
  /** The same, for a hit the filters would hide (P8; the prototype's words). */
  statusAlreadyListedOutside: (name: string) =>
    `Already in the list as ${name}, which is not in your filters.`,

  // ── The footer ──────────────────────────────────────────────────────────────────────────────────
  /**
   * ⚠️ **Named `asTyped`, not `useAsTyped`.** The UI text is 'Use "…" as typed', but a key beginning
   * `use` is read by `react-hooks/rules-of-hooks` as a React hook, and calling it inside a
   * conditional branch — which is exactly where the footer calls it — is a lint error. Caught by
   * the linter on the component's first build.
   */
  asTyped: (name: string) => `Add ${quote(name)} as a new movement`,
  /**
   * 🔴 **The permanence warning, and every word of it is load-bearing** (UX3 4). A household movement
   * is visible to everyone in the household, and nothing in the app can delete it — not until
   * `V1-9b` makes hiding the last entry that references it the recovery. So the hint says what it
   * costs and asks for the one check that prevents it.
   *
   * ⚠️ **No "you can rename it later" until `C4r`.** `MOV-1` is the PR that makes that true and the
   * PR that edits this string; promising it now would be the app telling someone a recovery exists
   * when it does not.
   */
  asTypedHint: asTypedHintText,

  similarListed,
  /** Single mode's footer hint while a similar name is listed: the name, then the warning. */
  asTypedHintNear: (similar: string, typed: string) =>
    `${similarListed(similar, 'above')} ${asTypedHintText(typed)}`,

  // ── The card, and the Save line (PR 4 renders these; the strings live here) ─────────────────────
  /** The Movement field's button when no movement is chosen yet. */
  cardEmpty: 'Choose a movement',
  /** Survives on the card until Save, for a movement this session is about to create. */
  cardCreatedHint: "New movement — saved for your household when you log. It can't be deleted.",
  /**
   * Joins the Save summary when any card carries a created movement (UX3 3). Named quantities and
   * the quoted names, because "1 new movement" without the name is not a spelling check.
   *
   * ⚠️ **No names ⇒ `''`**, the same empty as `statusEmpty`, so PR 4's caller can interpolate it
   * unconditionally. Without the guard it rendered "Saving adds 0 new movements: . Check the
   * spelling." — a sentence about nothing, with a hole in it, on every ordinary save.
   */
  saveCreates: (names: readonly string[]) =>
    names.length === 0
      ? ''
      : `Saving adds ${plural(names.length, {
          one: `${names.length} new movement`,
          other: `${names.length} new movements`,
          // ⚠️ `.join(', ')` was the first draft and is a localization bug of its own — the
          // separator, the conjunction and the serial comma are all locale-specific (Arabic
          // joins with و).
        })}: ${formatList(names.map((n) => quote(n)))}. Check the spelling.`,
} as const;
