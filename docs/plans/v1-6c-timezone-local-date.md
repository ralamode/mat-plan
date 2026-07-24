# V1-6c — timezone / local-calendar-date correctness

> Backlog: [plan.md](../plan.md) row **V1-6c** (correctness fix; prerequisite of V1-6b-2). Branch: `fix/v1-6c-timezone-local-date`.

> **Scope decision up front (read this first).** This is a **pure correctness fix**: the daily workout
> must follow the child's **active local calendar date** in an IANA timezone, not UTC. It is **NOT a
> feature** and it **must land before V1-6b-2**, because the ramp UI computes ISO-week boundaries from
> "local today" — if "today" is wrong (UTC), every week boundary and adherence window inherits the bug.
> **No migration, no schema change, no new dependency.** The active tz reaches the server via a small
> client-written, non-httpOnly `tz` cookie — the correct, cheapest transport for a **non-secret** value
> (no Server Action round-trip; the RSC validates it). This is a _new_ mechanism, not a reuse of the
> access-gate cookie (server-written + httpOnly); what it mirrors is the **module shape** of
> `lib/access-gate.ts` — a zero-dep constants module the client/edge can import. The optional
> **household-timezone override** is a resolver seam only — the actual `households.timezone`
> column/migration/UI is **deferred**, and landing it is its own signature-changing refactor (D1 /
> out-of-scope), so this PR stays a zero-DDL correctness fix.

## Goal

The app picks the child's daily workout from `apps/web/lib/date.ts` → `todayIso()` =
`new Date().toISOString().slice(0,10)`, which is **UTC**. In Pacific time UTC rolls to the next
calendar day at ~5pm local, so the app shows _tomorrow's_ workout in the afternoon and the Today
header (`formatDayLong`, `timeZone:'UTC'`) shows the wrong weekday. This PR makes "today" the **local
calendar date in the active IANA timezone**, computed identically on the server (RSC + Server Actions)
and reflected on the client, using only the platform `Intl` API — **no manual offset/DST math, no new
library**.

Ray's brief (the governing spec — its acceptance criteria are honored below):

> Guiding rule: **use the active IANA timezone to determine calendar dates & weekdays; use UTC only for
> exact moments (timestamps).** Detect the device tz via `Intl.DateTimeFormat().resolvedOptions().timeZone`;
> support an optional household/schedule timezone override that wins when set. Determine "today" as the
> local calendar date in the active tz — never `new Date().toISOString().slice(0,10)`, never assume the
> server's tz, never manual offset math. Date-only values (`2026-07-24`) are calendar dates, NOT UTC
> instants — avoid `new Date("2026-07-24")` (parsed as midnight UTC). The date and weekday must come from
> the SAME tz-aware calc so you can't get "Date: Monday / Plan: Tuesday". Client determines/knows the
> active tz and provides it when requesting timezone-dependent daily info; the server validates the
> supplied IANA tz and uses it consistently (not UTC / not its own tz / not IP-geo). Historical workout
> days must stay STABLE across timezone changes (travel): the current day follows the active tz, but
> previously recorded assignment dates don't move. Don't assume 24-hour days (DST spring-forward/fall-back,
> Arizona/Hawaii no-DST); use platform `Intl`/`Temporal` or a maintained tz library — no manual DST math.

## Acceptance

**Backlog criterion (plan.md V1-6c), verbatim:** _"The daily workout follows the user's active local
calendar date (IANA timezone), not UTC; date & weekday always agree; historical dates are stable across
travel; exact timestamps stay UTC."_

Ray's 12 criteria, made concrete/testable (each maps to a test in the [Test plan](#test-plan)):

1. **Monday stays Monday all day (PT).** At any instant whose Pacific local date is Monday, the page's
   selected `day` and header weekday are Monday, through to local midnight. →
   `localDayIso('America/Los_Angeles', 2026-07-21T00:30Z)` (= Mon 17:30 PDT) `=== '2026-07-20'`.
2. **No 4–5pm flip to Tuesday.** At `2026-07-21T00:30Z` (Mon 17:30 PDT) the old `todayIso()` returns
   `'2026-07-21'` (Tue); `localDayIso(Pacific,…)` returns `'2026-07-20'` (Mon). Regression asserted directly.
3. **Date & weekday always agree.** Both derive from the single `day` value (`day = localDayIso(tz)`,
   header = `formatDayLong(day)`); `formatDayLong` renders the weekday **of that same date-only value**,
   so "Monday / Tuesday" split is structurally impossible.
4. **Works in DST + standard time.** `localDayIso` uses `Intl` (never manual offset), verified at
   spring-forward (2026-03-08) and fall-back (2026-11-01) local-midnight boundaries.
5. **US travel doesn't alter historical dates.** `activity_date` is a stored plain `DATE`;
   `listEntriesForDay(day)` filters by the passed `day` and **never recomputes/rewrites** it on read.
