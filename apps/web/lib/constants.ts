import {
  MAX_HOUSEHOLD_ATHLETES,
  isMassUnit,
  LOGGABLE_DIMENSION_NOUNS,
  type Unit,
  UNIT_DIMENSION,
  UNIT_DIMENSION_BY_CODE,
  type UnitDimension,
  UNIT_LABELS,
} from '@mat-plan/shared';

/**
 * App-only, cross-feature constants. **No server or IO dependencies** — only `@mat-plan/shared`'s
 * pure values — so it is safe to import from a `'use client'` component, from the Edge proxy, and
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
 * `signInFallbackRedirectUrl` props** (`app/layout.tsx`) rather than a second copy in
 * `NEXT_PUBLIC_CLERK_SIGN_IN_URL`. Clerk reads those env vars when they are set, which is exactly how
 * the route would silently drift from this constant; passing props keeps one definition.
 */
export const SIGN_IN_PATH = '/sign-in';

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

/** The profile picker's copy — one source for the page and the specs that land on it. */
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
 * `BODYWEIGHT_COPY.duplicates` / `AMEND_COPY.locked` family — this comment used to cite
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

export const QUIET_LINK_CLASS =
  'text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 items-center rounded-sm text-sm underline underline-offset-4 outline-none focus-visible:ring-3';

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
  orderHeading: 'Routine order',
  save: 'Save routine',
} as const;

/** The `tz` cookie's lifetime (seconds) — 1 year. Two consumers, both writing that one cookie:
 *  `app/p/[profileId]/tz-sync.tsx` and `scripts/capture.ts`. ⚠️ Said "shared by the access-gate
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
 */
export const PAGE_SHELL_CLASS = 'mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12';

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
 * `saved` is a **statement of fact**, not praise — the `SAVED_STATE_COPY` / `PICKER_EMPTY_COPY`
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
   * The per-option consequences (PROF-1 a-1u). **Parallel, and BOTH always render.**
   *
   * 🔴 **The first version hid the child's consequence at first run**, which a UX lens caught: with no
   * household program the kid line was dropped entirely, so the screen read "Child" next to
   * "Adult — logs their own training" — in front of the form's main audience, implying children do
   * not log. Both options now always say what the athlete's training FOLLOWS, which is the only fact
   * that separates them.
   *
   * ⚠️ `kidWithProgram` vs `kidFirstRun`: the household's program is the real difference, but a
   * first-run household has none, so claiming one would be false. The first-run wording describes the
   * same rule by what the parent will do instead.
   */
  kidWithProgram: 'trains on the household’s program',
  kidFirstRun: 'follows the routine you save for them',
  /** Never "no household program" — at first run there is none, which makes the negation confusing. */
  adultConsequence: 'trains on their own',
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
   * The routes OUT, named with what they preserve. The back route means something reassuring here
   * that it did not on add — the athlete keeps the name they already have — so the sentence says so
   * rather than just pointing at a link.
   */
  renameDuplicateRoutes: (stored: string) =>
    `To tell them apart, change the name. Or go back and ${stored} keeps their name.`,
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
  archivedNotice: (name: string) => `${name} is archived. Restore them in`,
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
