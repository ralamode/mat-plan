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
export const BODYWEIGHT_VALUE_JOINER = ', ';

/**
 * The weigh-in surface's copy (V1-24 PR 1a) — the plan's §"The 1a receipt, exactly" strings, verbatim.
 *
 * 1a ships the receipt BEFORE amend exists, and what makes that honest is this copy, so it is
 * specified rather than improvised. Every string here is asserted by a spec through this object.
 */
export const BODYWEIGHT_COPY = {
  /** The section heading in EVERY state — a noun that is true over a form, a receipt, or nothing. */
  heading: 'Bodyweight',
  /** One saved value: `Saved: 84.5 lb`. */
  saved: (value: string) => `Saved: ${value}`,
  /**
   * More than one live row (the pre-1c duplicates, or a two-phone race): `2 weights logged: 84.5 lb,
   * 845 lb`. The receipt never silently picks one — a hidden duplicate is uncorrectable twice over.
   */
  several: (values: readonly string[]) =>
    `${values.length} weights logged: ${values.join(BODYWEIGHT_VALUE_JOINER)}`,
  /**
   * The ONE line under a duplicates headline, replacing `onePerDay` and `recovery` (round 2 on #180).
   * The commonest duplicate is the same value twice from a double submit, where "One weigh-in per
   * day." reads as a contradiction and "Wrong number?" asks about a number that is right — what the
   * parent actually has to do is remove the extra row(s).
   */
  duplicates: (count: number) =>
    count === 2
      ? 'Logged twice — ask a parent to remove the extra.'
      : `Logged ${count} times — ask a parent to remove the extras.`,
  /** Why there is no form on a day that has a weight — a hidden form with no reason reads as broken. */
  onePerDay: 'One weigh-in per day.',
  /**
   * The real recovery path for a typo: a parent runs `db:correct` (docs/runbooks.md).
   *
   * ⚠️ PR 1b ships the amend and **deletes this line**; if it still renders after 1b, that is the bug.
   * It deliberately does NOT say "coming next": that was a promise 1a cannot keep, since nothing in 1a
   * can change the value. (1b's amend itself has NO day bound — plan Decision 5 — so once it ships this
   * line has no job on any day, open or closed.)
   */
  recovery: 'Wrong number? Ask a parent — it can’t be changed in the app yet.',
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
