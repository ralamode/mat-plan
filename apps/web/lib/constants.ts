import {
  ACTIVITY_TYPE_KEYS,
  type DayClearRefusal,
  MAX_HOUSEHOLD_ATHLETES,
  PRACTICE_MINUTES_MAX,
  PRACTICE_MINUTES_MIN,
  type PracticeMinutesProblem,
} from '@mat-plan/shared';

import type { RestoreDeadline } from './entries/restore-deadline';
import { formatList, plural } from './i18n/plural';
import { LIFE_ACTIVITIES } from './life/life-activities';

/**
 * App-only, cross-feature constants. **No server or IO dependencies** — only pure modules
 * (`@mat-plan/shared`, `./i18n/plural`, `./life/life-activities`) — so it is safe to import from a `'use client'` component, from the Edge proxy, and
 * from `lib/access-gate.ts` (which takes `PRIVACY_PATH` from here) without dragging server code into
 * the client bundle. Named here so a value that must stay in sync across files (a cookie name, the
 * tz default, a published URL) can't drift.
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
 * Home must then be resolved in a page that can check membership — never taught to the proxy, which
 * is the proxy-as-authorization mistake (CVE-2025-29927). ✅ Half of that is already paid: the
 * proxy's `/` → home forward was deleted at AUTH-1 1c-3b (it looped once the pages required a
 * session), so there is no longer a rule to remove first.
 */
export const APP_HOME_PATH = '/p';

/**
 * The per-athlete routes, built from `APP_HOME_PATH` so there is one definition of where `/p` is
 * (PROF-1 D8). Helpers rather than template literals at the call site: `/p/${id}` was written out in
 * nine places across the day page, the tile, the routine editor and four specs, which is how one of
 * them ends up pointing at a route that moved.
 *
 * ⚠️ **`athletePath` takes a PUBLIC id (UUIDv7)** — the only id the UI and URLs ever see. An internal
 * `bigint` must never reach a path.
 */
export const athletePath = (publicId: string) => `${APP_HOME_PATH}/${publicId}`;
/** The rename screen (PROF-1 a-r). `/p/<id>/edit`, the approved prototype's own path. */
export const athleteEditPath = (publicId: string) => `${athletePath(publicId)}/edit`;
/** The CSV zip (V1-13b) — a Route Handler, fetched by a plain `<a download>`, never `<Link>`. */
export const athleteExportPath = (publicId: string) => `${athletePath(publicId)}/export`;
/** The routine editor (V1-18). ⚠️ **UNLINKED since PROF-1 a-r** (criterion 11 / M30) — the route
 *  still renders and `e2e/a11y.spec.ts` still scans it, so the helper exists for the SPECS, not for
 *  a link. Nothing in `app/` or `components/` may use it until ACT-1 replaces that editor. */
export const athleteRoutinePath = (publicId: string) => `${athletePath(publicId)}/routine`;

/**
 * Household settings (PROF-1 b) — the one screen that lists archived athletes.
 *
 * A sibling of `/p`, not a child of it: it is household-scoped, not athlete-scoped, so a route
 * segment named by a profile id would be the wrong shape (the same argument that put
 * `profile-actions.ts` beside `[profileId]/actions.ts` rather than inside it).
 */
export const SETTINGS_PATH = '/settings';

/** Where an athlete is added (PROF-1 a-1). A sibling of `/p`: the form is household-scoped. */
export const ADD_ATHLETE_PATH = `${APP_HOME_PATH}/new`;

/**
 * The served privacy notice (PRIV-2) — `docs/privacy/notice.md`, compiled into `app/privacy/`.
 *
 * It lands HERE, beside `APP_HOME_PATH`, not in `lib/access-gate.ts`: that module is the one AUTH-1
 * splits and deletes, and `SIGN_IN_PATH` is settled the same way for the same reason. From here it
 * never moves — `lib/public-paths.ts` imports it for `PUBLIC_PATHS` and the footer links to it, and
 * the Clerk and Google consent screens are configured with this path, so it is a PUBLISHED URL.
 */
export const PRIVACY_PATH = '/privacy';

/**
 * Clerk's prebuilt sign-in (AUTH-1 1a) — the `app/sign-in/[[...rest]]/` catch-all segment, and the
 * root of the one subtree `lib/public-paths.ts` serves without a session.
 *
 * It lands HERE for the reason `PRIVACY_PATH` does: `lib/access-gate.ts` is the module 1a splits and
 * 1d deletes, so a route constant placed there would have to move twice.
 *
 * ⚠️ **This and `APP_HOME_PATH` feed `<ClerkProvider>`'s `signInUrl` /
 * `signInFallbackRedirectUrl` props** (`components/layout/clerk-root.tsx`) rather than a second copy in
 * `NEXT_PUBLIC_CLERK_SIGN_IN_URL`. Clerk reads those env vars when they are set, which is exactly how
 * the route would silently drift from this constant; passing props keeps one definition.
 */
export const SIGN_IN_PATH = '/sign-in';

/**
 * The request header `proxy.ts` sets to this request's CSP nonce, which the layouts read: the root
 * for the theme script, `ClerkRoot` for Clerk's scripts. One name, so the writer and the readers
 * cannot drift.
 *
 * ⚠️ **The value is not ours to change.** Clerk's `DynamicClerkScripts` reads the header itself, by its
 * literal name (`headers().get('X-Nonce')`), so renaming this would silently strip the nonce from
 * Clerk's scripts. `proxy.test.ts` pins the value.
 */
export const NONCE_HEADER = 'x-nonce';

/**
 * The `Referrer-Policy` every response carries (`proxy.ts`). **`same-origin`, never `no-referrer`.**
 * Under `no-referrer` every browser (per Fetch) sends a native form POST with `Origin: null`, even to this site, and
 * Next's Server Action CSRF check (origin host must equal host) then refuses it: a server-action form
 * tapped before the page hydrates did nothing (docs/plans/td-form-before-hydration.md). `same-origin`
 * still sends NO referrer to any other site, so no URL (a profile id, a day) leaves for a third
 * party, while no same-origin path relays to one (Clerk's relay stays disarmed; see `proxy.ts`).
 * `proxy.test.ts` pins the value.
 */
export const REFERRER_POLICY = 'same-origin';

/**
 * The token-set preview harness (UI-4, built to serve UI-3). Named here because the a11y spec and the
 * screenshot flow both land on it, and a route path re-typed in two places is how one of them ends up
 * pointing at nothing.
 *
 * ⚠️ **Temporary by design.** The UI-3 PR that picks a token set deletes `app/design/tokens/` and
 * this constant with it. A harness kept past its decision is a CI cost paid forever for a choice made
 * once.
 */
export const TOKEN_SETS_PATH = '/design/tokens';

/**
 * The **profile** picker's copy — one source for the page and the specs that land on it.
 *
 * ⚠️ Not the movement picker, whose strings are `lib/movements/movement-picker-copy.ts`. Two things
 * called "the picker" now exist; the name predates the other one, and a grep for `PICKER_COPY`
 * while working on the movement sheet lands here.
 */
export const PICKER_COPY = {
  heading: 'Who’s logging today?',
  /**
   * 🔴 **"Tap your name", not "Pick a profile" (PROF-1 a-r).** Two changes in one line, both from the
   * approved prototype (`docs/prototypes/crud-1/index.html:2083`):
   *   - **"Tap"** names the gesture on the device the screen is actually used on, which "Pick" does
   *     not — the kids log on a phone on the gym floor.
   *   - **"your name"** is the noun the person reading it uses. "Profile" is the schema's word; the
   *     `PICKER_EMPTY_COPY` family already made that switch and this is the surface it was about.
   */
  subhead: 'Tap your name to start logging.',
} as const;

/** The product name: the tab title and the landing's `<h1>`. */
export const APP_NAME = 'mat-plan';

/**
 * The shared class for a full-width CTA that may WRAP — the landing's two buttons and the picker's
 * first-run link (ONB-0).
 *
 * `buttonVariants`' base is `whitespace-nowrap`, and at 150–200% text size these labels are wider than
 * a 328px phone column, so an unwrapped one scrolls the page sideways (SC 1.4.4). `whitespace-normal`
 * lets the label wrap and `h-auto` lets the button grow with it — which does NOT cost the tap target,
 * because `min-h-11` lives in the button base and `min-h-*` / `h-*` are different tailwind-merge groups.
 *
 * Extracted here at ONB-0: it was declared locally in `app/page.tsx`, and the picker's first-run link is
 * the second screen needing the same escape hatch (AGENTS.md — the second occurrence is the trigger).
 */
export const CTA_CLASS = 'h-auto w-full py-2.5 text-center text-base whitespace-normal';

/**
 * The wrap rule for **every element that renders an athlete's name** (PROF-1 D11).
 *
 * 🔴 **`wrap-anywhere`, never `break-words`, and the difference is not cosmetic.** The two break
 * lines identically — but only `anywhere` lets the break count toward the element's `min-content`
 * width. So `break-words` does nothing wherever an element's width DERIVES from min-content, which
 * is exactly where the names live: the picker tile's label (a row-flex item beside a
 * `size-14 shrink-0` avatar), the "→ Edit {name}" link (`inline-flex w-fit`), and the day page's
 * program note. An unbroken 40-character name then pushes the row past a 360px phone's 328px of
 * usable width and the page scrolls sideways (SC 1.4.4).
 *
 * `min-w-0` is the other half: a flex item's default `min-width:auto` floors it at its content's
 * min-content size, so the wrap rule has no effect until the floor is lifted.
 *
 * **One constant, not nine copies.** Three PRs apply this to nine renderers; it already drifted once
 * (`strength-section.tsx` reached for `break-words` while citing this decision in its own comment).
 * AGENTS.md → "Constants, enums & shared values": the second occurrence is the trigger.
 *
 * ⚠️ Not applicable to an **anonymous** flex item (text directly inside a flex container has no
 * element to put a class on) — give it a wrapping `<span>` instead of settling for `break-words`.
 */
export const NAME_WRAP_CLASS = 'min-w-0 wrap-anywhere';

/**
 * The callout's choices. `Button` is `whitespace-nowrap` by default, so "Add another " plus a
 * 40-character name is ~364px against ~296px of callout at 360px — it overflows, and two of them side
 * by side break above ~12 characters. `h-auto whitespace-normal text-left` lets the label wrap
 * instead, and `min-w-0` stops an unbreakable token pushing the page sideways.
 *
 * Promoted out of `add-athlete-form.tsx` at a-1d-ren, its SECOND user — the rename callout needs the
 * same override. Every copy has to stay identical: the e2e measures `scrollWidth` at 360px on the
 * add form's LIVE branch only, so a drift anywhere else would go unmeasured.
 */
export const CHOICE_BUTTON_CLASS =
  'h-auto w-full min-w-0 py-2.5 text-left text-base whitespace-normal';

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
  /** Points at `SIGN_IN_PATH`. Was `gateCta` and pointed at `/gate` until AUTH-1 1d. */
  signInCta: 'Household sign-in',
} as const;

