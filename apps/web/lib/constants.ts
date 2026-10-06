import {
  isMassUnit,
  LOGGABLE_DIMENSION_NOUNS,
  type Unit,
  UNIT_DIMENSION,
  UNIT_DIMENSION_BY_CODE,
  type UnitDimension,
  UNIT_LABELS,
} from '@mat-plan/shared';

/**
 * App-only, cross-feature constants. **Zero dependencies** — kept import-free (like
 * `lib/access-gate.ts`) so it is safe to import from a `'use client'` component or the
 * Edge without dragging server/`zod` code into the client bundle. Named here so a value
 * that must stay in sync across files (a cookie name, the tz default) can't drift.
 */

/** Non-httpOnly cookie the client writes with its detected IANA timezone (V1-6c). The tz
 *  carries no secret, so a client `document.cookie` write is correct — see the tz-sync
 *  component. The RSC reads + IANA-validates it before use. */
export const TZ_COOKIE_NAME = 'tz';

/**
 * The active IANA timezone used before the client has reported one (first paint / cookie
 * absent). The household is Pacific, so the real users' first render is already correct and
 * a traveler self-heals via one `router.refresh()`. App-local for now; when a
 * `households.timezone` override lands this becomes a fallback and likely promotes to
 * `@mat-plan/shared` (one definition feeding app validation + the DB seed).
 */
export const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

/**
 * The app's home: the profile picker (OSS-2). `/` is the PUBLIC landing, so every "back to the app"
 * link, post-login default and spec that means "the picker" uses this, never a bare `'/'`.
 *
 * ⚠️ Branch-specific under HH-1. If household addressing lands in the path, home becomes
 * `/<household-id>`, which the proxy cannot compute (it has env and a cookie, no DB and no session).
 * The next author must then DELETE the proxy's `/` → home rule and resolve home in a page that can check
 * membership — not teach the proxy, which is the proxy-as-authorization mistake (CVE-2025-29927).
 */
export const APP_HOME_PATH = '/p';

/** The profile picker's copy — one source for the page and the specs that land on it. */
export const PICKER_COPY = {
  heading: 'Who’s logging today?',
  subhead: 'Pick a profile to start logging.',
} as const;

/** The product name: the tab title, the landing's `<h1>` and the gate's. */
export const APP_NAME = 'mat-plan';

/** The public source repository: `owner/name`, as the GitHub API wants it (screenshot publishing). */
export const GITHUB_REPO = 'ralamode/mat-plan';
/** …and as a page, linked from the landing. */
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;

/**
 * The public landing's copy (OSS-2 §A). Rule from the plan: no claim whose truth depends on repo state
 * (no counts, dates, "currently", "next", "until", roadmap) and no security adjective.
 */
export const LANDING_COPY = {
  lead: 'Strength-and-conditioning logging for a parent coaching their own kids.',
  origin: 'I built it to replace the trainer I was paying to write my kids’ programming.',
  sourceCta: 'See how it’s built on GitHub',
  /** The README's own curated section, so a phone reader skips GitHub's file tree. */
  sourceAnchor: '#whats-interesting-here',
  gateCta: 'Household sign-in',
} as const;

/** The gate page's copy. "Private preview." was dropped at OSS-2: the gate is now screen two of a
 *  public flow, and "preview" promised a timeline the landing deliberately doesn't. */
export const GATE_COPY = {
  subhead: 'Enter the household access code to continue.',
  /** The way back out — the one room a stranger can walk into needs an exit. The page draws a
   *  decorative `←` before it, hidden from screen readers so the link isn't "leftwards arrow, About…". */
  back: `About ${APP_NAME}`,
  /** A wrong code. */
  incorrect: 'Incorrect access code.',
} as const;

/** The routine editor's copy — the e2e replays its Save, so the label has one home. */
export const ROUTINE_COPY = {
  orderHeading: 'Routine order',
  save: 'Save routine',
} as const;

/** Cookie lifetime (seconds) — 1 year. Shared by the access-gate cookie and the tz cookie. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The project's minimum tap-target size in CSS px (AGENTS.md: "≥44px tap targets" — the kids log on a
 * phone on the gym floor). This is the TEST-SIDE mirror of the `min-h-11` in `buttonVariants`' base and
 * the `h-11` in `INPUT_CLASS`: Tailwind classes are what actually drive the CSS, so this const does NOT
 * single-source the value — the only thing binding the two is `e2e/a11y.spec.ts`, which asserts every
 * rendered control clears this height. Changing one without the other makes that spec fail, which is the
 * point.
 */