6. **Date-only assignments not shifted by JS UTC parsing.** No `new Date("YYYY-MM-DD")` anywhere;
   `localDayIso` builds the string from `formatToParts`, `formatDayLong` anchors at `…T00:00:00Z` and
   formats in UTC (a calendar date's weekday is tz-invariant — see design note D2).
7. **Exact timestamps stay UTC.** Untouched: `created_at`/`deleted_at` are `timestamptz DEFAULT now()`.
8. **Refresh doesn't change the workout day vs the phone's local calendar.** The `tz` cookie is stable
   once written; SSR reads it and computes the same `day` on every render.
9. **Client & server SSR agree on the current workout date.** The RSC and **all three writers** (check-in,
   bodyweight, strength) attribute to the **rendered** `day` — each form threads the hidden `day` and each
   action validates it against `getActiveLocalDay()` with the shared ±1 bound (R5), so a weigh-in can never
   land on a date the header didn't show, even across a local-midnight session. First-render mismatch is
   corrected by one `router.refresh()` (design D1). _Caveat (R7): the ±1 bound assumes the **supported US
   zones** (crit 5); a detected zone ≥2 days from `DEFAULT_TIME_ZONE` during the first-visit-while-traveling
   window could reject a legit submission — out-of-scope global hardening._
10. **Tests cover just-before/after local midnight.** `06:59Z`/`07:01Z` around Pacific local midnight
    (2026-07-24 00:00 PDT = 07:00Z).
11. **Tests cover UTC-already-tomorrow-but-local-not.** `2026-07-24T06:59Z`: UTC date `'2026-07-24'`,
    Pacific local `'2026-07-23'`.
12. **Tests cover Pacific, Eastern, Arizona, Hawaii, DST transitions.** Enumerated matrix below.

Done when: all of the above hold; `todayIso()` is removed and every caller uses the tz-aware path; all
gates green (typecheck · lint · prettier · vitest · `db:verify` · `next build` · e2e); header
screenshots at mobile/tablet/desktop show the correct **local** weekday.

## Migration: **NOT needed**

No `schema.ts` change, no migration file. The active tz comes from the client (the `tz` cookie); it is
never persisted. `activity_date` (plain `DATE`), `created_at`/`deleted_at` (`timestamptz`, UTC) are all
unchanged. The **household-timezone override** (`households.timezone`, nullable, IANA-validated) is an
**additive follow-up**; this PR builds the `getActiveTimeZone()` seam so the override plugs in later
with zero refactor, but ships **no DDL**.

## Design decisions (positions taken)

**D1 — How the active tz reaches the server (the crux).** A tiny `'use client'` component
(`tz-sync.tsx`) reads `Intl.DateTimeFormat().resolvedOptions().timeZone` on mount and writes a
non-httpOnly `tz` cookie (`document.cookie`, `path=/`, `SameSite=Lax`, `COOKIE_MAX_AGE`). The tz carries
no secret, so a **client** write (not a Server Action round-trip) is correct and cheapest. The RSC reads
`cookies().get('tz')`, **validates it is a real IANA zone**, and computes the day with it. _(This is a
new client-cookie mechanism — the panel confirmed the repo has no client `document.cookie` precedent; the
`mp_gate` cookie is server-written + httpOnly. It's the right call on its own merits, not by lineage.)_

> **Household-override seam — honest scope (panel R4).** `getActiveTimeZone()` ships zero-arg /
> cookie-only, with a hardcoded `DEFAULT_TIME_ZONE`. A future `households.timezone` override that _wins
> when set_ is **not** a free plug-in: it needs household context (`profileId` → household, available in
> each caller via `getProfileByPublicId`), becomes DB-touching (wants a `React cache()` wrap to avoid
> repeat lookups per interaction), and inverts the precedence to **household-primary + cookie-fallback**.
> That override PR will change `getActiveTimeZone`'s signature and touch all four tz call sites (page + 3
> actions). This PR builds the _correct place to resolve tz_, not a zero-refactor seam.

- **First-render trade-off, handled honestly.** On the very first visit (no cookie) or during SSR, the
  server has no client tz, so it falls back to `DEFAULT_TIME_ZONE` (= `'America/Los_Angeles'`, the
  household's zone — chosen so the _actual users'_ first paint is already correct). The RSC passes the
  tz it used into `tz-sync` as `serverTimeZone`. After hydration, `tz-sync` compares the **detected** tz
  to `serverTimeZone`; if they differ (traveler on first visit, or a stale cookie after travel) it writes
  the cookie **and calls `router.refresh()`**, so the workout day corrects to the phone's local calendar.
  When they match (the common case for the Pacific household, and every subsequent visit), **no refresh**
  — no flicker. This is the key architectural risk; the mitigation (default = household zone +
  refresh-only-on-mismatch) bounds the visible flicker to _first visit while traveling to a different US
  zone_, corrected within one refresh.

**D2 — Shared helpers + a zero-dep constants module (panel R1/R9).** The two tz constants
(`TZ_COOKIE_NAME`, `DEFAULT_TIME_ZONE`) plus the shared `COOKIE_MAX_AGE` live in a **new zero-dep
`apps/web/lib/constants.ts`** — _not_ in `date.ts`, because `date.ts:10` runs `z.iso.date()` at module
load (a top-level call bundlers won't tree-shake), so the client `tz-sync.tsx` importing a constant from
`date.ts` would drag `zod` into the client chunk (a first-class CWV concern). The zero-dep module mirrors
`lib/access-gate.ts`'s shape. `date.ts` keeps only the pure date _functions_:

- `localDayIso(timeZone, now?)` — the local calendar date via `Intl.DateTimeFormat('en-CA',
{timeZone, …}).formatToParts` (assembled from parts — engine-proof, no reliance on a locale's format
  string, no `toISOString`, no manual offset).
- `isIanaTimeZone(tz)` — validation via `try { new Intl.DateTimeFormat('en-US',{timeZone:tz}) } catch
{ false }` (throws `RangeError` on an unknown zone; portable, no dependency on `Intl.supportedValuesOf`).
- `formatDayLong(iso)` — **kept exactly as-is (UTC-anchored, formatted in UTC), NOT given a `timeZone`
  param.** **Position / pushback on the brief:** a bare calendar date has exactly one weekday regardless
  of tz; anchoring at `…T00:00:00Z` and formatting in UTC yields that weekday correctly and
  tz-invariantly. Adding a `timeZone` param and re-interpreting the date-only value through a zone would
  _reintroduce_ the off-by-one (`'2026-07-24'` in LA → "Wednesday, July 23"). The tz belongs in computing
  `day` (`localDayIso`), never in formatting it. This is why criterion 3 needs **no** separate
  `localWeekday` helper — the weekday is already part of `formatDayLong(day)`, and both come from the one
  tz-aware `day`.
- `getActiveTimeZone()` / `getActiveLocalDay(now?)` — server-only (`lib/active-timezone.ts`): household
  override (deferred seam) → validated `tz` cookie → `DEFAULT_TIME_ZONE`.
- **Reused, not duplicated:** `isoDayDiff` and `isoDaySchema` are unchanged and keep doing the check-in
  ±1 bounding; `localDayIso` just replaces `todayIso()` as the value they compare against. `todayIso()`
  is **removed** (no legitimate caller needs a UTC calendar date).

**D3 — `now`-injectability + testability.** Every pure helper (`localDayIso`, `formatDayLong`,
`isIanaTimeZone`) is dependency-free and takes an injectable `now`/`iso`, so the entire acceptance matrix
is fast pure unit tests. The server helpers are tested by mocking `next/headers`' `cookies()`.

**D4 — Migration? No.** Core fix is cookie-only. Household override deferred (seam present).

**D5 — SSR agreement + historical stability.** The RSC `day`, the check-in form's hidden `day`, and all
three Server Actions compute from the **same** cookie tz via `localDayIso`. `activity_date` is stored and
never recomputed on read → travel can't move past days.

**D6 — Library vs platform.** `Intl` is sufficient and already present in Node ≥18 / all target
browsers. **Zero new dependencies** — no `date-fns-tz`, no `Temporal` polyfill.

**D7 — Determinism for e2e/screenshots.** Pin the Playwright context `timezoneId` to `DEFAULT_TIME_ZONE`.
Because the server default equals the pinned browser tz, first render already matches → `tz-sync` writes
the cookie but does **not** refresh → no refresh-induced flake. The seed for screenshots uses
`localDayIso(DEFAULT_TIME_ZONE)` so seeded rows land on the same day the page renders.

## File-by-file changes

| Path                                                                   | Change          | What & why                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/constants.ts`                                            | NEW (~8)        | **Zero-dep** (mirrors `lib/access-gate.ts`): `TZ_COOKIE_NAME`, `DEFAULT_TIME_ZONE`, `COOKIE_MAX_AGE`. The single import source for the client `tz-sync`, `active-timezone.ts`, `date.ts`, playwright config, screenshot script, and `gate/actions.ts` — so no `zod` reaches the client chunk and the 1-yr max-age isn't duplicated (R1/R3).              |
| `apps/web/app/gate/actions.ts`                                         | EDIT (~+1/−1)   | Import `COOKIE_MAX_AGE` from `lib/constants` instead of the local `const` (R3). No behavior change.                                                                                                                                                                                                                                                      |
| `apps/web/lib/date.ts`                                                 | EDIT            | Add `localDayIso(timeZone, now?)`, `isIanaTimeZone(tz)`. **Remove `todayIso`.** Import (don't define) the constants from `lib/constants`. Keep `isoDayDiff`, `isoDaySchema`, `formatDayLong` (doc: it renders a calendar date's weekday and must be fed the LOCAL day; no `timeZone` param, by design). Rewrite the header (UTC → active-IANA-tz model). |
| `apps/web/lib/date.test.ts`                                            | EDIT            | Replace the `todayIso` suite with the full `localDayIso` matrix (Pacific/Eastern/Arizona/Hawaii + DST spring/fall + just-before/after local midnight + UTC-already-tomorrow), `isIanaTimeZone` cases, and a `formatDayLong`+`localDayIso` agreement test (crit 3).                                                                                       |
| `apps/web/lib/active-timezone.ts`                                      | NEW (~35)       | `import 'server-only'`. `getActiveTimeZone()` (household seam → validated `tz` cookie → default) + `getActiveLocalDay(now?)`. The single server entry point for "the active tz / local day for this request."                                                                                                                                            |
| `apps/web/lib/active-timezone.test.ts`                                 | NEW (~40)       | Mock `next/headers` `cookies()`: valid IANA cookie → returned; missing/garbage/`''` → `DEFAULT_TIME_ZONE`; `getActiveLocalDay` composes tz + `localDayIso`.                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/tz-sync.tsx`                               | NEW (~30)       | `'use client'` cookie writer. Detects device tz, writes `tz` cookie, `router.refresh()` **only** when `detected !== serverTimeZone`. Renders `null`.                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/page.tsx`                                  | EDIT (~+8/−3)   | `const timeZone = await getActiveTimeZone(); const day = localDayIso(timeZone);` (replaces `todayIso()`). `formatDayLong(day)` unchanged. Mount `<TimeZoneSync serverTimeZone={timeZone} />`.                                                                                                                                                            |
| `apps/web/app/p/[profileId]/actions.ts`                                | EDIT (~+10/−6)  | All three writers thread the **rendered** `day` + ±1 bound (R5), via one shared validator (below). Bodyweight/strength gain a hidden-`day` input like check-ins; each action validates `declaredDay` against `await getActiveLocalDay()`. Drop the `todayIso` import; keep `isoDayDiff`/`isoDaySchema`.                                                  |
| `apps/web/lib/checkins/declared-day.ts` (or nearest shared lib)        | NEW (~20)       | The **shared** "declared calendar day + ±1 bound" validator (R5) — one place the check-in dance lives, reused by all three actions; plus a tiny shared hidden-`day` form field so the three forms don't copy-paste it. Extracted so threading `day` everywhere stays DRY, not triplicated.                                                               |
| `apps/web/app/p/[profileId]/bodyweight-form.tsx` · `strength-form.tsx` | EDIT (~+2 each) | Add the shared hidden-`day` field (rendered `day` passed from `page.tsx`), mirroring `checkin-form.tsx`.                                                                                                                                                                                                                                                 |
| `apps/web/app/p/[profileId]/actions.test.ts`                           | EDIT (~+25/−8)  | **File-wide** `next/headers` `cookies()` mock (empty → default tz) — both stamp suites now resolve `getActiveLocalDay()`, not just check-ins (R8). Migrate the `:415` `day: todayIso()` assertion → `localDayIso(DEFAULT_TIME_ZONE)`. Add threaded-`day` + ±1 tests for bodyweight/strength (accept `today`/`today±1`, reject `today+2`).                |
| `apps/web/scripts/screenshot-ephemeral.ts`                             | EDIT (~+6/−3)   | Replace `todayIso()` (×2) with `localDayIso(DEFAULT_TIME_ZONE)` so seeded rows match the page's local day under the pinned tz.                                                                                                                                                                                                                           |
| `apps/web/playwright.config.ts`                                        | EDIT (~+2)      | Add `timezoneId: 'America/Los_Angeles'` (= `DEFAULT_TIME_ZONE`) to the `use` block — deterministic dates; matches the server default so no refresh flake.                                                                                                                                                                                                |
| `apps/web/e2e/*` (smoke)                                               | EDIT (~+5)      | Assert the header shows the expected local weekday for the seeded day, and that a reload keeps the same day (crit 8). Region-scoped, `exact: true` (lessons.md).                                                                                                                                                                                         |
| `docs/architecture.md`                                                 | EDIT            | One line in the date/data-model section: calendar dates use the active IANA tz (cookie-sourced); instants stay UTC.                                                                                                                                                                                                                                      |
| `docs/plan.md` · `docs/status.md`                                      | EDIT            | Add row V1-6c (correctness fix, prerequisite of V1-6b-2); link this plan; changelog + pointer.                                                                                                                                                                                                                                                           |
| `docs/plans/v1-6c-timezone-local-date.md`                              | NEW             | This plan.                                                                                                                                                                                                                                                                                                                                               |

**Deliberately NOT touched:** `packages/db/*` (no migration/seed/schema), `packages/shared/*` (tz is
per-request request-state, not seeded catalog data), the DAL read/write date handling (`activity_date`
threaded through unchanged).

### Expanded helper set — `apps/web/lib/date.ts`

The constants live in the new zero-dep `lib/constants.ts` (so the client `tz-sync` can import them
without pulling `zod` in via `date.ts`):

```ts
// apps/web/lib/constants.ts  — zero-dep, client/edge-safe (mirrors lib/access-gate.ts's shape)

/** IANA tz used before the client has reported one (first paint / cookie absent). The household is
 *  Pacific → first render is already correct for the real users; a traveler is corrected by tz-sync's
 *  refresh. App-local for now; promotes to packages/shared when households.timezone lands (R9). */
export const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

/** Non-httpOnly cookie the client writes with its detected IANA tz. */
export const TZ_COOKIE_NAME = 'tz';

/** 1 year — shared by the gate cookie (was gate/actions.ts) and the tz cookie (R3). */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
```

`lib/date.ts` keeps the pure functions only:

```ts
/** True iff `tz` is a resolvable IANA zone. Dependency-free: the Intl constructor
 *  throws RangeError on an unknown zone (more portable than Intl.supportedValuesOf). */
export function isIanaTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The LOCAL calendar date (`YYYY-MM-DD`) of `now`, in `timeZone`. Assembled from
 *  formatToParts (engine-proof) — NEVER toISOString().slice (UTC), NEVER new
 *  Date("YYYY-MM-DD"), NEVER manual offset math. `now` injectable for tests. */
export function localDayIso(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
```

### `apps/web/lib/active-timezone.ts` (NEW)

```ts
import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_TIME_ZONE, TZ_COOKIE_NAME } from '@/lib/constants';
import { isIanaTimeZone, localDayIso } from '@/lib/date';

/** Active IANA tz for THIS request: household override (DEFERRED seam) → validated
 *  `tz` cookie → DEFAULT_TIME_ZONE. Public cookie is never fed raw to Intl. */
export async function getActiveTimeZone(): Promise<string> {
  const cookieTz = (await cookies()).get(TZ_COOKIE_NAME)?.value;
  return isIanaTimeZone(cookieTz) ? cookieTz : DEFAULT_TIME_ZONE;
}

/** Today's LOCAL calendar date in the active tz — the tz-aware replacement for todayIso(). */
export async function getActiveLocalDay(now: Date = new Date()): Promise<string> {
  return localDayIso(await getActiveTimeZone(), now);
}
```

### `apps/web/app/p/[profileId]/tz-sync.tsx` (NEW)

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { TZ_COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/constants'; // zero-dep — no zod in the client chunk

/** Reports the device IANA tz to the server via the `tz` cookie so the RSC can compute
 *  the local day. Refreshes ONLY when the detected zone differs from the one the server
 *  rendered with (traveler's first visit / stale cookie) — otherwise no flicker. Renders nothing. */
export function TimeZoneSync({ serverTimeZone }: { serverTimeZone: string }) {
  const router = useRouter();
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected) return;
    document.cookie = `${TZ_COOKIE_NAME}=${detected}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    if (detected !== serverTimeZone) router.refresh();
  }, [serverTimeZone, router]);
  return null;
}
```

## Test plan

All Vitest under `apps/web` (`pnpm --filter web test`, sub-second, DAL/`next/headers` mocked); e2e in the
`e2e` job. `PDT=UTC-7`, `PST=UTC-8`, `EDT=UTC-4`, `MST(Arizona)=UTC-7 year-round`, `HST(Hawaii)=UTC-10
year-round`. Pacific local midnight `2026-07-24 00:00 PDT = 2026-07-24T07:00Z`.

| #   | Criterion                          | Assertion                                                                                                                                          |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | just-after local midnight (10)     | `localDayIso('America/Los_Angeles', 2026-07-24T07:01Z) === '2026-07-24'`                                                                           |
| 2   | just-before local midnight (10,11) | `localDayIso('America/Los_Angeles', 2026-07-24T06:59Z) === '2026-07-23'`; UTC date of that instant is `'2026-07-24'`                               |
| 3   | the headline 5pm bug (1,2,11)      | `localDayIso('America/Los_Angeles', 2026-07-21T00:30Z) === '2026-07-20'` (Mon 17:30 PDT), while `toISOString().slice(0,10) === '2026-07-21'` (Tue) |
| 4   | Eastern (12)                       | `localDayIso('America/New_York', 2026-07-21T00:30Z) === '2026-07-20'` (20:30 EDT)                                                                  |
| 5   | Arizona no-DST (12)                | `localDayIso('America/Phoenix', 2026-01-15T07:30Z) === '2026-01-15'` while Pacific `=== '2026-01-14'` (PST-8 vs MST-7 → distinct)                  |
| 6   | Hawaii no-DST (12)                 | `localDayIso('Pacific/Honolulu', 2026-07-24T07:30Z) === '2026-07-23'` while Pacific `=== '2026-07-24'`                                             |
| 7   | DST spring-forward (4,12)          | `2026-03-08` (local midnight = `08:00Z`): `07:59Z → '2026-03-07'`, `08:01Z → '2026-03-08'`                                                         |
| 8   | DST fall-back (4,12)               | `2026-11-01` (local midnight = `07:00Z`): `06:59Z → '2026-10-31'`, `07:01Z → '2026-11-01'`                                                         |
| 9   | date/weekday agree (3)             | `formatDayLong(localDayIso('America/Los_Angeles', 2026-07-21T00:30Z))` reads `'Monday, July 20, 2026'`                                             |
| 10  | date-only not UTC-shifted (6)      | `formatDayLong('2026-07-24') === 'Friday, July 24, 2026'` (regression pin)                                                                         |
| 11  | IANA validation                    | `isIanaTimeZone('America/Los_Angeles' \| 'UTC' \| 'America/New_York')` true; `'Not/AZone' \| '' \| undefined \| 'foo'` false                       |

**`lib/active-timezone.test.ts`:** mock `cookies()` — valid IANA → returned; garbage/absent → default;
`getActiveLocalDay(fixedNow)` equals `localDayIso(resolvedTz, fixedNow)`.

**`actions.test.ts`:** DAL + `next/cache` + **file-wide** `next/headers` `cookies()` mock (R8 — both stamp
suites now resolve `getActiveLocalDay()`); harness `day = localDayIso(DEFAULT_TIME_ZONE)`, and the existing
`:415` `day: todayIso()` assertion migrates to it. **All three** writers now take a declared `day` +
shared ±1 bound (accepts `today`, `today±1`; rejects `today+2` → "no longer open"); bad-body → zod-reject
with no DAL call. Confirms `activity_date` threaded, never recomputed (crit 5), instants untouched (crit 7).

**E2E smoke (crit 8,9):** with `timezoneId` pinned, assert the header shows the expected local weekday —
**derived** as `formatDayLong(localDayIso(DEFAULT_TIME_ZONE))`, never a hardcoded weekday literal (R8), so
it can't rot at the next DST boundary — then reload → same day. No refresh flake (server default = pinned
browser tz).

**Screenshots:** header now shows the correct local weekday — mobile/tablet/desktop, in the PR description.

## Risks / rollback

| Risk                                                                                                       | Mitigation                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-render tz + `router.refresh()` flicker (traveler's first visit renders default zone, then refreshes) | Default = the household's Pacific zone → real users' first paint already correct (no refresh). Refresh fires **only** when detected ≠ serverTimeZone, until the cookie lands; corrects within one refresh. Bounded to first-visit-while-traveling. |
| Client can't set an httpOnly cookie mid-RSC-render                                                         | By design the client writes `document.cookie` (non-secret tz) — no Server Action needed.                                                                                                                                                           |
| Malicious/garbage `tz` cookie (public input)                                                               | `getActiveTimeZone` runs `isIanaTimeZone`; anything unresolvable → `DEFAULT_TIME_ZONE`. Never fed raw to Intl.                                                                                                                                     |
| Page open across local midnight, then logs                                                                 | Check-in threads the rendered `day` + ±1 bound → lands on the day the user saw; bodyweight/strength recompute from the same cookie tz (sub-second skew only).                                                                                      |
| `zod` leaking into the client chunk via `tz-sync` importing a constant from `date.ts`                      | **Closed up front (R1):** the constants live in a zero-dep `lib/constants.ts`; `tz-sync` never imports `date.ts`. No reactive bundle-check needed.                                                                                                 |
| Removing `todayIso` breaks a caller                                                                        | Grepped: only `page.tsx`, `actions.ts`, `actions.test.ts`, `screenshot-ephemeral.ts`, `date.test.ts` — all updated here.                                                                                                                           |
| e2e non-determinism from machine tz                                                                        | `timezoneId` pinned; screenshot seed uses `localDayIso(DEFAULT_TIME_ZONE)`.                                                                                                                                                                        |

**Rollback:** revert the PR. No migration, no DDL, no data transform. The `tz` cookie becomes inert on revert.

## Out-of-scope / deferred

- **Household-timezone override** — the `households.timezone` column (nullable text, IANA-validated) +
  migration + settings UI. This is a **separate signature-changing refactor** (R4), not a zero-refactor
  plug-in: `getActiveTimeZone` gains household context (`profileId`→household), becomes DB-touching (wants
  `React cache()`), and inverts to household-primary + cookie-fallback across all four tz call sites. At
  that point, promoting `DEFAULT_TIME_ZONE` + `isIanaTimeZone` to `packages/shared` (one definition
  feeding app-validation **and** the DB seed) is the right move (R9). This PR builds the correct place to
  resolve tz; the DDL/UI + re-home is its own PR.
- **`localWeekStartIso(day)` for V1-6b-2** (R6) — b-2's ISO-week-Monday helper. Deferred to b-2, but it
  **must** live in `date.ts` and reuse the safe `…T00:00:00Z` parse (as `isoDayDiff` does), never
  `new Date("YYYY-MM-DD")`. Called out so b-2 doesn't re-encode the banned-parse rule.
- **Per-profile / per-schedule timezone** — a kid training in a different zone than the household; future.
- **IP-geo tz detection** — explicitly rejected by the brief (server uses the client-supplied, validated tz).
- **Global-tz ±1 hardening** (R7) — widening the check-in bound (or refresh-before-submit) so a non-US
  detected zone can't reject a legit first-visit submission. Out of the crit-5 US-travel scope.
- **Migrating instant storage** — none needed; `timestamptz`/UTC already correct (crit 7).
- **V1-6b-2** — the ramp adherence UI that computes ISO-week boundaries from "local today." This PR is its
  **prerequisite for "local today" only** (R6): it gives b-2 the correct `localDayIso(activeTz)` primitive;
  b-2 adds its own `localWeekStartIso` (above). b-2 must derive week boundaries from `localDayIso(activeTz)`,
  not `todayIso()`.

## Open questions — all three resolved by the panel

1. **`DEFAULT_TIME_ZONE` value** — **Resolved: `'America/Los_Angeles'`** (household zone → real users'
   first paint is correct; travelers self-heal via refresh). Panel raised no objection. Revisit only when
   the household override lands (then the default matters solely pre-cookie).
2. **`formatDayLong` `timeZone` param** — **Resolved: reject the param** (all four lenses endorsed; the
   correctness lens verified it against matrix #10). A calendar date's weekday is tz-invariant; a param
   would reintroduce the off-by-one. No separate `localWeekday` helper needed — crit 3 is structural.
3. **Bodyweight/strength: thread a client `day` like check-ins?** — **Resolved: YES** (architecture +
   correctness over simplicity, R5). Thread the rendered `day` + shared ±1 bound through all three writers
   so nothing lands on a date the header never showed; the shared validator/field keeps it DRY (answering
   simplicity's only real objection). Overrides this plan's original "no."

## Review-response log (adversarial panel)

Four independent skeptical lenses (correctness · simplicity · architecture · code-reuse), each grounded
in the actual code (not the plan text). No **blocking** defect found; the correctness lens recomputed the
full DST/midnight matrix in Node ICU 78 and confirmed **all 12 assertions numerically correct**, the
`en-CA`+`formatToParts` engine-proof claim, the `formatDayLong` pushback, the read-path historical
stability, the complete `todayIso` caller inventory, and that `router.refresh()` re-reads the cookie
server-side with no hydration mismatch. Every should-fix is incorporated below; the one genuine panel
disagreement (Q3) was resolved 2–1 toward the more-correct option, with the dissent's cost neutralized by
a shared helper.

| #   | Lens                                                                              | Critique                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | simplicity + code-reuse + architecture + correctness (all 4)                      | zod leaks into the client bundle: `date.ts:10` runs `z.iso.date()` at module load (a top-level call expr tree-shaking won't drop), and `tz-sync.tsx` (client) would be its first client importer. Plan deferred the fix "if a bundle check shows zod."                                                                                                                                                                                                                                                                                                                                                     | **Incorporated — do it now, not reactively.** New zero-dep `apps/web/lib/constants.ts` holds `TZ_COOKIE_NAME`, `DEFAULT_TIME_ZONE`, `COOKIE_MAX_AGE`; `tz-sync.tsx`, `active-timezone.ts`, `date.ts`, the playwright config, and the screenshot script import from it. `date.ts` no longer exports the constants. This mirrors the module _shape_ of `lib/access-gate.ts` (zero-dep, edge/client-safe). The risk-table "deferred" row is removed.                                                                                                                   |
| R2  | code-reuse + architecture                                                         | The "access-gate cookie precedent" justification is **false**: `mp_gate` is _server_-written, `httpOnly`, via a Server Action; `grep document.cookie` → 0 hits. `tz-sync`'s client `document.cookie` write is a new mechanism.                                                                                                                                                                                                                                                                                                                                                                             | **Incorporated (framing).** D1 no longer claims a cookie-write precedent. The _decision_ (client write for a **non-secret** tz — cheapest, no Server Action round-trip) stands and is stated on its own merits. What we mirror from `access-gate.ts` is the **module shape** (a zero-dep constants/pure-helpers module), not the cookie write.                                                                                                                                                                                                                      |
| R3  | code-reuse                                                                        | Duplicated "1 year in seconds": `gate/actions.ts:23 COOKIE_MAX_AGE` vs the planned `tz-sync ONE_YEAR_SECONDS` — same value, same purpose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Incorporated.** `COOKIE_MAX_AGE` moves to the new `lib/constants.ts`; `gate/actions.ts` and `tz-sync.tsx` both import it. Second occurrence extracted per AGENTS.md.                                                                                                                                                                                                                                                                                                                                                                                              |
| R4  | architecture (should-fix)                                                         | The household-override seam will **not** "plug in with zero refactor." `getActiveTimeZone()` is zero-arg/cookie-only; an override that wins needs household context (`profileId`→household), is DB-touching (wants `React cache()`), and the true end-state is **household-primary + cookie-fallback** — the seam as drawn is _inverted_ (cookie-primary + hardcoded default).                                                                                                                                                                                                                             | **Incorporated — drop the zero-refactor promise.** The plan now states plainly: this PR ships a **cookie resolver + hardcoded default** (correct for the zero-DDL scope). The household override is a **separate refactor** that will change `getActiveTimeZone`'s signature to take household context, make it DB-touching, and invert the precedence — touching all four tz call sites. The seam is a _correct place to start_, not a free plug-in.                                                                                                               |
| R5  | architecture (should-fix) + correctness (should-fix) — **vs** simplicity (reject) | **Q3 — day-attribution divergence.** Check-ins thread the rendered `day` (+ `isoDayDiff` ±1 bound); bodyweight/strength recompute `getActiveLocalDay()` at submit. A page held open across local midnight then submitted → weigh-in stamps _tomorrow_ while the same-screen check-in stamps _today_; a logged weigh-in lands on a date the header never showed (correctness calls this a **crit-9 gap, not a size trade-off**; the DAL's own `isoDayDiff` doc argues for the threaded-day model). Simplicity: don't replicate the check-in dance across two more forms.                                    | **Resolved 2–1 → thread the rendered `day` uniformly across all three writers, but neutralize the dissent's cost with a shared helper.** Extract one `declaredDay`/±1-bound validator + a shared hidden-day form field (reused by all three forms), instead of copy-pasting the check-in dance. This closes the same-screen midnight inconsistency (the exact bug class this PR exists to fix) **and** stays DRY — satisfying architecture+correctness (close the gap) and simplicity's real concern (no triplicated dance). Overrides the plan's original Q3 "no." |
| R6  | architecture (nit→should-fix)                                                     | "Sets up V1-6b-2" is overstated: this PR gives b-2 the correct _today_ primitive but exposes **no** ISO-week-Monday helper; b-2 must still add weekday-from-date math honoring the `new Date("YYYY-MM-DD")` ban (only `isoDayDiff` currently encodes the safe `…T00:00:00Z` parse).                                                                                                                                                                                                                                                                                                                        | **Incorporated (honest scoping).** Reframed: this PR is b-2's **prerequisite for "local today"** only. b-2 will add `localWeekStartIso(day)` in `date.ts`, reusing the safe `…T00:00:00Z` parse (never `new Date("YYYY-MM-DD")`). Called out so b-2 doesn't duplicate the banned-parse rule. Not built now (speculative for this PR).                                                                                                                                                                                                                               |
| R7  | correctness (nit)                                                                 | The check-in ±1 bound is safe only within US zones. In the acknowledged first-visit-while-traveling window (server rendered `DEFAULT_TIME_ZONE`, cookie now elsewhere, submit before refresh), a detected zone ≥2 days from LA (non-CONUS/HI, e.g. Asia/Pacific) could differ by 2 → a legit first submission rejected "no longer open."                                                                                                                                                                                                                                                                   | **Incorporated (scope caveat).** Bounded by the crit-5 **US-travel** scope. Acceptance text for "date & weekday always agree" now carries the explicit _within supported US zones_ caveat; a global-tz hardening (widen the bound or refresh-before-submit) is noted as out-of-scope.                                                                                                                                                                                                                                                                               |
| R8  | correctness (nit) + code-reuse (nit)                                              | Test scope wider than the plan's wording: since **both** stamp sites now call `getActiveLocalDay()`, the `next/headers` `cookies()` mock must be **file-wide** in `actions.test.ts` (not just the check-in suite), and the existing `:415` `day: todayIso()` assertion must become `localDayIso(DEFAULT_TIME_ZONE)`. And the e2e's _expected_ weekday must be **derived** (`formatDayLong(localDayIso(DEFAULT_TIME_ZONE))`), never a hardcoded weekday literal (rots at the next DST boundary).                                                                                                            | **Incorporated.** Test plan updated: file-wide `cookies()` mock; `:415` assertion migrated; new threaded-day + ±1 tests for bodyweight/strength; e2e asserts a derived weekday.                                                                                                                                                                                                                                                                                                                                                                                     |
| R9  | code-reuse + architecture                                                         | Constant **placement**: code-reuse noted `DEFAULT_TIME_ZONE`/`isIanaTimeZone` are domain-ish (AGENTS.md steers domain values to `packages/shared`); architecture argued they stay **app-local** (the `GATE_COOKIE_NAME` precedent; `tz` is per-request request-state, not seeded catalog data).                                                                                                                                                                                                                                                                                                            | **Reconciled — app-local now, revisit at override-time.** `TZ_COOKIE_NAME`/`DEFAULT_TIME_ZONE` live in the app (`lib/constants.ts`) for this zero-DDL PR. When `households.timezone` lands, `DEFAULT_TIME_ZONE` becomes a fallback and `isIanaTimeZone` also validates the DB column — at _that_ point, promoting the validator/default to `packages/shared` (one definition feeding app-validation + DB-seed) is the right move. Noted in out-of-scope so the drift seam is tracked, not forgotten.                                                                |
| R10 | simplicity + architecture + correctness                                           | **Endorsements (recorded so they aren't relitigated):** the 3-module split (isomorphic `date.ts` / `server-only` `active-timezone.ts` / client `tz-sync.tsx`) is principled, not over-factored; the **conditional** `router.refresh()` (refresh only when `detected !== serverTimeZone`) is the correct trade vs always/never; `formatDayLong` takes **no** `timeZone` param (a calendar date's weekday is tz-invariant — a param reintroduces the bug), so **no** `localWeekday` helper is needed (crit 3 is structural); pinned Playwright `timezoneId = DEFAULT_TIME_ZONE` is a clean determinism seam. | **Kept as-is.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Net change from the panel:** (1) new zero-dep `lib/constants.ts`; `date.ts` stops exporting the tz
constants (R1/R2/R3/R9). (2) `COOKIE_MAX_AGE` hoisted + shared with the gate (R3). (3) household-override
"zero-refactor" claim dropped (R4). (4) **Q3 flips to yes** — `day` threaded through all three writers via
one shared validator/field (R5). (5) b-2 framing narrowed; `localWeekStartIso` deferred to b-2 (R6). (6)
US-zone caveat on the ±1 bound (R7). (7) wider test-mock scope + derived e2e weekday (R8). No blocking
defect; the tz/DST model, `formatDayLong`, DAL stability, and the refresh flow are confirmed sound.