/**
 * The sign-in screen's copy (AUTH-1 1a, narrowed at 1d).
 *
 * `heading` names the MECHANISM rather than the product, and must not be a bare "Sign in":
 * `LANDING_COPY.signInCta` calls this "Household sign-in", so a screen saying "sign-in isn't
 * switched on" would contradict the button the reader tapped one screen earlier. Naming Google
 * separates them. ⚠️ It is the `<h1>` of the DARK state ONLY — when Clerk is configured the card
 * renders its own `<h1>` and this page deliberately yields rather than hiding the vendor's
 * (see `lib/clerk.ts`).
 *
 * `notYet` is the rest of the dark state. It leads with the state rather than an imperative (the
 * `BODYWEIGHT_COPY.duplicates` family — this comment used to cite
 * `PICKER_EMPTY_COPY.notYet`, which PROF-1 a-1u deleted once adding an athlete became possible) and
 * says "isn't switched on yet" — a configuration fact, so the
 * maintainer verifying a deploy can tell dark from broken — and asks the reader for nothing.
 * 🔴 **`codeStillWorks` and `gateCta` are DELETED at 1d, not reworded.** They pointed at `/gate`,
 * which was a real forward step while the access code was one of two requirements. After `1d` there
 * is no second requirement and no `/gate`, so the dark state's only exits are **the page's own mark
 * (home) and privacy link** — `SiteFooter` is suppressed on this subtree. ⚠️ An earlier draft of this
 * line said "the footer", which is exactly wrong on the one route where the footer is `null`.
 *
 * `processor` + `privacyLink` are the lit state only, and they are DISCLOSURE AT THE DECISION POINT:
 * the footer's "Privacy notice" link is chrome below a vendor card, Google's own consent screen
 * appears only AFTER the tap and is skipped for a returning account, and Clerk's "Secured by Clerk"
 * badge is a vendor's branding, not our disclosure. The link is labelled by what it ANSWERS rather
 * than by the document's title, which is also what keeps it distinct from the footer's.
 */
export const SIGN_IN_COPY = {
  heading: 'Sign in with Google',
  notYet: 'Signing in with Google isn’t switched on yet.',
  /**
   * 🔴 **The precondition, stated BEFORE the tap — lit state only (AUTH-1 1d).** It names the
   * SEQUENCING, which is what makes it actionable: Google's consent screen appears before this app
   * checks anything, so a stranger can stop before disclosing their address, name and picture.
   *
   * ⚠️ **It deliberately does NOT promise that an invitation is sufficient, because it is not.**
   * An invitation gets a Clerk account; a `household_members` row is what gets you a household, and
   * nothing under `apps/web` writes one. So an invited parent signing in before that row exists
   * lands on `NO_HOUSEHOLD_COPY` (`lib/dal/household.ts` names exactly this case) — `wrongAccount`
   * describes the membership-row mechanism, Clerk's sign-up mode describes this one, and after `1d`
   * "invitation" otherwise means two different gates on two screens with nothing linking them.
   * Copy must never claim a precondition the endpoint does not honour.
   *
   * Statement of fact: no imperative, and no "yet" — an uninvited account is never linked.
   * ⚠️ **No contact address here**, deliberately: `notice.md` carries one, this page is public, and the
   * privacy link reaches the notice in one tap. ⚠️ An earlier draft said this page is "(from `1d`)
   * indexed" — it is not; `/sign-in` sets `robots: noindex` permanently. It is **`/privacy`** that
   * became indexable at `1d`. Recorded so the next author reads neither the absence nor the indexing
   * claim as fact.
   */
  invitation:
    'Signing in needs an address this household has invited, and Google’s consent screen appears before that is checked.',
  /**
   * 🔴 **The waitlist disclosure, and it exists because the control it describes is NOT ours.**
   * Clerk's access mode is `Waitlist`, so its card renders "Want early access? Join waitlist" — and
   * that link **leaves this origin** for `accounts.mat-plan.dev/waitlist`, Clerk's hosted page. That
   * page asks for an email address and **carries no link to the privacy notice**, so a stranger
   * would otherwise disclose an address having been told nothing. This repo's own rule is to put the
   * fact next to the control; the control is a vendor's, so the fact has to sit above it.
   *
   * ⚠️ **COUPLED TO A DASHBOARD SETTING, which is the thing to know before editing.** It is true only
   * while the Clerk access mode is `Waitlist`. In `Invite-only` (`restricted`) there is no join link
   * and this sentence describes a control that is not on screen; in `Open` (`public`) the whole
   * invitation framing above is wrong too. Nothing in this repo can read that mode at runtime —
   * `clerkIsConfigured()` only knows whether keys exist — so **changing the mode means changing this
   * copy and `docs/privacy/notice.md` in the same breath.** `runbooks.md` carries the console path.
   */
  waitlist:
    'Asking for early access opens a page run by Clerk and leaves this app. It stores your email address with them; nothing else is asked for and no account is created.',
  /**
   * 🔴 **The CDN-failure state, and it exists because `1d` made this the only door.** `clerk-js` and
   * `ui.browser.js` come from Clerk's CDN, and `@clerk/shared`'s loader waits 15s before giving up
   * (`scriptLoadTimeout ?? 15e3`). On gym LTE that is fifteen seconds of empty card — and after `1d`
   * there is no access code to fall back to, so a reader who gets nothing has no way in at all.
   * ⚠️ Without these two lines the screen's failure state is a mark, one sentence about invitations
   * and a privacy link — which to a kid reads as "you're not allowed", not "it didn't load".
   * `loading` is in the `notYet` register (a state, not an imperative); `failed` names the one action
   * that helps, because reloading re-requests the bundle.
   */
  loading: 'The Google sign-in button is loading…',
  failed: 'The sign-in button didn’t load. Reloading this page is the fix.',
  /**
   * 🔴 **Corrected 2026-11-03 — it said the prohibited thing, on the consent screen.** It read
   * _"tells us the email address on your Google account — **nothing else from it**"_, which is false
   * at the token: the production instance's scopes are `openid` · `userinfo.email` ·
   * `userinfo.profile`, and **`userinfo.profile` cannot be removed**, so `name` and `picture` arrive
   * whatever this app wants. `runbooks.md`'s closed scope box carries the standing prohibition
   * verbatim — _"Do not reintroduce a flat 'Google sends us nothing but an email address' — it is
   * false at the token and falsifiable by anyone who looks"_ — and `notice.md` was corrected for it
   * on 2026-10-26 while this string, the one a person actually reads before deciding, was missed.
   *
   * ⚠️ The distinction the copy must keep is **what Google sends** vs **what this app stores**. They
   * are different, and collapsing them is how the old sentence became false.
   */
  processor:
    'This screen is run by Clerk. Signing in tells Clerk your email address, your name and your profile picture — that is Google’s minimum and cannot be narrowed. This app stores only which account signed in, and nothing about your athletes is ever sent to Google.',
  /**
   * Short on purpose _(maintainer, 2026-11-05)_. It read "What this app stores, and how to get it
   * back or delete it" — accurate, and a full line of underlined text under a self-contained card,
   * which read as a paragraph rather than a link. The page it reaches still covers export and
   * deletion; the label only has to be worth tapping.
   * ⚠️ Keep it a statement of what the reader GETS, not a category name. "Data Policy" or "Privacy"
   * would be shorter still and tell them less — the register here is the `notYet` /
   * `PICKER_EMPTY_COPY` family, plain language over labels.
   */
  privacyLink: 'What this app stores',
} as const;

/**
 * The site footer's two items (PRIV-2). `/privacy` is the SECOND room a stranger can walk into —
 * someone arriving from a consent screen with no idea what this app is — and the deleted gate page's
 * way-back link recorded the same rule: the one room a stranger can walk into needs an exit. One
 * `<footer>` in the root layout, so a family inside the app can reach the notice too.
 * ⚠️ From `1d` `SiteFooter` returns `null` on the `/sign-in` subtree — that screen carries its own
 * mark and privacy link instead, so it is NOT this footer that gets a reader out of there.
 */
export const FOOTER_COPY = { home: APP_NAME, privacy: 'Privacy notice' } as const;

/**
 * A quiet, tap-target-sized inline link. Extracted at PRIV-2, when the (now deleted) gate page's
 * way-back link had it inline and the footer became the second use site (AGENTS.md — the second
 * occurrence is the trigger). The sign-in screen's privacy link is the third.
 */
/**
 * A quiet NAVIGATION link, tap-target-sized — the `←`/`→` arrows that move between screens.
 *
 * 🔴 **The same tokens as `QUIET_LINK_CLASS` minus the underline, plus `w-fit`**, and it exists
 * because the string was hand-typed **five** times (three on the day page, two on the rename screen)
 * before PROF-1 a-r named it. Those comments each call `min-h-11` "load-bearing and UNGUARDED by
 * CI" — which is the argument for one constant, not for five copies a future edit can quietly drop
 * the token from. AGENTS.md: the second occurrence is the trigger.
 *
 * ⚠️ **Not the same thing as `QUIET_LINK_CLASS`.** That one is underlined because it appears inside
 * a block of prose (the footer, the sign-in screen's privacy link), where an underline is what marks
 * it as a link at all. These sit alone on a line behind an arrow, which does that job.
 */
export const NAV_LINK_CLASS =
  'text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 w-fit items-center rounded-sm text-sm outline-none focus-visible:ring-3';

/**
 * A program's name on the day page's programs line, as a link to its page ("Family program ›";
 * FAM-1 15c, D49). Matched to the prototype's line buttons (`.txt` with `padding:0`,
 * `program-order-ends-today.html`): no padding of its own; the line's gaps space the names.
 *
 * 🔴 **No underline until hover, because the "›" after each name marks it as a link** (WCAG 1.4.1:
 * not by colour alone). The name is also the foreground colour on a muted label, so a link never
 * relies on its colour. Drop the "›" and the underline must come back.
 *
 * 🔴 **`min-h-11` and `min-w-11` are load-bearing**: the 44px tap target, on a short name too
 * ("Am" is narrower than a thumb). `wrap-anywhere` lets a long unbroken name wrap inside the link
 * instead of overflowing at 360px; it is here rather than `NAME_WRAP_CLASS` because that one's
 * `min-w-0` would win over `min-w-11` under `cn`.
 */
export const PROGRAM_NAME_LINK_CLASS =
  'text-foreground focus-visible:ring-ring inline-flex min-h-11 min-w-11 items-center rounded-sm text-sm font-medium wrap-anywhere underline-offset-4 outline-none hover:underline focus-visible:ring-3';

