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
 * ⚠️ **This exists because the pattern already drifted.** `life-form.tsx` renders
 * `"{label} · logged today"` and `e2e/steps.ts` asserts a **re-typed copy** of that same string —
 * the exact thing AGENTS.md's "tests use the same constant as the app" rule forbids. Check-ins spell
 * it a third way ("Already logged today"). V1-24 adds four more surfaces, so the strings get a home
 * before they multiply rather than after.
 *
 * `lib/constants.ts` and not `packages/shared`: this is app-only copy with no DB or engine consumer,
 * and this module is deliberately dependency-free so a `'use client'` component can import it.
 */
export const SAVED_STATE_COPY = {
  /** The visible label on the amend control. The ACCESSIBLE name is longer — see `changeLabel`. */
  change: 'Change',
  /** Why a receipt carries no Change control on a day outside the ±1 write window (V1-15). */
  dayClosed: 'Logging is closed for this day.',
  /**
   * Why a receipt carries no Change control **yet** (V1-24 PR 1a).
   *
   * ⚠️ Deliberately states the limitation instead of implying finality. The whole design rests on
   * "complete" meaning *saved*, not *done* — so a receipt that silently offered no way back would be
   * the inert-and-uncorrectable lie this row exists to remove, just on a new surface. PR 1b ships the
   * amend and **deletes this string**; if it is still here after 1b, that is the bug.
   */
  notYetAmendable: 'Saved. Changing a logged weight is coming next.',
} as const;

/**
 * The accessible name for an amend control — `Change bodyweight — 84.5 lb`.
 *
 * A FUNCTION, not a string, because by V1-24 PR 3 there are several of these on one screen and six
 * buttons all named "Change" are indistinguishable in a screen-reader forms list. The visible text
 * (`Change`) is a prefix of the accessible name, satisfying WCAG 2.5.3 Label in Name — the same rule
 * the Sub-failure and load-mode controls already follow.
 *
 * The a11y spec asserts through this function rather than a re-typed literal, so the two cannot drift.
 */
export function changeLabel(subject: string, value: string): string {
  return `${SAVED_STATE_COPY.change} ${subject} — ${value}`;
}