export const MIN_TAP_TARGET_PX = 44;

/**
 * The shared text/number `<input>` styling — the single source for the app's form fields (the
 * bodyweight, strength, check-in, and V1-9 edit-set inputs), so the ≥44px height (`h-11`), focus ring,
 * and invalid-border tokens can't drift between forms. Callers append width utilities as needed
 * (e.g. `${INPUT_CLASS} w-24`). Extracted from the three form-local copies it used to be duplicated in.
 */
export const INPUT_CLASS =
  'border-input bg-background focus-visible:ring-ring h-11 rounded-lg border px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

/**
 * The saved-state copy (V1-24 PR 1a) — one definition shared by the components and the specs.
 *
 * ⚠️ **This exists because the pattern already drifted.** `life-form.tsx` rendered
 * `"{label} · logged today"` and `e2e/steps.ts` asserted a **re-typed copy** of that same string —
 * the exact thing AGENTS.md's "tests use the same constant as the app" rule forbids. V1-24 adds more
 * saved surfaces, so the strings get a home before they multiply rather than after.
 *
 * `lib/constants.ts` and not `packages/shared`: this is app-only copy with no DB or engine consumer,
 * and this module is deliberately dependency-free so a `'use client'` component can import it.
 */
export const SAVED_STATE_COPY = {
  /** A one-tap Life activity once it is logged (`life-form.tsx`, V1-7). */
  lifeLogged: (label: string) => `${label} · logged today`,
  /** A log-once check-in field once it is logged (`checkin-form.tsx`). */
  checkinLogged: 'Already logged today',
} as const;

/** Joins several logged values in the receipt and the announcement (`84.5 lb, 845 lb`). */
export const VALUE_JOINER = ', ';

/**
 * The weigh-in surface's copy (V1-24 PR 1a) — the plan's §"The 1a receipt, exactly" strings, verbatim.
 *
 * 1a ships the receipt BEFORE amend exists, and what makes that honest is this copy, so it is
 * specified rather than improvised. Every string here is asserted by a spec through this object.
 */
export const BODYWEIGHT_COPY = {
  /** A second weigh-in refused by V1-24 1d's one-per-day index (two phones, or a stale tab). The
   *  page revalidates on refresh and shows the one that landed; the amend corrects its value. */
  dayTaken: 'A weight is already logged for this day.',
  /** The section heading in EVERY state — a noun that is true over a form, a receipt, or nothing. */
  heading: 'Bodyweight',
  /** One saved value: `Saved: 84.5 lb`. */
  saved: (value: string) => `Saved: ${value}`,
  /**
   * More than one live row (the pre-1c duplicates, or a two-phone race): `2 weights logged: 84.5 lb,
   * 845 lb`. The receipt never silently picks one — a hidden duplicate is uncorrectable twice over.
   */
  several: (values: readonly string[]) =>
    `${values.length} weights logged: ${values.join(VALUE_JOINER)}`,
  /**
   * The ONE line under a duplicates headline, replacing `onePerDay` (rounds 2–3 on
   * #180). Two different situations, so two different asks:
   * - **All the same value** (a double submit): the extra row(s) are the problem.
   * - **Different values** (e.g. two phones): someone has to decide which weight is right, and
   *   "remove the extra" would invite a guess that corrupts the trend.
   * Both say it **can’t be fixed in the app yet**, so a parent doesn't hunt for a delete control that
   * doesn't exist; the fix is `db:correct` until 1b/1c.
   */
  duplicates: (values: readonly string[]) => {
    const n = values.length;
    if (new Set(values).size === 1) {
      return n === 2
        ? 'Logged twice — the extra can’t be removed in the app yet; ask a parent.'
        : `Logged ${n} times — the extras can’t be removed in the app yet; ask a parent.`;
    }
    return 'The weights differ — ask a parent which is right; it can’t be fixed in the app yet.';
  },
  /** Why there is no form on a day that has a weight — a hidden form with no reason reads as broken. */
  onePerDay: 'One weigh-in per day.',
  /** A closed day with nothing logged — otherwise the section is a bare heading. */
  noneOnClosedDay: 'No weight logged.',
  /** What the status region announces on a save — the FACT, with the value (acceptance 6). */
  announced: (value: string) => `Bodyweight saved: ${value}.`,
} as const;