/**
 * A nav ROW — a full-width, bordered, tappable row. `NAV_LINK_CLASS` above is `w-fit` for inline
 * arrow links ("← All athletes"); this is its block-level sibling.
 *
 * ⚠️ **Named at its second use, which is the trigger.** `app/p/page.tsx` hand-typed it for the
 * settings row; `UI-5`'s nav rail wants exactly the same shape for every item, and a third copy is
 * how a focus ring or a tap-target height ends up different on one of them.
 *
 * `ring-inset` because the nav rail scrolls (`overflow-y-auto`), which clips a ring drawn outside
 * the row; inside it, the full-opacity ring stays whole.
 */
export const NAV_ROW_CLASS =
  'focus-visible:ring-ring hover:bg-accent flex min-h-11 flex-col justify-center rounded-lg border px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-inset';

/**
 * An underlined, tap-target-sized link with no colour or size of its own: `QUIET_LINK_CLASS` builds on
 * it, and a link in a name or a sentence that keeps its text's colour uses it with a hover of its own
 * (the program builder's athlete names and "Home", FAM-1 15).
 */
export const INLINE_LINK_CLASS =
  'focus-visible:ring-ring inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 outline-none focus-visible:ring-3';

export const QUIET_LINK_CLASS = `text-muted-foreground hover:text-foreground text-sm ${INLINE_LINK_CLASS}`;

/**
 * A dashed, muted notice box: why something is absent or read-only (the closed-day and archived
 * notices on the day page, the day page's "Not on a program." and rest-day notices). Defined at
 * FAM-1 13d, the third copy; `page.tsx`'s two literals moved to it at 12c.
 */
export const NOTICE_CLASS =
  'border-input text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm';

/**
 * The picker's FIRST-RUN copy (ONB-0) — the screen a brand-new deployment actually opens on, which
 * until now read "No profiles found. Seed the database to get started."
 *
 * Who is reading it, because that decided every string: `/p` needs a session with a household, so the
 * reader either deployed this or was invited by whoever did — the committed UX panel's A5. ⚠️ The
 * original argument said "there is exactly one shared access code", which `1d` deleted; the
 * conclusion is unchanged, because a membership row is narrower than the code ever was. `pnpm dev` re-seeds on every boot, so the state is unreachable locally. The copy
 * addresses that person honestly instead of pretending to onboard a family who cannot yet exist.
 *
 * Checked against ONB-1 R20 ("the app's voice is a receipt, not a coach"): every line is phraseable as a
 * statement of fact. `what` says what the app DOES and what it does NOT do — deliberately not a fourth
 * paraphrase of `LANDING_COPY.lead`, which says who it is FOR and which this reader saw two screens ago.
 * `next` keeps the SETTING as its subject, never "a day starts with…", which would be the app telling a
 * parent what a wrestler's day consists of. One noun throughout: **athlete** (the human word), not
 * "profile" (the schema's).
 */
export const PICKER_EMPTY_COPY = {
  /** Replaces `PICKER_COPY.subhead` when there are no athletes: "Tap your name to start logging." is an
   *  imperative with no object here, and a screen reader hears it with nothing to supersede it. */
  subhead: 'Nobody is set up to log yet.',
  heading: 'No athletes yet',
  what: `${APP_NAME} is a logbook: you write down what an athlete did — strength sets, rep counts, time at practice — one day at a time. It doesn’t write the plan.`,
  /**
   * 🔴 **Rewritten at PROF-1 a-r because it named a screen this PR unlinks.** It used to end "…and
   * you add the rest from their routine editor" — and acceptance criterion 11 (M30) removes the only
   * link to that editor, so the sentence was about to send a first-run reader hunting for a route
   * with no entry point. The SETTING stays the subject, per this family's own rule.
   */
  next: 'When an athlete exists, their day starts with a weigh-in and strength, and the rest follows the routine saved for them.',
  /**
   * 🔴 **`notYet`, `setupCta` and `setupAnchor` are DELETED at PROF-1 a-1u, not reworded.** All three
   * existed because adding an athlete was not in the app: `notYet` said so, and the other two sent
   * the reader to the README to edit seed data. `a-1u` ships the control, so the sentence is false
   * and the GitHub button is a detour away from the button that now works. The empty state's own
   * recovery is the add tile it renders.
   *
   * ⚠️ **`SIGN_IN_COPY.notYet` is a DIFFERENT key with the same name and it stays.** It is about
   * Google sign-in being dark, not about a missing control.
   */
} as const;

/**
 * AUTH-1 1c-2 — the screen for "this request resolves no household".
 *
 * 🔴 **Every line is true for ALL FIVE causes, and that is the design constraint, not a compromise.**
 * `householdState()` returns `'none'` for: an unseeded deploy (today); the table not existing yet;
 * a signed-in parent with no membership (after 1c-4); **the maintainer before the claim correction
 * has run**; and — the likeliest cause on a phone — **the wrong Google account**, where a parent with
 * a personal and a work account signs in with whichever one the browser was already in.
 *
 * A copy that named one of those would be false for the other four. The maintainer's cases (an
 * unseeded deploy, a missing table, the pre-correction window) are served by `scope_outcome` in
 * Sentry and by the runbook — **not by a line on a family's screen**. So: one cause-free string,
 * telemetry carries the cause, and `householdState()` stays deliberately coarser than the five
 * states it collapses.
 *
 * 🔴 **The reader's question is "where is my kid's data?", not "what is a household?"** This screen
 * opens with three statements of absence in a row (heading, subhead, `what`), so `what` has to close
 * by scoping them to the ACCOUNT. *"There is nothing to show"* is a claim about the world; the true
 * claim is about this account, and the reader is one clause away from understanding they are at the
 * wrong door rather than at an empty cupboard. _(UX panel F6, 2026-10-28.)_
 *
 * Statements of fact, never imperatives — the `PICKER_EMPTY_COPY` / `SIGN_IN_COPY` family, including
 * **`SIGN_IN_COPY.notYet`**'s idiom for a capability that is not switched on. ⚠️ Named explicitly
 * because the picker had a `notYet` of its own until PROF-1 a-1u, and "its" read as that one.
 */
export const NO_HOUSEHOLD_COPY = {
  /**
   * Replaces `PICKER_COPY.subhead`: "Tap your name to start logging." has no object here.
   * ⚠️ **No "yet."** It promises the state resolves on its own, which is false in the wrong-account
   * case — that account is never linked, however long the reader waits.
   */
  subhead: 'Nothing is linked to this account.',
  heading: 'No household for this account',
  what: `A household is the group ${APP_NAME} keeps one family’s athletes and their logs in. This account isn’t in one, so this screen has nothing to show. That is about the account, not about anyone’s training history.`,
  /**
   * The only cause the reader can fix alone.
   * ⚠️ **Predicated on the ACT, not on owning accounts.** "If you have more than one Google account"
   * is true of most adults, so it never goes quiet. "If you signed in with Google" self-disables for
   * anyone who did not — which, before `1d`, was every reader, because they arrived through the
   * access gate without touching Google.
   * ✅ **The control exists from 1c-3, and from `1d` signing out of Clerk is the whole story** —
   * there is no second cookie left to govern access. Until then it would have been a control that
   * does not do what it says, which is what parked the lock-device PR (#303).
   */
  wrongAccount:
    'If you signed in with Google and have more than one account, this may be the wrong one. Signing out and signing back in with the address the invitation was sent to is the fix.',
  /**
   * Says plainly that the screen cannot add the account, which is what stops a parent hunting for a
   * control that does not exist. Names the invitation because *"the person who set this up"* is
   * otherwise an unresolvable handle on a phone — a reply in their mail client reaches that person,
   * and the clause is conditional, so it stays true in all five causes.
   * ⚠️ **It must never name the maintainer** (AGENTS.md → "No personal names"; the repo is public).
   * It does not need to: `SiteFooter` renders on this page and links `PRIVACY_PATH`, and the notice
   * carries the project address. Recorded so a future author neither commits a personal address nor
   * reads the absence of one as an oversight.
   */
  next: 'Otherwise, ask the person who set this up to add this account — if you have the invitation, replying to it reaches them. Adding an account is done by hand, and nothing on this screen can do it.',
} as const;

/** The routine editor's copy — the e2e replays its Save, so the label has one home. */
export const ROUTINE_COPY = {
  /** The routine page's `<h1>` and its title. */
  heading: 'Edit routine',
  /** Said, and shown, after a save (`routine-editor.tsx`'s `Announcer`). */
  saved: 'Routine saved.',
  orderHeading: 'Routine order',
  save: 'Save routine',
} as const;

/** The `tz` cookie's lifetime (seconds) — 1 year. Two consumers, both writing that one cookie:
 *  `components/layout/tz-sync.tsx` and `scripts/capture.ts`. ⚠️ Said "shared by the access-gate
 *  cookie and the tz cookie" until AUTH-1 1d deleted the former. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The theme choice (UI-4). `system` FIRST because it is the default: a viewer's OS preference is
 * honoured before anyone touches anything, which is the only setting that is right for a household
 * nobody has configured.
 *
 * The values are `next-themes`' own (`setTheme('system' | 'light' | 'dark')`), so this array is the
 * app's single source for them and the specs assert through it rather than re-typing a string.
 */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/**
 * The `localStorage` key the choice is stored under — **the app's first-ever stored key**; nothing in
 * `apps/web` used `localStorage` before this.
 *
 * ⚠️ **Set EXPLICITLY, not inherited.** `next-themes` defaults to `'theme'`, and the e2e proves the
 * no-flash behaviour by seeding this key before navigation. If the library's default ever moved, a
 * seeded `'theme'` would simply be ignored, the pre-paint script would read nothing, and the test
 * would fall through to the post-hydration path — passing while the flash was back. Owning the key
 * removes that failure mode entirely. `mp_` prefixed like `mp_gate`, so a shared browser's storage
 * says which app it belongs to.
 */
export const THEME_STORAGE_KEY = 'mp_theme';

/**
 * The toggle's copy. `system` is labelled **"Auto"**, not "System": the primary users are kids
 * between sets, and "System" is OS-vendor vocabulary that a nine-year-old does not map to "match my
 * phone" (UX panel, lens 1). The visible word stays a SUBSTRING of the accessible name, so WCAG
 * 2.5.3 Label in Name holds — the same rule the BW/band chips follow.
 */
export const THEME_COPY = {
  /** The group's visible label. Visible, not `sr-only`: three bare words at the top of a screen,
   *  the first of which used to be "System", read as a setting that might change something real
   *  (UX panel, lens 3). The word "Theme" is what makes a mis-tap obviously harmless. */
  legend: 'Theme',
  labels: { system: 'Auto', light: 'Light', dark: 'Dark' } satisfies Record<ThemeChoice, string>,
  /** The accessible name of one option. */
  option: (choice: ThemeChoice) =>
    choice === 'system'
      ? `${THEME_COPY.labels.system} theme — match this device`
      : `${THEME_COPY.labels[choice]} theme`,
  /** The one static line under the control, so "Auto" is not a word the reader has to guess at.
   *  Static text, deliberately NOT a live region: a native radio group announces its own change. */
  hint: 'Auto follows this device. Saved on this device only.',
} as const;

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
 * The add-athlete tile on the picker (PROF-1 a-1u).
 *
 * `subhead` says who an athlete can be, because the first question a parent has on a first run is
 * whether this app is only for their kids. "A child, or yourself" answers it in four words and is
 * also the only place the adult case is named before the form.
 */
