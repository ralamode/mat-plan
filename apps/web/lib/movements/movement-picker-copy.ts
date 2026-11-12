import { MOVEMENT_PICKER_GROUP_LABELS, type MovementPickerGroup } from '@mat-plan/shared';

import { formatList, plural, quote } from '@/lib/i18n/plural';

/**
 * Every string the movement picker shows — the picker itself, the card hint, the Save line and the
 * footer's guard copy (PICK-1 Decision 8, reuse S4).
 *
 * 🔴 **Its own module, NOT `lib/constants.ts`.** `AUTH-1` 1c edits that file, and a whole feature's
 * copy landing in it is a guaranteed conflict for no benefit. ⚠️ `MOV-1`'s plan cites
 * `movement-copy.ts` for the rename surface's strings (`mov-1-rename-movement.md`); whichever of the
 * two ships second renames, so there is one movement-copy module and not two.
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
  todaysProgramAllOnForm: "Today's program (already on your form)",
  household: 'Your household',
  matches: 'Matches',
  someWords: 'Matches some of your words',
  groupLabel: (group: MovementPickerGroup) => MOVEMENT_PICKER_GROUP_LABELS[group],

  // ── Row tags, one per row by precedence (UX2 S2, UX3 4, UX1 8) ──────────────────────────────────
  tagAlreadyIn: (label: string) => `already in ${label}`,
  /** Only on an alias HIT, naming the alias that hit — panel round 2, gap 5. */
  tagAlsoCalled: (alias: string) => `also called ${alias}`,
  tagCurrent: 'current',
  tagHousehold: 'household',

  // ── The status region (criterion 46), as ONE shape: `{count}. {reason}` ─────────────────────────
  /**
   * 🔴 **The empty query announces NOTHING**, and that is a requirement rather than a choice:
   * `Announcer`'s rule 1 is that a region which mounts WITH its text is silent, and the sheet mounts
   * the region and resets the query in the same commit. A count here would also be the first thing
   * to violate U0's own "mounted before any text" test.
   */
  statusEmpty: '',
  statusCount: (n: number) => plural(n, { one: '1 match', other: `${n} matches` }),
  statusNoMatches: 'No matches.',
  /**
   * ⚠️ The noun is **"movement"**, not "match". The first draft read `${n} match` + `es`, which
   * collapsed to the same string for every `n` AND announced "1 matches some of your words" — a
   * ternary that looked like it handled the singular and did not. Through `plural()` now, so the
   * forms are named categories rather than a comparison, and a locale with more of them adds keys
   * here instead of needing this sentence rewritten.
   */
  statusSomeWords: (n: number) =>
    `No matches. ${plural(n, {
      one: '1 movement matches',
      other: `${n} movements match`,
    })} some of your words.`,
  /** The ONE reason, when "use as typed" is unavailable because the movement is already listed. */
  statusAlreadyListed: (name: string) => `Already in the list as ${name}.`,

  // ── The footer ──────────────────────────────────────────────────────────────────────────────────
  /**
   * ⚠️ **Named `asTyped`, not `useAsTyped`.** The UI text is 'Use "…" as typed', but a key beginning
   * `use` is read by `react-hooks/rules-of-hooks` as a React hook, and calling it inside a
   * conditional branch — which is exactly where the footer calls it — is a lint error. Caught by
   * the linter on the component's first build.
   */
  asTyped: (name: string) => `Use "${name}" as typed`,
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
  asTypedHint: (name: string) =>
    `Adds "${name}" to the list for everyone in your household. It can't be deleted, so check the spelling.`,

  // ── The card, and the Save line (PR 4 renders these; the strings live here) ─────────────────────
  /** The Movement field's button when no movement is chosen yet. */
  cardEmpty: 'Choose a movement',
  /** Survives on the card until Save, for a movement this session is about to create. */
  cardCreatedHint: "New movement — saved for your household when you log. It can't be deleted.",
  /**
   * Joins the Save summary when any card carries a created movement (UX3 3). Named quantities and
   * the quoted names, because "1 new movement" without the name is not a spelling check.
   */
  saveCreates: (names: readonly string[]) =>
    `Saving adds ${plural(names.length, {
      one: '1 new movement',
      other: `${names.length} new movements`,
      // ⚠️ `.join(', ')` was the first draft and is a localization bug of its own — the separator,
      // the conjunction and the serial comma are all locale-specific (Arabic joins with و).
    })}: ${formatList(names.map((n) => quote(n)))}. Check the spelling.`,
} as const;