/**
 * The receipt's element id — the focus target after a save (`SavedAnnouncer`), and what the e2e
 * asserts focus landed on. One id: a page renders one weigh-in section.
 */
export const BODYWEIGHT_RECEIPT_ID = 'bodyweight-receipt';

/**
 * The accessible name for an amend control — `Change weight — 84.5 lb` (V1-24 PR 1b).
 *
 * A FUNCTION, not a string. By PR 3 several of these share a screen, and six buttons all named
 * "Change" are indistinguishable in a screen-reader forms list. The visible text (`Change`) is a
 * PREFIX of the accessible name, satisfying WCAG 2.5.3 Label in Name — the rule the load-mode and
 * Sub-failure controls already follow. The specs assert through this function, never a re-typed
 * literal, which is the `life-form.tsx` / `e2e/steps.ts` drift it exists to prevent.
 */
export function changeLabel(subject: string, value: string): string {
  return `${AMEND_COPY.change} ${subject} — ${value}`;
}

/** The amend interaction's copy (V1-24 PR 1b), shared by the island and the specs. */
export const AMEND_COPY = {
  /** The visible control. **"Change", not "Edit"** — plainer for an eight-year-old. Both amends use it
   *  (the weigh-in since 1b, a strength set since 3a-i); PR 2 extracts the shared primitive. */
  change: 'Change',
  save: 'Save',
  cancel: 'Cancel',
  /** The amend input's accessible name. The unit is in it because the visible unit is a sibling
   *  `<span>` a screen reader would otherwise never pair with the number. */
  valueLabel: (unit: string) => `Weight (${unit})`,
  /** A strength set's save, announced by its own island — the subject names WHICH set (3a-i). */
  setChanged: (subject: string, value: string) => `${subject} changed: ${value}.`,
  /**
   * Why a set can't be changed (V1-24 3a-i, the parent plan's Locked state), keyed by `lockedReason`.
   * Each is TRUE for the sets it labels; "yet" appears only where a backlog row will change it
   * (V1-33: time and distance). `status` has no sentence of its own: the badge already says it.
   */
  locked: {
    mode: 'Bodyweight and band sets can’t be changed in the app.',
    notMass: 'Timed and distance sets can’t be changed in the app yet.',
    status: '',
    shape: 'Some sets here can’t be changed in the app.',
  },
  /** A Locked sentence that names its movements first ("Pull-Up: Bodyweight and band sets …"), so
   *  the names attach to the sets, not to "the app". */
  lockedFor: (names: string, sentence: string) => `${names}: ${sentence}`,
  /** Ends every Locked line. With no delete action, re-logging is the move that makes it permanent. */
  lockedRecovery: 'Wrong? Don’t log it again — tell a parent so they can fix it.',
} as const;

/**
 * The word a dimension's primary number goes by IN THE FIELD — the placeholder and the accessible
 * name. A third per-dimension map beside `LOGGABLE_DIMENSION_LABELS` (the Measuring option) and
 * `LOGGABLE_DIMENSION_NOUNS` (running copy), because each serves a different surface and respelling
 * one must not garble the others.
 *
 * `length`, not `distance` or `height`: the dimension covers a box-jump HEIGHT and a broad-jump
 * DISTANCE, so either alone mislabels the main length movement, and it must not contradict the blank
 * copy "Enter the height or distance." It also has to fit the `w-24` field (~52px) — the row is
 * ≈ 275 of ≈ 294px at 360px.
 *
 * `constants.test.ts` requires a word for every loggable dimension, so adding one without a word
 * fails rather than silently falling back.
 */
export const QUANTITY_FIELD_WORD: Partial<Record<UnitDimension, string>> = {
  mass: 'weight',
  length: 'length',
  time: 'time',
};

/**
 * A set's number-input accessible name — one source for the field and every spec that finds it.
 *
 * MASS IS BYTE-IDENTICAL to the old `weightInputLabel` ("… weight in lb"), so every existing mass
 * locator holds; a missed one fails loudly rather than drifting. Non-mass spells the unit out
 * ("time in seconds", "length in inches") because `sec` and `in` read as nothing aloud.
 */