export const ADD_ATHLETE_COPY = {
  heading: 'Add athlete',
  subhead: 'A child, or yourself',
  /** The `<h1>` of `/p/new`, and its static `metadata.title` (D8). */
  pageHeading: 'Add an athlete',
} as const;

/**
 * The link back to the athlete list (PROF-1 a-1u).
 *
 * A const on its **second** use, per AGENTS.md → "Constants, enums & shared values": the day page has
 * said "← All athletes" since `a-g`, and `/p/new` is the second screen to need the same way out. The
 * arrow is part of the string because it is part of the affordance — a bare "All athletes" reads as a
 * heading on a screen that has no other navigation.
 */
export const ALL_ATHLETES_LINK = '← All athletes';

/**
 * The way back to `/p` from a **household** page (Programs, Household settings), where
 * `ALL_ATHLETES_LINK` is the way back from a page about ONE athlete. The rule, so the next page
 * chooses on purpose: household pages say Home, one athlete's pages say All athletes. Settings lists
 * archived athletes that `/p` does not, so "All athletes" would point away from the page that shows
 * more of them. Both lead to `APP_HOME_PATH`; whether to settle on one label is the maintainer's call.
 */
export const HOME_LINK = '← Home';

/**
 * UI-6 — the app's own 404 (`app/not-found.tsx`). One message for an unknown URL AND for an athlete
 * id the household can't see, so the page never confirms that another household's athlete exists.
 * No "check the address": every URL past `/p` is a UUIDv7, which nobody types.
 */
export const NOT_FOUND_COPY = {
  heading: 'Page not found',
  body: 'This page doesn’t exist, or you don’t have access to it.',
} as const;

/**
 * The page shell every routed screen's `<main>` wears (PROF-1 a-1u).
 *
 * 🔴 **Extracted at the NINTH copy, which is the trigger, not a tidy-up.** It was written out
 * verbatim eight times — `app/page.tsx`, `app/p/page.tsx`, `app/p/loading.tsx`,
 * `app/p/[profileId]/page.tsx`, `.../edit/page.tsx`, `.../routine/page.tsx` and
 * `app/settings/page.tsx` twice — and `a-1u` adds `/p/new`. AGENTS.md → "Constants, enums & shared
 * values": a literal that carries meaning and must stay in sync across files is named once, and the
 * second occurrence is the trigger. Eight was seven too many.
 *
 * ⚠️ **It is a BASE, so append rather than fork.** `app/page.tsx` (the landing) adds
 * `md:justify-center` because it centres a short hero in the viewport; every other screen starts at
 * the top. A screen needing a different max-width or padding is a design decision — raise it rather
 * than writing a ninth literal.
 *
 * `flex-1` matters: the root layout is a flex column, so without it a short page's `<main>` collapses
 * to its content height and the footer rides up under the fold.
 *
 * 🔴 **Split THREE ways at `UI-5`, after the first two-way split put the gap on the wrong element.**
 * The shell's `<main>` is a column with exactly ONE child (the content wrapper), so a `gap-8` there
 * renders nothing — and the geometry guard was pinning that inert value while the gap the page
 * actually sees lived in a second literal on the wrapper. A review lens caught it. The three pieces
 * are now whatever each element genuinely needs:
 *
 * - {@link PAGE_MEASURE_CLASS} — the 672px measure. Written once; `PAGE_CONTENT_CLASS` and
 *   `PAGE_SHELL_CLASS` both build on it, and the shell's `<main>` uses it directly.
 * - {@link PAGE_COLUMN_BOX_CLASS} — the column's box: full width, the side gutter, the vertical
 *   breathing room. No width cap and no gap.
 * - {@link PAGE_STACK_CLASS} — the flex column AND the gap between a page's top-level children.
 *   ⚠️ **It belongs on whichever element HAS those children**: `<main>` on a page outside the
 *   shell, the content wrapper inside it. Put it on both and the outer one is dead weight that a
 *   test can pin without guarding anything.
 *
 * `PAGE_SHELL_CLASS` is all three, and its value is byte-identical to what it has always been.
 */
export const PAGE_MEASURE_CLASS = 'max-w-2xl';
export const PAGE_COLUMN_BOX_CLASS = 'w-full px-4 py-12';
export const PAGE_STACK_CLASS = 'flex flex-1 flex-col gap-8';
export const PAGE_SHELL_CLASS = `mx-auto ${PAGE_MEASURE_CLASS} ${PAGE_COLUMN_BOX_CLASS} ${PAGE_STACK_CLASS}`;

/**
 * The width a page's CONTENT reads at, whatever the column around it is.
 *
 * 🔴 **`UI-5` makes the main region wide; it does not make the form wide.** Measured at 1280 with a
 * nav rail, an uncapped region gives the log form ~1000px: `strength-form.tsx`'s movement row is
 * `flex-1`, so the Movement input alone grows to ~650-700px for a ten-character name, and the
 * `justify-between` list rows put a label and its value ~992px apart. `design.md` says design at the
 * narrow width and let it scale **up** — scaling up is not stretching. If the form itself should be
 * wider, that is `UI-1`'s call; it owns the form's shape.
 */
export const PAGE_CONTENT_CLASS = `w-full ${PAGE_MEASURE_CLASS}`;

/**
 * What an element becomes when it is a CELL of the app shell's `lg` grid rather than a centred
 * column: the cell decides its width and position, so the centring and the cap come off.
 *
 * ⚠️ **`<main>` and the footer must agree**, or the footer centres on the window while the content
 * sits beside the rail — `a11y.spec.ts` asserts `footer.x === main.x` at 1280 for exactly that
 * reason. One string, two elements (`app-shell.tsx` and `site-footer.tsx`).
 */
export const SHELL_CELL_CLASS = 'lg:mx-0 lg:max-w-none';

/**
 * The shared text/number `<input>` styling — the single source for the app's form fields (the
 * bodyweight, strength, check-in, and V1-9 edit-set inputs), so the ≥44px height (`h-11`), focus ring,
 * and invalid-border tokens can't drift between forms. Callers append width utilities as needed
 * (e.g. `${INPUT_CLASS} w-24`). Extracted from the three form-local copies it used to be duplicated in.
 */
export const INPUT_CLASS =
  'border-input bg-background focus-visible:ring-ring h-11 rounded-lg border px-3 text-base outline-none focus-visible:ring-3 aria-invalid:border-destructive';

/** A read-only day with nothing logged, in every single-value section (v12): one string, so they agree. */
export const NOTHING_LOGGED = 'Nothing logged.';

/**
 * The prefix of the muted hint over an unlogged single value (`Last time 72.5 lb`, V1-24 3b-bw). Its
 * own const so a test can match "any Last time line" without re-typing the words.
 * ⚠️ lane C's `components/day/day-copy.ts` carries the same words for the program rows; the two
 * should become one when that lane next touches it.
 */
export const LAST_TIME_PREFIX = 'Last time';

/**
 * A logged single value's row (V1-24 3b-bw): the done edge and tint, from `docs/design.md`'s done
 * tokens. ⚠️ `has-[form]:` drops the tint while the Change editor is open: its field, its error, its
 * hint, Clear and their focus rings are all designed for a plain surface, and on the tint the error
 * text is 4.30:1 (`app/done-tokens.test.ts` pins that pair as one the tint must never carry). Lane C's
 * `components/day/item-card.tsx` carries the same classes and the same "no tint under a message" rule.
 */
export const LOGGED_ROW_CLASS =
  'border-done bg-done-surface text-card-foreground has-[form]:bg-background';

/**
 * The Life section's copy (V1-24 3b-page). The logged row names the value, on every day (typed since
 * 3b-life-b; the practice row's own copy is `PRACTICE_COPY`).
 */
export const LIFE_COPY = {
  heading: 'Life',
  /** A read-only day with nothing logged; otherwise the section is a bare heading. */
  noneOnClosedDay: NOTHING_LOGGED,
  /** What the status region announces after a log. */
  announced: (label: string) => `${label} logged`,
} as const;

/**
 * The ring on an element focused by script, never by Tab (the program builder's headings and the
 * athlete switcher). With `tabIndex={-1}` at the use site. The day page's rows hand focus to a real
 * control instead since V1-24 3b-life.
 */
export const FOCUS_TARGET_CLASS = 'focus-visible:ring-ring outline-none focus-visible:ring-3';

/**
 * The ✓'s focus ring (design.md), and any Tab stop on the day page that should focus like it (the
 * athlete switcher, FAM-1 12c): full-opacity `foreground`, OUTSIDE the ✓, never inset on the
 * fill. An outline, so the gap shows the tint or the card behind it rather than a painted offset.
 *
 * ⚠️ `focus-visible:outline-solid` is load-bearing: Tailwind's `outline-none` sets the outline
 * style to `none` through a variable that `outline-3` reads, so without it no ring is drawn.
 */
export const TICK_FOCUS_CLASS =
  'outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-foreground';

/**
 * A `Button` that focuses like the ✓: `TICK_FOCUS_CLASS`'s outline, offset onto the surface, with the
 * base ring and border turned off so the two do not overlap. On the day page's tint (Undo, the
 * Change's ✕, "+ Add set"), and on the solid `destructive` variant, where `foreground` inside the
 * dark fill would be under 3:1 (docs/design.md → the ✓'s focus rule). Here, not in
 * `components/day/`, since V1-9b B2-prep: `components/ui/button.tsx` reads it.
 */
export const ON_TINT_BUTTON_FOCUS_CLASS = `focus-visible:ring-0 focus-visible:border-transparent ${TICK_FOCUS_CLASS}`;

/** Joins several logged values in the receipt and the announcement (`84.5 lb, 845 lb`). */
export const VALUE_JOINER = ', ';

/** The sr-only word beside a logged single value's tick, so it reads "Logged 84.5 lb" (3b-bw W4). */
export const LOGGED_SR_LABEL = 'Logged';

/**
 * The copy a single value's Change editor and its island share (V1-24 3b-life A2): one template per
 * subject, so bodyweight and practice cannot drift into two spellings of "changed to" or "cleared".
 *
 * - `changeSubject`: `changeLabel`'s subject (`Change weight — 84.5 lb`); the ✓ and ✕ names below
 *   are built from it, so one row never names its value with two different nouns.
 * - `saveLabel` / `clearLabel` / `cancelLabel`: the inline ✓'s name (`Save weight`, or `Clear
 *   weight` while an empty ✓ would clear: plan W5; the icon-only pair, 2026-11-16) and the ✕'s. The
 *   ✓ looks the same either way; the hint says a blank clears.
 * - `clearHint`: always under the open editor, so a blank ✓ is never a surprise. "Clear", not
 *   "remove": the row is hidden, not erased, until `PRIV-3` (delete-and-restore.md's trap).
 * - `blankSave`: an archived athlete's empty ✓, refused (there is no field to re-enter into). It names
 *   the ✓, so it renders through `TickedCopy` and a screen reader hears the ✓'s name.
 * - `announced*`: what the live region says (plan W6); a clear's line is SHOWN as well, because it
 *   leaves nothing else on screen.
 */
function singleValueCopy(o: {
  subject: string;
  changeSubject: string;
  clearHint: string;
  blankSave: string;
}) {
  return {
    changeSubject: o.changeSubject,
    saveLabel: inlineSaveLabel(o.changeSubject),
    clearLabel: `Clear ${o.changeSubject}`,
    cancelLabel: inlineCancelLabel(o.changeSubject),
    clearHint: o.clearHint,
    blankSave: o.blankSave,
    announcedLogged: LIFE_COPY.announced(o.subject),
    announcedChanged: (value: string) => `${o.subject} changed to ${value}`,
    announcedCleared: (value: string) => `${o.subject} cleared. It was ${value}.`,
  } as const;
}

export type SingleValueCopy = ReturnType<typeof singleValueCopy>;

/** An inline ✓'s name (`Save weight`): icon-only, so the name says what it saves. */
function inlineSaveLabel(subject: string): string {
  return `Save ${subject}`;
}

/** An inline ✕'s name (`Cancel changing weight`), for every inline Change (`AMEND_COPY.cancelLabel`),
 *  so two open editors are not two identical "Cancel"s in a screen reader's list. */
function inlineCancelLabel(subject: string): string {
  return `Cancel changing ${subject}`;
}

/**
 * The weigh-in surface's copy (V1-24 PR 1a) — the plan's §"The 1a receipt, exactly" strings, verbatim.
 *
 * 1a ships the receipt BEFORE amend exists, and what makes that honest is this copy, so it is
 * specified rather than improvised. Every string here is asserted by a spec through this object.
 */
export const BODYWEIGHT_COPY = {
  /** A second weigh-in refused by V1-24 1d's one-per-day index (two phones, or a stale tab). The
   *  page revalidates and shows the one that landed; the amend corrects its value. */
  dayTaken: 'A weight is already logged for this day.',
  /** The section heading in EVERY state — a noun that is true over a form, a row, or nothing. */
  heading: 'Bodyweight',
  /** The ✓'s accessible name (V1-24 3b-bw): the glyph alone says nothing to a screen reader. */
  logLabel: 'Log bodyweight',
  /** An empty ✓, refused in the browser before any request (plan W3). */
  blankLog: 'Enter your bodyweight, then ✓.',
  /** The sr-only word beside a logged row's tick, so it reads "Logged 84.5 lb". */
  logged: LOGGED_SR_LABEL,
  /**
   * The muted hint over the unlogged row (plan W10): `Last time 72.5 lb`, with the day when it was not
   * yesterday (`· Tue`, or `· Nov 3` from a week back). Never a placeholder or a prefill.
   */
  lastTime: (value: string, when: string | null) =>
    when ? `${LAST_TIME_PREFIX} ${value} · ${when}` : `${LAST_TIME_PREFIX} ${value}`,
  /**
   * More than one live row (the pre-1c duplicates, or a two-phone race): `2 weights logged: 84.5 lb,
   * 845 lb`. The row never silently picks one — a hidden duplicate is uncorrectable twice over.
   */
  several: (values: readonly string[]) =>
    `${values.length} weights logged: ${values.join(VALUE_JOINER)}`,
  /**
   * The ONE line under a duplicates headline (rounds 2–3 on #180). Two different situations, so two
   * different asks:
   * - **All the same value** (a double submit): the extra row(s) are the problem.
   * - **Different values** (e.g. two phones): someone has to decide which weight is right, and
   *   "remove the extra" would invite a guess that corrupts the trend.
   * Both say it **can’t be fixed in the app yet**, so a parent doesn't hunt for a delete control that
   * doesn't exist; the fix is `db:correct`.
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
  /** A read-only day with nothing logged (v12, and Life's) — otherwise the section is a bare heading. */
  noneOnClosedDay: NOTHING_LOGGED,
  /** `AMEND_ERROR_COPY`'s subject: `the weight wasn't changed` (as `PRACTICE_COPY.noun`). */
  noun: 'weight',
  ...singleValueCopy({
    subject: 'Bodyweight',
    changeSubject: 'weight',
    clearHint: 'To clear this weigh-in, leave the field empty.',
    blankSave: 'Enter your bodyweight, then ✓.',
  }),
} as const;

/** The practice activity's label, from the one list that also names its button (one source). */
/** The sr-only words after the practice label that make the field's name (`… minutes`). */
const PRACTICE_FIELD_SUFFIX = ' minutes';

const PRACTICE_LABEL = LIFE_ACTIVITIES.find(
  (a) => a.key === ACTIVITY_TYPE_KEYS.wrestling_practice,
)!.label;

/**
 * The practice row (V1-24 3b-life). One practice per athlete and day (3b-0's index), so the number is
 * the day's TOTAL, and the hint says so (plan A3).
 */
export const PRACTICE_COPY = {
  label: PRACTICE_LABEL,
  /** `AMEND_ERROR_COPY`'s subject: `the practice wasn't changed`. */
  noun: 'practice',
  /** The log row's sr-only suffix after its visible label, so its name is `fieldLabel`. */
  fieldLabelSuffix: PRACTICE_FIELD_SUFFIX,
  /** The field's accessible name on BOTH rows (log and Change); the visible `min` is `aria-hidden`. */
  fieldLabel: `${PRACTICE_LABEL}${PRACTICE_FIELD_SUFFIX}`,
  ...singleValueCopy({
    subject: PRACTICE_LABEL,
    changeSubject: PRACTICE_LABEL.toLowerCase(),
    // "That day", not "today": Change renders on yesterday too, the evening-after path this is for.
    clearHint:
      'To clear this practice, leave the field empty. Two practices that day? Enter the total.',
    blankSave: 'Enter the minutes, then ✓.',
  }),
  /** A refused amend or log (`bad_value`): the one rule, its range from the shared consts. */
  outOfRange: `Enter whole minutes, ${PRACTICE_MINUTES_MIN} to ${PRACTICE_MINUTES_MAX}.`,
  // ── Logging (V1-24 3b-life-b B1, B2, B5) ────────────────────────────────────────────────────────
  /** The ✓'s accessible name. */
  logLabel: `Log ${PRACTICE_LABEL.toLowerCase()}`,
  /** An empty ✓, refused in the browser before any request. */
  blankLog: 'Enter the minutes, then ✓.',
  /**
   * A number that reads as hours: the floor's reason, said plainly _(maintainer, 2026-11-16)_. For a
   * whole 1–5 the sum is done for them (`2 hours is 120`); otherwise a fixed example, in words, not
   * the ½ glyph. (6 hours and up would be over the 300 cap anyway.)
   */
  hoursNotMinutes: (typed: string) => {
    const t = typed.trim();
    const hours = /^0*[1-5]$/.test(t) ? Number(t) : null;
    return hours === null
      ? 'Minutes, not hours: 1 and a half hours is 90.'
      : `Minutes, not hours: ${hours} ${hours === 1 ? 'hour is' : 'hours is'} ${hours * 60}.`;
  },
  /** A tab still on the one-tap bundle posts no minutes; a reload brings the field. */
  reloadToLog: 'Reload the page to log practice.',
  /**
   * A practice already holds the day (3b-0's index): say what happened to THIS number, and how to make
   * it count. No claim about "another phone": a second tab on the same phone gets this too.
   */
  dayTaken: (minutes: number) =>
    `A practice is already logged for this day, so your ${minutes} min wasn't saved. Tap Change to make it ${minutes}, or enter the total if it was a second practice.`,
  /** The id is held by a different row (a crafted reuse): nothing saved; the form mints a new id. */
  notSaved: "That wasn't saved. Tap ✓ to try again.",
  /** This athlete's own CLEARED practice holds the id: nothing logged; the form mints a new id. */
  clearedEarlier: 'That practice was cleared earlier, so nothing was logged. Tap ✓ to log it now.',
} as const;

/**
 * Each typed-entry problem's message, for the form (before the request) and the action alike: one map,
 * and a `Record`, so a new problem in `practiceMinutesProblem` is a compile error until it has copy.
 */
export const PRACTICE_PROBLEM_COPY: Record<PracticeMinutesProblem, (typed: string) => string> = {
  blank: () => PRACTICE_COPY.blankLog,
  hours: (typed) => PRACTICE_COPY.hoursNotMinutes(typed),
  range: () => PRACTICE_COPY.outOfRange,
};

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
  /**
   * The inline ✕'s name for a row with no `SingleValueCopy`: lane C's day-page rows (set rows and
   * single-value cards).
   */
  cancelLabel: inlineCancelLabel,
  /** The amend input's accessible name. The unit is in it because the visible unit is a sibling
   *  `<span>` a screen reader would otherwise never pair with the number. */
  valueLabel: (unit: string) => `Weight (${unit})`,
} as const;

/**
 * "1 movement" / "3 movements": the one spelling, shared by the movement picker's counts.
 *
 * ⚠️ **Through `plural()`, not a `n === 1` ternary.** The ternary was correct English and still the
 * wrong shape: it is the pattern a new string copies, and a locale with three forms cannot be
 * expressed as a comparison at all. `I18N-1` migrates the rest (`docs/plan.md`); this one came along
 * because the PR that added the helper should not leave the nearest duplicate behind.
 */
export const movementCount = (n: number) =>
  plural(n, { one: `${n} movement`, other: `${n} movements` });

/**
 * "1 item" / "6 items": the one spelling of how many items a workout holds (FAM-1), for the
 * builder's workout line ("6 items · Used Mon, Tue") and the day page's look-ahead, so the two
 * screens count the same workout in the same words. Both call it: the builder's `workoutSummary`
 * (`components/program-builder/builder-text.ts`) and the day page's `workout-card.tsx`.
 *
 * Here and not in `@mat-plan/shared`: the count is spelled in the app's locale, and the locale
 * (`./i18n/locale`) and `plural()` are the web app's. `movementCount` above is the same shape.
 *
 * Named `…Text`, as `quantityText` and `prescribedText` are, because `itemCount` is already the
 * number itself: the contract's `WorkoutSummary.itemCount`, and the builder's own parameter.
 */
export const itemCountText = (n: number) => plural(n, { one: `${n} item`, other: `${n} items` });

/**
 * How far past today the day page looks ahead (FAM-1 12c; maintainer, 2026-11-17: "6 days ahead",
 * the rest of the coming week). The forward arrow and the week strip stop at today plus this, and a
 * later `?d=` renders today. Look-ahead is read-only, so this bounds a view, never a write.
 */