export function quantityInputLabel(subject: string, unit?: Unit): string {
  if (!unit) return `${subject} weight`;
  const word = QUANTITY_FIELD_WORD[UNIT_DIMENSION_BY_CODE[unit]] ?? 'weight';
  if (UNIT_DIMENSION_BY_CODE[unit] === UNIT_DIMENSION.mass) return `${subject} weight in ${unit}`;
  return `${subject} ${word} in ${UNIT_LABELS[unit].toLowerCase()}`;
}

/**
 * The advisory sentence when the catalog's declared dimension differs from the chosen Measuring, and
 * (V1-26 PR-A) when a declared-loaded movement is logged BW. ONE function, so the two surfaces cannot
 * word the same warning two ways — V1-26's sentence is the `mass` branch, verbatim.
 *
 * A WARNING, never a lockout: the catalog's declaration is a normal case, not a rule, and an athlete
 * doing bodyweight KB swings is allowed to be right.
 */
export function usuallyLoggedAs(movementName: string, dimension: UnitDimension): string {
  const noun = LOGGABLE_DIMENSION_NOUNS[dimension];
  if (dimension === UNIT_DIMENSION.mass) return `${movementName} is usually logged with a weight.`;
  return `${movementName} is usually logged as a ${noun ?? 'number'}.`;
}

/**
 * The strength section's copy (V1-24 3a-ii). The h2 stays "Log strength" until 3b renames it to the
 * noun "Strength" (agreed; deferred for size), so `heading` is the CURRENT text the specs assert.
 */
export const STRENGTH_COPY = {
  heading: 'Log strength',
  submit: 'Log strength',
  submitting: 'Logging…',
  logMore: 'Log more strength',
  /** The open toggle. "Close", not "Cancel": closing KEEPS the typed draft (it is hidden, not reset). */
  close: 'Close',
  /** The opened form's group name — distinct from the h2 and the submit, which share "Log strength". */
  group: 'New strength session',
  /** The trust guard while "Log more" is open. "For this day", not "today": yesterday is writable too. */
  alreadySaved: (names: string) => `Already saved for this day: ${names}.`,
  newSession: 'Adds a new session.',
  saved: 'Saved',
  /** The island's announcement on its OWN save. Leads with the receipt's heading, so a second session
   *  with the same movements is still a text change, and so it names the receipt focus lands on. */
  announced: (heading: string, names: string) => `${heading} saved: ${names}.`,
  skippedSuffix: '(skipped)',
} as const;

/** "1 movement" / "3 movements": the one spelling, shared by the receipt and `strengthSummary`. */
export const movementCount = (n: number) => `${n} ${n === 1 ? 'movement' : 'movements'}`;
export const skippedCount = (n: number) => `${n} skipped`;

/** A session receipt's id in the strength section — the focus target after its save. The prefix is
 *  exported so a locator can find "any receipt" without re-typing it. */
export const STRENGTH_RECEIPT_ID_PREFIX = 'strength-receipt-';
export const strengthReceiptId = (sessionPublicId: string) =>
  `${STRENGTH_RECEIPT_ID_PREFIX}${sessionPublicId}`;

/** A strength set amend's error id, unique per island (20 sets must not share one id). */
export const setAmendErrorId = (setPublicId: string) => `set-amend-error-${setPublicId}`;

/**
 * The notice on a day outside the write window (V1-15). Since V1-24 PR 1b a logged weight CAN be
 * corrected there, so "you can still see what was logged" alone read as view-only directly above a
 * working Change button. It now says what is closed (new entries) and what is still allowed.
 */
export const CLOSED_DAY_NOTICE =
  'New entries are closed for this day — it’s more than a day ago. You can still see what was logged and correct a weigh-in or a strength set.';

/** The pending label on every Save button (amend islands and the routine editor). */
export const SAVING_LABEL = 'Saving…';

/**
 * Typed-error copy shared by every amend path (V1-24 PR 1b).
 *
 * `editStrengthSetAction` had `'That set could not be found.'` inline; a second amend surface would
 * have re-worded the same failure. One place, so the two cannot answer it differently.
 */