export const LOOK_AHEAD_DAYS = 6;

/**
 * A write that cannot say what happened and needs the page's fresh data: a row or entry that is gone,
 * or a request whose day is malformed or not open yet. Its own constant because three places say it.
 */
export const NOT_SAVED_RELOAD = 'Not saved. Reload the page.';

/** The day page's day arrows and date line: `day-nav.tsx`'s `<nav>`, and how a test finds it. */
export const DAY_NAV_LABEL = 'Change day';

/**
 * The notice on a day before yesterday (V1-15). Since V1-24 3b-page nothing on such a day can be
 * logged or changed, so the sentence says that and names the two days that can. Shown only on a PAST
 * closed day (`dayPageFlags`' `showClosedNotice`: never a future day, never an archived athlete), so
 * "Past days" is always true where it appears. Wording chosen by the maintainer (2026-11-21) over
 * "This day is read-only. Only today and yesterday can be logged or changed.", which read as too
 * technical; keep it plain.
 */
export const CLOSED_DAY_NOTICE = 'Past days are locked. Today and yesterday stay open.';

/** The pending label on every Save button (amend islands and the routine editor). */
export const SAVING_LABEL = 'Saving…';

/**
 * AUTH-1 1c-3b — the sign-out control's copy.
 *
 * The consequence line is **disclosure at the decision point, not a confirmation dialog**. A confirm
 * would ask the user to approve something they cannot evaluate — whether Google will re-present an
 * account chooser is a property of their browser's session state, which no screen here can see — and
 * the real risk is a mis-tap, whose fix is placement and visual recession, not a dialog dismissed by
 * reflex. The `SIGN_IN_COPY.processor` idiom: put the fact next to the control.
 *
 * `text-foreground`, not muted, at the use site: read once, cold, immediately before an act with no
 * undo.
 */
export const SIGN_OUT_COPY = {
  action: 'Sign out',
  /**
   * Shown while `clerk-js` is still arriving — on gym LTE that is not instant. Deliberately the SAME
   * string as `action`: the button is `disabled` until `loaded`, so the state is already signalled by
   * the control, and changing the label as well would move the layout under a thumb already on its
   * way down. It stays a separate constant so the two can diverge without hunting call sites.
   */
  loading: 'Sign out',
  consequence:
    'Signing out ends this session on this device. Getting back in needs the Google account linked to this household.',
} as const;

/**
 * AUTH-1 1c-3b — the mutation limiter's refusal. **Distinct from `NO_PROFILE_*` on purpose.**
 *
 * Reusing a not-found string would tell a kid mid-session *"No profile found to log against"* when
 * the truth is "too many writes, briefly" — unactionable, and it would muddy the argument
 * `actions.test.ts` pins: that a caller with no session and a caller reaching another household get
 * the SAME bytes, so neither learns which it was. (Before `1d` an un-gated caller was a third arm.) A rate limit is not
 * that class of refusal and must not borrow its copy.
 *
 * Says what to do, because unlike the others there is something to do.
 */
export const RATE_LIMITED = 'Too many saves just now. Wait a moment and try again.';

/**
 * The refusal every profile-addressed Server Action returns when it has no profile to act on —
 * promoted out of `actions.ts`'s module scope by TEN-1 1b (ADR 0006's consequence 4).
 *
 * ⚠️ **ONE message for three states, on purpose: unknown id, soft-deleted, and — since TEN-1 —
 * ANOTHER HOUSEHOLD'S id.** (`1d` removed a fourth, un-gated, by deleting the gate.) A crafted cross-household id must learn nothing a stale id
 * wouldn't, which is the same argument `AMEND_ERROR_COPY.notFound` makes for its three states and
 * ADR 0006 → "What a wrong-household request returns" makes for 404-never-403. The security
 * property *is* the byte-identity, so it lives in one place rather than being re-typed at each
 * surface: `actions.test.ts` re-typed the literal seven times before this, and TEN-1's
 * wrong-household suite would have made it fourteen.
 *
 * Two strings, not one, because the routine editor SAVES rather than logs and the sentence has to
 * read correctly to a parent. They are `/^No profile found to (log|save) against\.$/` — deliberately
 * close, so neither can hint at which check refused.
 */
export const NO_PROFILE_LOG = 'No profile found to log against.';
/** @see NO_PROFILE_LOG — the routine editor's wording of the same refusal. */
export const NO_PROFILE_SAVE = 'No profile found to save against.';

/**
 * The refusal every **athlete-management** action returns (PROF-1 a-r; archive and restore join it
 * at PROF-1 b).
 *
 * ⚠️ **ONE message for four states, for the reason `NO_PROFILE_LOG` gives: no session, an unknown
 * id, a soft-deleted one, and another household's.** `actions.test.ts` pins the four as
 * byte-identical, which is ADR 0006's 404-never-403 argument made structural rather than likely.
 *
 * 🔴 **It says "athlete", not "profile", and that is a deliberate break from `NO_PROFILE_*`**
 * (PUX-8). "Profile" is the schema's word and it is the one the person reading this screen does not
 * use; `PICKER_EMPTY_COPY` already made the same switch ("One noun throughout: **athlete** (the
 * human word), not 'profile' (the schema's)"). The two older strings keep their wording because
 * they are shown on the logging surfaces, where changing copy is a separate, UX-panelled decision.
 */
export const NO_ATHLETE_SAVE = 'No athlete found to save.';

/**
 * The in-household authority refusal (PROF-1 b) — a member tried an owner-only act.
 *
 * 🔴 **It joins the `NO_HOUSEHOLD_COPY`/`notYet` family — "this is not for you to do" — and NOT the
 * `NO_PROFILE_*` family**, which is the 404-equivalence set that must stay byte-identical. ADR
 * 0006:348 permits a distinct refusal for an id **inside the caller's own household**: the member can
 * already see that athlete on `/settings`, so naming the reason leaks nothing, and answering "no
 * athlete found" about an athlete they can see on screen would be a lie.
 *
 * ⚠️ Only reachable by a crafted request — the UI renders no Archive control for a member — which is
 * why the DAL also emits a signal when it fires (`reportAuthorityRefusal`).
 */
export const OWNER_ONLY_ATHLETE =
  'Only the person who set up this household can archive an athlete.';

/**
 * The add refusal (PROF-1 a-1w).
 *
 * ⚠️ **Not `NO_ATHLETE_SAVE`'s wording.** "No athlete found to save." is false here — there is no
 * athlete to find; one was being created. Cause-free, because the three causes a person can actually
 * hit (a lapsed session, the rate limiter, a spent `client_id`) are indistinguishable to them and
 * the remedy is the same: try again.
 */
export const NO_ATHLETE_ADD = 'Couldn’t add this athlete.';

/**
 * The quota refusal (PROF-1 a-1w; `MAX_HOUSEHOLD_ATHLETES` = 25).
 *
 * 🔴 **This one NAMES its cause, and need not be byte-identical to anything.** It is only reachable
 * after the household scope resolved, so it tells the caller a fact about their own household —
 * which they can already see on the picker. Saying "couldn't add" there would send a parent
 * retrying a request that can never succeed.
 *
 * ⚠️ **It must not suggest archiving.** The first version read "Archive someone you no longer train
 * before adding another" — which **cannot work**: `countProfilesIn` counts archived rows on purpose,
 * because a cap a loop of archives can walk past is not a cap. A security lens caught the copy
 * contradicting the invariant asserted three files away, in the same PR. There is no in-app way to
 * free a slot today, so the honest instruction is the ask channel the notice already names.
 */
export const HOUSEHOLD_FULL = `A household can hold ${MAX_HOUSEHOLD_ATHLETES} athletes. Write to us if you need more.`;

/**
 * The athlete form's copy (PROF-1 a-r; a-1's add form reuses it).
 *
 * `legend`/`heading` are deliberately absent: the edit screen's `<h1>` already names the athlete
 * ("Edit Ada"), so a second "Who is this?" above a single field would be a heading for nothing. The
 * UX panel asked for that legend on **a-1's** add form, where the fieldset really does group a name
 * and a kind.
 *
 * `saved` is a **statement of fact**, not praise — the `NOTHING_LOGGED` / `PICKER_EMPTY_COPY`
 * family ("the app's voice is a receipt, not a coach", ONB-1 R20).
 */
export const ATHLETE_FORM_COPY = {
  nameLabel: 'Name',
  /**
   * A data-minimisation hint, not a format rule (PROF-1 a-1u). The app needs enough to tell two
   * athletes apart on a picker tile and nothing more, and this is the one place a person decides how
   * much of a child's identity to type. Phrased as what is ENOUGH rather than what is allowed — a
   * "requirements" register would read as a validation rule and invite a legal name.
   */
  nameHint: 'A first name or a nickname is enough.',
  /**
   * The add form's fieldset legend (PROF-1 a-1u).
   *
   * ⚠️ **"Child or adult?", not "Who is this?"** — a UX lens's finding, and it is about what a screen
   * reader says: the legend is announced with EVERY radio, so a user heard "Who is this? Child…", and
   * the answer to "who is this" is a **name**, which is the next field and outside this fieldset. The
   * legend has to name the question the radios actually answer.
   */
  legend: 'Child or adult?',
  /**
   * The permanence, stated as a FACT with the recovery beside it (UX lens 3, trust).
   *
   * 🔴 **`kind` is set once and the app cannot change it** — a recorded decision _(maintainer,
   * 2026-11-07, on a unanimous BLOCKING)_: one radio served both "I picked wrong" and "they turned
   * 18", and the form could not tell those apart. So the screen says so BEFORE the choice, and names
   * the way out, because a one-way door with no visible recovery is the hazard the panel flagged.
   * ⚠️ It must not read as a warning — nothing has gone wrong, and a parent adding their first child
   * should not meet an alarm.
   */
  kindPermanence: 'Set once — the app can’t change it afterwards.',
  /**
   * The recovery, moved OFF the permanence sentence and role-branched (UX lens, 2026-11-09).
   *
   * 🔴 **Two defects in the first version, both real.** It read "…If it's wrong, archive them in
   * Household settings and add them again" as part of the permanence line, which (1) a **member**
   * read two inches above the same page telling them only the owner can archive — a contradiction on
   * one screen — and (2) presented the recovery as cheap. It is not: the archived athlete KEEPS its
   * history, so adding again splits one person's record across two athletes. Saying so is the
   * difference between a recovery and a reassurance.
   */
  kindRecoveryOwnerBefore: 'Added the wrong kind? Archive them in',
  /**
   * The member's lead-in, composed with `OWNER_ONLY_ATHLETE` (the shared const the edit screen also
   * shows). ⚠️ **A lead-in, not a second copy of the refusal** — without it the member branch rendered
   * a bare "Only the person who set up this household can archive an athlete." under an add form,
   * which reads as orphaned: true, but not visibly an answer to anything on the screen.
   */
  kindRecoveryMemberBefore: 'Added the wrong kind?',
  kindRecoveryOwnerAfter: 'and add them again — what they logged stays with the archived athlete.',
  /**
   * What a new athlete starts with (FAM-1 15, v12's line): no program. One line under the kind
   * choice, the same for Child and Adult, because a program is no longer something the kind decides.
   * It replaced the per-option lines ("trains on the household's program" and its first-run and
   * adult twins), which described the legacy seeded program (roadmap thread, N3, 2026-11-19).
   *
   * ⚠️ **A function of the Programs page's name, not a sentence with "Programs" typed in.** The word
   * is `BUILDER_COPY.programs` (the page's heading), and this module cannot import it:
   * `builder-text.ts` imports from here, so reading it at this module's load would be a cycle that
   * throws whenever `builder-text.ts` loads first. The form passes it in.
   */
  startsWithNoProgram: (programs: string) =>
    `New athletes start with no program. Put them on one or more from ${programs}.`,
  /** The submit. Named for what it does, not "Save" — this screen CREATES. */
  add: 'Add athlete',
  /**
   * The duplicate warning (PROF-1 a-1d). ⚠️ **Hedged on purpose — "looks like", never "already
   * exists".** `foldName` is lossy by design: it strips every combining mark, so voiced kana (が/か),
   * Devanagari and Thai vowel signs, Persian ZWNJ variants and José/Jose all fold equal. Those are
   * DIFFERENT names, and the copy must not tell a parent their child is already in the app when they
   * are not. Showing the stored spelling beside what they typed is what makes a false positive
   * obvious at a glance.
   */
  duplicateLive: (stored: string, kind: string) =>
    `That looks like ${stored} (${kind}), who is already on your list.`,
  duplicateArchived: (stored: string, kind: string) =>
    `That looks like ${stored} (${kind}), who is in your archived athletes.`,
  /**
   * 🔴 **Split out of `duplicateArchived`, and rendered only when the kinds AGREE.** A UX lens read
   * the composed kinds-differ message and found it sold Restore in the sentence immediately before
   * the sentence warning that Restore is permanent and wrong: "…Restoring brings back everything
   * they logged. Ada is saved as Adult, and that can't be changed." The plan's C7 asks that neither
   * option be given primacy, and a benefit stated first is primacy. When the kinds differ this is
   * omitted, so the parent reads the constraint and chooses; when they agree it is the reason Restore
   * is the better option and belongs.
   */
  duplicateArchivedRestoreNote: 'Restoring brings back everything they logged.',
  /**
   * 🔴 The kinds-differ case, which a UX lens found by reading this screen against its OWN recovery
   * copy. `kindRecoveryOwnerAfter` tells a parent who picked the wrong kind to archive and add again
   * — they do, come back, and would be offered **Restore**, which brings back the wrong kind
   * permanently. So when the archived twin's kind differs from the one just chosen, say it plainly
   * and give neither option primacy.
   */
  duplicateArchivedOtherKind: (stored: string, storedKind: string, chosenKind: string) =>
    `${stored} is saved as ${storedKind}, and that can’t be changed. You chose ${chosenKind}.`,
  /** Tiles show name + kind only, so two "Sam" Child tiles are indistinguishable. */
  /**
   * ⚠️ **Only true when the two names are spelled IDENTICALLY.** The fold is lossy, so a match can be
   * `José` against a typed `Jose` — those render as two different tiles, and telling a parent "both
   * will show as José" would be false in exactly the false-positive case the hedging exists for. The
   * caller gates on an exact comparison.
   */
  duplicateDisambiguate: (stored: string) =>
    `Both will show as “${stored}”. Add an initial, like “${stored} B.”, to tell them apart.`,
  /**
   * 🔴 **The RENAME form's sentence, and it is not the add form's** (PROF-1 a-1d-ren). Under an
   * `<h1>` reading "Rename Ada", with "Ada" in the field, `duplicateLive`'s "…who is already on your
   * list" is read as *"yes, I know, I'm renaming her"* — on add the parent had nobody in mind; on
   * rename they have one person firmly in mind, and the match is somebody else. A UX lens caught it
   * before any code. The hedge ("looks like") is kept for the same lossy-fold reason as the add copy.
   */
  renameDuplicateLive: (stored: string, kind: string) =>
    `Another athlete looks like they’re already called ${stored} (${kind}).`,
  /**
   * The archived case on rename. ⚠️ **Nothing about Restore**, which this screen cannot offer — you
   * are renaming somebody *else*, so restoring the match would neither finish nor abandon the edit —
   * and nothing about "your list", because an archived athlete is not on it. The consequence is the
   * only reason to warn at all, so the sentence carries it.
   */
  renameDuplicateArchived: (stored: string, kind: string) =>
    `An archived athlete is also called ${stored} (${kind}). If they’re restored later, both will ` +
    `show as “${stored}”.`,
  /** The one choice the rename callout offers. "Save anyway" over "Save name anyway": shorter at
   * 360px, and the callout's own sentence already supplies the object. */
  saveAnyway: 'Save anyway',
  /**
   * The routes OUT, named with what they PRESERVE. The back route means something reassuring here
   * that it did not on add — the athlete keeps the name they already have — so the sentence says so
   * rather than just pointing at a link.
   *
   * 🔴 **Two variants, because the disambiguation line already says how to change the name.** When
   * it renders, it ends "…add an initial, like “Ada B.”, to tell them apart" — and the first version
   * of this sentence then opened "To tell them apart, change the name", repeating the phrase in
   * adjacent sentences and re-advising what was just advised. Caught by LOOKING at the capture, not
   * by a test; the same way the add form's at-cap contradiction surfaced.
   */
  renameDuplicateRoutes: (stored: string, alreadyAdvised: boolean) =>
    alreadyAdvised
      ? `Or go back — ${stored} keeps their name.`
      : `Change the name, or go back — ${stored} keeps their name.`,
  /**
   * The stale-rename fix (maintainer, 2026-11-20, option c): the form showed an out-of-date name, so
   * nothing was saved. It names the stored name, both routes out, and the button that overwrites
   * ("Save anyway", `saveAnyway`, the duplicate warning's own label), so the overwrite is a deliberate,
   * differently labelled tap. "Go back" is the page's Back link, which keeps the stored name.
   */
  renameStale: (stored: string) =>
    `Not saved. This name was changed to “${stored}” on another device. Save anyway to replace it, or go back to keep it.`,
  addAnother: (name: string) => `Add another ${name}`,
  openMatch: (name: string) => `Open ${name}`,
  restoreMatch: (name: string) => `Restore ${name}`,
  addNewInstead: (name: string, kind: string) => `Add a new ${name} (${kind}) instead`,
  /** `restoreAthleteAction`'s own failure copy is "No athlete found to save.", nonsense here. */
  restoreFailed: (name: string) => `Couldn’t restore ${name}. Try again.`,
  /**
   * The submit's pending label. ⚠️ **Not `SAVING_LABEL`** ("Saving…"): this screen adds, and the two
   * labels on one button ("Add athlete" → "Saving…") describe different acts. `SAVING_LABEL` stays
   * the rename form's, where it is correct.
   */
  adding: 'Adding…',
  /** The one submit. Named for what it saves, so it still reads correctly beside a 40-char name. */
  save: 'Save name',
  /** Shown in a `role="status"` region after a successful rename, before the page navigates back. */
  saved: 'Name saved.',
  /** The day page's link to this screen, and the spec that locates it. One definition. */
  renameLink: (name: string) => `→ Rename ${name}`,
  /** The rename screen's way back to the athlete. */
  backTo: (name: string) => `← ${name}`,
} as const;

/**
 * Household settings' copy (PROF-1 b).
 *
 * 🔴 **`archiveHelp` is PERMANENT and sits under the Athletes heading**, not in the Archived
 * section's empty state where the plan first put it. The UX trust lens's finding: an explanation
 * that lives in an empty state **disappears the moment anyone is archived**, i.e. exactly when a
 * second person needs it — and it sat below the control it explains, under a different heading. A
 * parent is being asked to take a kid off everyone's picker from a bare verb.
 *
 * `ownerOnly` takes the SAME slot for a member, because a member looks for the missing Archive where
 * the athletes are, not under "Archived".
 *
 * ⚠️ **"The person who set up this household", never a name.** `household_members` stores
 * `clerk_user_id` and `role` and no name or email (`schema.ts`), and the DAL reads no Clerk profile
 * fields — so the app *cannot* say who the owner is. Copy implying it could would be a promise the
 * data model cannot keep.
 */
export const SETTINGS_COPY = {
  heading: 'Household settings',
  athletes: 'Athletes',
  archived: 'Archived',
  archiveHelp:
    'Archiving hides an athlete from the picker. Everything they logged is kept, and you can restore them below.',
  ownerOnly: OWNER_ONLY_ATHLETE,
  /** The Archived section when there is nothing in it. Short, because `archiveHelp` carries the meaning. */
  archivedEmpty: 'None.',
  /** The picker's way in. An arrow, so it reads as navigation rather than as a setting. */
  navLink: 'Household settings ›',
  archivedCount: (n: number) => `${n} archived`,
  archive: 'Archive',
  restore: 'Restore',
  edit: 'Edit',
  archiveFor: (name: string) => `Archive ${name}`,
  restoreFor: (name: string) => `Restore ${name}`,
  editFor: (name: string) => `Edit ${name}`,
  /**
   * The result line after an archive. 🔴 **It does NOT say "and still exports"**, which the plan's
   * first draft did. `lib/dal/export.ts` writes a header-only check-ins file, and
   * `docs/privacy/notice.md` already lists five things the app logs that the export omits. "Kept" is
   * true; "still exports" is true only of the half that was ever exported.
   */
  archivedResult: (name: string) => `${name} archived. Everything they logged is kept.`,
  restoredResult: (name: string) => `${name} is back.`,
  /** Names what it undoes, so a screen-reader user hears which action this button reverses (A11Y-5). */
  undoLabel: (name: string) => `Undo archiving ${name}`,
  /** The day page's pointer back to the recovery, when the athlete it shows is archived. */
  archivedNotice: (name: string) =>
    `${name} is archived. Nothing new can be logged. Restore them in`,
  /** The edit screen's pointer, since archive is not on that form. */
  archiveElsewhere: 'To archive an athlete, use',
} as const;

/**
 * The export control's label — **one definition, two surfaces** (PROF-1 b).
 *
 * 🔴 The day page already renders this exact artifact as "↓ Export CSV"
 * (`app/p/[profileId]/page.tsx`) while the settings row was specified as "Download history" — two
 * names for one file, which is also an SC 2.5.3 (Label in Name) problem: a voice-control user saying
 * the visible label would miss an `aria-label` built from the other wording. And "history" claims
 * more than the zip contains.
 */
export const EXPORT_CSV_LABEL = '↓ Export CSV';