export const AMEND_ERROR_COPY = {
  /**
   * The row is gone, was never theirs, or is not amendable. ONE message for all three **on purpose**:
   * a crafted cross-profile id must learn nothing a stale id wouldn't. The action revalidates first,
   * so "what's saved" is true and the kid has a way forward that isn't tapping Save again.
   */
  notFound: (subject: string) =>
    `That ${subject} could not be found — the page now shows what's saved.`,
  /**
   * Someone amended it under this render. It states what the system DID — the page has revalidated,
   * so the value on screen is already the one that won — because "reload the day" names a control
   * that does not exist, and a kid mid-session would simply tap Save again.
   */
  staleWrite: 'That was changed on another device — the latest is showing now.',
} as const;

/**
 * V1-27 — the strength form's partial-set copy. The plan (`docs/plans/v1-27-partial-sets.md`) explains
 * each: the summary line is the real mitigation for dropping trailing empty sets, the hint is the local
 * cue on a mixed card, and the missing-field message names the way out of a block.
 */
export const PARTIAL_SETS_COPY = {
  /** After **Add set** on a card with touched sets and a trailing empty run. "At the end" because a gap
   *  card has a trailing run too, and its gap row still blocks. */
  trailingHint: "Empty sets at the end won't be logged.",
  /** Custom validity of a required, blank REPS input (log form only) when the card has a per-set
   *  Remove button — it renders only when the movement has more than one set. */
  missingReps: "Fill in the reps, or tap Remove if you didn't do this set.",
  /** …and on a one-set card, which has no per-set Remove to point at. */
  missingRepsOnly: 'Fill in the reps for this set.',
  /** Custom validity of a required, blank WEIGHT input on a MASS unit. Points at BW / band, the real way
   *  out for a set done with no weight — "if you didn't do it" would be false, and typing `0` records a
   *  fake load. Use `missingQuantityMessage(unit)`, which also covers time and distance. */
  missingWeight: "Enter the weight, or tap BW or band if there wasn't one.",
  /** The summary line when nothing would be logged (including a payload of only skipped movements). */
  empty: 'Nothing to log yet.',
} as const;

/**
 * The blank-quantity bubble for a set's number field, by unit. BW / band are modes of a WEIGHT (V1-30
 * refuses them on time and distance), so only a mass unit points at them; a time or distance asks for
 * the number, with the same noun the server's refusal uses (`LOGGABLE_DIMENSION_NOUNS`).
 */
export function missingQuantityMessage(unit: Unit): string {
  if (isMassUnit(unit)) return PARTIAL_SETS_COPY.missingWeight;
  return `Enter the ${LOGGABLE_DIMENSION_NOUNS[UNIT_DIMENSION_BY_CODE[unit]] ?? 'measurement'}.`;
}

/** Longest movement name the blocked summary quotes before truncating — keeps the line on one row at
 *  360px (~44 chars × ~7px ≈ 308px of the ~328px usable). */
export const SUMMARY_NAME_MAX = 20;

/**
 * The summary line when the browser would refuse the tap, naming the FIRST blocker so a kid knows
 * where to look — on a phone it can be several cards up the page. `index` is the on-screen card
 * number (0-based), `setIndex` the on-screen set number (0-based).
 */
export function blockedSummary(
  blocker:
    | { kind: 'name'; index: number }
    | { kind: 'set'; index: number; setIndex: number; movementName: string },
): string {
  if (blocker.kind === 'name') return `Movement ${blocker.index + 1} needs a name.`;
  const name = blocker.movementName.trim();
  const label =
    name === ''
      ? `Movement ${blocker.index + 1}`
      : name.length > SUMMARY_NAME_MAX
        ? `${name.slice(0, SUMMARY_NAME_MAX - 1).trimEnd()}…`
        : name;
  return `${label} set ${blocker.setIndex + 1} needs finishing.`;
}

/**
 * The line above **Log strength**: what the tap will log, from the exact post-drop payload. A skipped
 * movement is sent with `sets: []` and is not "logged", so it is counted separately.
 */
export function strengthSummary(movements: number, sets: number, skipped: number): string {
  if (movements === 0) return PARTIAL_SETS_COPY.empty;
  const m = movementCount(movements);
  const s = `${sets} ${sets === 1 ? 'set' : 'sets'}`;
  return `Logs ${m}, ${s}${skipped > 0 ? `, ${skippedCount(skipped)}` : ''}.`;
}