/**
 * The Undo button's visible label, and the attribute the island finds it by (PROF-1 b).
 *
 * `UNDO_LABEL` was a literal in `undo-line.tsx` beside a dead `SETTINGS_COPY.undo` that nothing could
 * reach, plus a third copy in `strength-form.tsx` — a reuse lens's find.
 *
 * `ANNOUNCE_AFTER_FOCUS_MS` is the gap between moving focus and changing the live region. A
 * synchronous focus change makes VoiceOver speak the focused element and commonly suppresses a
 * pending `polite` region, so the announcement has to land a beat later. 60ms is the approved
 * prototype's own value, not a fresh guess.
 */
export const UNDO_LABEL = 'Undo';

/**
 * The rename field's error id — module-private in `rename-form.tsx` until the e2e needed to scope an
 * assertion to it (`getByRole('alert')` is ambiguous once Next's route announcer mounts). This is the
 * moment it gained a second consumer, which is the trigger AGENTS.md names.
 */
export const NAME_ERROR_ID = 'athlete-name-error';
export const UNDO_BUTTON_ATTR = 'data-undo-button';
export const ANNOUNCE_AFTER_FOCUS_MS = 60;

/**
 * The app shell's nav rail (`UI-5`).
 *
 * 🔴 **`settings` is "Settings", deliberately NOT `SETTINGS_COPY.heading` ("Household settings").**
 * The archived day page, `/p/new` and `/edit` each render that phrase as a prose link, and two
 * visible links with the same accessible name on one page is the Playwright strict-mode collision
 * #333 already shipped once. ⚠️ This is the one place that reasoning lives — `nav-rail.tsx` and the
 * shell's test point here rather than restating it.
 *
 * `athletes` reads {@link SETTINGS_COPY}'s word rather than a second copy of it: it is the same
 * label over the same list of live athletes, and `/settings` renders both at `lg`.
 */
export const NAV_RAIL_COPY = {
  label: 'Primary',
  athletes: SETTINGS_COPY.athletes,
  settings: 'Settings',
  skipToContent: 'Skip to content',
} as const;

/**
 * The shell's `<main>` id — the skip link's target, and what `sheet.tsx` resolves its focus
 * fallback by. Named once because those two files must agree.
 */
export const MAIN_CONTENT_ID = 'main';

/**
 * Why the export control is disabled for an athlete who has logged nothing — **maintainer decision
 * N3** _(2026-11-08)_: "we should probably surface some error in the UI if there is nothing to
 * export."
 *
 * Without it, `lib/dal/export.ts` builds `buildZip([])`, an EOCD-only archive that iOS Files opens
 * as nothing — indistinguishable from a download that failed. The settings page already counts each
 * athlete's rows (`hasHistory`), so stating the reason costs a prop.
 */
export const NOTHING_TO_EXPORT = 'Nothing logged yet, so there is nothing to export.';

/**
 * Typed-error copy shared by every amend path (V1-24 PR 1b).
 *
 * `editStrengthSetAction` had `'That set could not be found.'` inline; a second amend surface would
 * have re-worded the same failure. One place, so the two cannot answer it differently.
 */
const entriesText = (n: number) => plural(n, { one: '1 entry', other: `${n} entries` });

/**
 * Clear this day and its banner (V1-9b B2-ii; plan `v1-9b-delete-and-restore.md` § "B2 as amended",
 * the Amendment of 2026-11-15 as corrected there). Words for "hidden", never "deleted": nothing is
 * erased, and Restore all brings it back.
 *
 * - **The deadline is relative words**, from `restoreDeadline` (`lib/entries/restore-deadline.ts`):
 *   "the end of tomorrow" cannot be misread as the start of a day.
 * - **The summary counts, never names a value.** `other` is "entries this page doesn't show" (an
 *   older strength session, a check-in), not "earlier", which reads as earlier days.
 * - ⚠️ **`count` from the action is the day's newest clear's**, not what one tap hid, so no line
 *   here says "you hid n": the banner reads the day's clears itself.
 */
export const CLEAR_DAY_COPY = {
  trigger: 'Clear this day…',
  /** The dialog's title, with the day's short date ("Clear Wed, Nov 19?"). */
  title: (dateLabel: string) => `Clear ${dateLabel}?`,
  deadline: { today: 'the end of today', tomorrow: 'the end of tomorrow' } satisfies Record<
    RestoreDeadline,
    string
  >,
  /**
   * The consequence, said BEFORE the step: the deadline, and that a re-log in an entry's place keeps
   * it from coming back. "Logged for", not "logged by": a clear is most often of a day logged on the
   * wrong athlete. `parts` are the summary's pieces, already phrased.
   */
  body: (name: string, parts: readonly string[], deadline: string) =>
    `This hides the entries logged for ${name} today, for everyone in your household: ${formatList(
      parts,
    )}. You can put them back with Restore all until ${deadline}, unless something new is logged ` +
    `in their place first.`,
  /**
   * When the day holds a workout or an older session: its record outlives a clear (PRIV-3 req. 2).
   * "Any note" covers a "How did it feel?" note on an older session without naming a box no page
   * shows any more (the strength form went in #725).
   */
  sessionStays:
    'Workout names, and any notes written with them, stay with the day; only the entries are hidden.',
  summaryWorkout: (name: string, count: number) => `${name} (${entriesText(count)})`,
  summaryWeighIns: (n: number) => plural(n, { one: 'bodyweight', other: `${n} weigh-ins` }),
  summaryPractices: (n: number) =>
    plural(n, { one: 'wrestling practice', other: `${n} wrestling practices` }),
  summaryOther: (n: number) =>
    plural(n, {
      one: '1 entry this page doesn’t show',
      other: `${n} entries this page doesn’t show`,
    }),
  /** The input's label; the word is `CLEAR_DAY_CONFIRM_WORD`, rendered bold by the dialog. */
  confirmLabel: { before: 'Type ', after: ' to confirm' },
  confirmFirst: (word: string) => `Type ${word} first.`,
  action: 'Clear day',
  pending: 'Clearing…',
  nothingLeft: 'Nothing was left to clear.',
  /** Restore all's banner, for the newest clear of an open day. */
  banner: (n: number, deadline: string) =>
    plural(n, {
      one: `Day cleared. 1 entry is hidden. You can put it back until ${deadline}.`,
      other: `Day cleared. ${n} entries are hidden. You can put them back until ${deadline}.`,
    }),
  /** The same, once the day has been logged again since the clear. */
  bannerRelogged: (n: number, deadline: string) =>
    plural(n, {
      one: `1 entry from a clear is hidden. You can put it back until ${deadline}.`,
      other: `${n} entries from a clear are hidden. You can put them back until ${deadline}.`,
    }) + ' Anything logged in its place since stays, and what it replaced won’t come back.',
  earlier: (m: number) =>
    `${plural(m, { one: '1 more', other: `${m} more` })} from an earlier clear ${
      m === 1 ? 'is' : 'are'
    } hidden too; you can restore ${m === 1 ? 'it' : 'them'} after these.`,
  restoreAll: 'Restore all',
  /** When "all" would be untrue: an earlier clear, or a day logged again since. */
  restoreN: (n: number) => `Restore ${entriesText(n)}`,
  restoring: 'Restoring…',
  restored: 'Day restored.',
  restoredSome: (r: number, k: number) =>
    `Restored ${r}. ${plural(k, {
      one: '1 wasn’t, because the day already has one in its place.',
      other: `${k} weren’t, because the day already has one in each place.`,
    })}`,
  restoredNone: 'None came back: the day already has an entry in each place.',
  /** A restore of the newest clear, with an older one left (it is the banner now). */
  /** A partial restore of the newest clear, with an older one left (it is the banner now). */
  restoredSomeOlderLeft: (r: number, k: number, m: number) =>
    `Restored ${r}. ${plural(k, {
      one: '1 wasn’t, because the day already has one in its place.',
      other: `${k} weren’t, because the day already has one in each place.`,
    })} ${entriesText(m)} from an earlier clear ${m === 1 ? 'is' : 'are'} still hidden.`,
  restoredOlderLeft: (r: number, m: number) =>
    `Restored ${r}. ${entriesText(m)} from an earlier clear ${m === 1 ? 'is' : 'are'} still hidden.`,
  nothingToRestore: 'Nothing left to restore.',
  /** The closed day's cleared sentence, inside the page's one notice box. */
  closedCleared: (n: number) =>
    plural(n, {
      one: 'This day was cleared: 1 entry is hidden. It is kept, not erased.',
      other: `This day was cleared: ${n} entries are hidden. They are kept, not erased.`,
    }),
  /**
   * An archived athlete on a day still open for Restore all: the control is "Restore {name}" in
   * Household settings (`SETTINGS_COPY.restoreFor`), then Restore all here.
   */
  archivedCleared: (name: string, n: number, deadline: string) =>
    `This day was cleared: ${entriesText(n)} hidden, not erased. ${SETTINGS_COPY.restoreFor(
      name,
    )} in ${SETTINGS_COPY.heading}, then tap Restore all here before ${deadline} to bring ${
      n === 1 ? 'it' : 'them'
    } back.`,
  /**
   * One line per refusal word (`DAY_CLEAR_REFUSALS`), for both actions. Not `components/day`'s
   * `refusalCopy`: that is keyed by a row's write kind (a ✓, an un-tick, a Change), and a clear is none.
   * Each is true for every cause of its word (`not_found` is also a lapsed session).
   */
  refused: {
    bad_value: 'That didn’t go through. Try again.',
    not_found: NOT_SAVED_RELOAD,
    closed_day: 'This day is locked now, so nothing was restored.',
    retry: 'Too many changes at once. Wait a moment and try again.',
  } satisfies Record<DayClearRefusal, string>,
  /**
   * Clear this day's own `closed_day` line. Not `refused.closed_day` (Restore all's: "This day is
   * locked now, so nothing was restored."): a clear refused just after midnight is of a day that is
   * now yesterday, still open to every other write and to Restore all, so "locked" would be false.
   * Names both causes, since the answer cannot tell them apart: past midnight, or the athlete
   * archived (the writer's own check, since the archive-race fix).
   */
  clearClosed: 'This day can’t be cleared now: only today can, and not for an archived athlete.',
  /** The action threw (a dropped connection, a server error): no cause is claimed. */
  failed: 'Couldn’t reach the app. Try again.',
} as const;

/** The ids the clear's two islands share: the hand-off's target and the banner's outcome line. */
export const RESTORE_ALL_ID = 'clear-day-restore-all';
export const CLEAR_DAY_OUTCOME_ID = 'clear-day-outcome';

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
  /**
   * A change or a clear of a value on a day the page no longer offers (V1-24 3b-bw, plan W8). Not
   * the logging copy ("That day is locked now. Reload the page."): nothing was being logged, and the
   * action has already revalidated the page, whose notice (closed-day or archived) gives the reason.
   */
  dayReadOnly: (subject: string) => `That day is locked now, so the ${subject} wasn't changed.`,
} as const;
