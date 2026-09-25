# DUALS-1 — Public tournament day sheet

> Backlog: [plan.md](../plan.md) row DUALS-1. Branch: `feat/duals-1-public-day-sheet`.
> Status: **decisions resolved 2026-09-25 (Ray). Awaiting roster data + adversarial panel.**

## Goal

Give a wrestling parent standing in a gym a link that answers _"who does my kid's team wrestle
next, and on what mat?"_ — readable one-handed. Ships the **day sheet** and **matchups by weight**
for the 2026 Tyrant Columbus Day Duals (Sept 26–27) at `matplan.dev/duals/…`, behind the existing
access gate, so the link + code can go to Assassins families (D4).

Why now: the Mat Assassins squads wrestle this weekend, so there is a real audience and a real
deadline. This is Stage 0 validation for the Opponent Scout product thesis (see
`bakers-wrestling-context` → `usaw-bracket-scout/docs/scout-product/GO-TO-MARKET.md`): the day
sheet is the artifact we believe parents forward to each other.

**Significant under AGENTS.md** on the "non-trivial multi-file logic" criterion — a generic event
loader, two route levels, and a roster/schedule join. It does **not** touch auth (D4).

## Acceptance

- `/duals/columbus-day-duals-2026` lists every team with a day sheet, grouped by division.
- `/duals/columbus-day-duals-2026/[team]` shows that team's pool, its round-by-round opponent
  sequence, and the mat per round.
- Each round expands to the **weight-by-weight matchup** against that opponent, where rosters exist.
- Dropping a second event JSON into `lib/duals/events/` yields a working second event with **no code
  change** (D6).
- Readable at 360px wide, one-handed, in a bright gym. No horizontal scroll.
- Gate behaviour is unchanged; no user, household, or athlete data is reachable from these routes.

## Scope

**A + B together (Ray, 2026-09-25).** With D4 resolved to option 2 the PR no longer carries a
security change, so combining is safe:

- **A — day sheet.** Pool, round order, opponent, mat, per team.
- **B — matchups by weight.** Pick a team → its roster beside each opponent's, ordered by weight
  class, so a parent can see the likely individual matchup.

Roster data: **862 wrestlers across 56 teams** captured from the event (the 8 Assassins squads,
Wrestling Chix, and every team in their pools).

## Key decisions

### D1 — Static JSON in the repo, not the database

Tournament pool data is **public, non-user data**. The DAL contract in AGENTS.md is "scope every
query by `household_id`" — this data has no household, so forcing it into the DB would either
violate that invariant or require a parallel unscoped path through the DAL. It would also need a
migration, turning a ~300-line PR into a schema PR.

Ships as a typed, versioned module under `apps/web/lib/duals/`. Reviewable in the PR, no migration,
no DAL, and **structurally incapable of leaking user data** — which is the property that makes
opening the gate safe.

Rejected: a `duals` table (migration + DAL work for data that changes once a season); a runtime
fetch from USA Bracketing (login-gated, and see D4).

### D2 — Gate exclusion is a pure, tested allowlist in `lib/access-gate.ts`

`proxy.ts` currently bounces everything except `GATE_PATH`. Adding a second literal there would
duplicate a route constant across two files — exactly what the constants single-source rule
forbids. Instead `lib/access-gate.ts` (already pure and edge-safe, already the home of `GATE_PATH`
and `safeInternalPath`) gains:

```ts
export const PUBLIC_PATH_PREFIX = '/duals';
export function isPublicPath(pathname: string): boolean;
```

Matching is **exact segment-prefix**: `/duals` or `/duals/…` only. Not `startsWith('/duals')`,
which would also open `/dualsecret`. Unit tests pin both the positive and the negative cases.

### D3 — The page renders no dynamic user state at all

No Clerk, no DAL import, no `cookies()`. A Server Component reading a static module. The root
layout stays `force-dynamic` (nonce CSP), so these pages are dynamic and uncached — acceptable at
this traffic, noted as accepted cost rather than solved.

### D4 — RESOLVED (Ray, 2026-09-25): option 2 — gated club share

**Decision: keep it behind the existing access gate**, shared with Assassins families via the code.
A club share, not a publication.

Consequences, all simplifying:

- **This PR no longer touches auth.** No `PUBLIC_PATH_PREFIX`, no `isPublicPath()`, no `proxy.ts`
  change. The gate stays exactly as it is.
- It therefore drops out of "significant" on the auth criterion — but **stays significant on
  "non-trivial multi-file logic"** (a generic event loader, two route levels, roster joins), so the
  plan and panel still apply.
- The data-rights question is deferred, not answered. Going fully public later is a separate,
  deliberate PR that reopens D4 — and by then the USAW conversation may have happened.

_Original analysis retained below for when that day comes._

### D4-original — is publishing this data OK?

**This is the one thing I will not decide unilaterally.** The schedules come from USA Bracketing,
read through Ray's own logged-in session. The earlier sourcing work
(`usaw-bracket-scout/docs/scout-product/ARCHITECTURE.md`) established that usabracketing.com posts
**no Terms of Use at all** (`/terms`, `/legal`, `/privacy` all 404), which is why reading it
personally was fine.

Publishing it on a public website is **a different act than reading it**. It is republication, to
an audience, under our own brand, from a source that gates its data behind a login. Nothing
observed forbids it, and pool draws are the kind of fact that circulates freely in a gym — but
"no posted ToU" is not the same as "licensed", and this is the exact line the sourcing discipline
exists to keep us on the right side of.

Three ways to land it, in increasing caution:

1. **Publish as-is**, cite USA Bracketing prominently, link back to the event, no login required.
2. **Publish behind a shared link/code** given to Assassins families — narrower than public,
   closer to "sharing with my club" than "operating a data service". Reuses the gate we already
   have rather than opening it.
3. **Hold** until the USAW conversation happens.

**Chosen: (2).** See D4 above.

### D6 — Generic event contract: drop in a JSON, get a site (Ray, 2026-09-25)

**Requirement:** "a page we can reuse by dropping in the json … so we don't need to reinvent the
wheel each time." This is the load-bearing design constraint, not a nicety — it is what makes the
next tournament a data task instead of an engineering task.

Shape:

```
apps/web/lib/duals/
  schema.ts      zod schema + inferred types — the contract
  events/
    columbus-day-duals-2026.json
    <next-event>.json          ← drop-in; nothing else changes
  registry.ts    globs events/*.json, validates each against schema at module load
  index.ts       listEvents() / getEvent(slug) / getTeam(slug, teamSlug)
```

Rules that keep it generic:

- **Nothing about this event is hardcoded in a route or component.** Division names, pool names,
  round counts, weight classes and mat numbers are all data. Columbus Day has 5 divisions and pools
  of 3-8 teams; the next event will differ and must need no code change.
- **The schema is validated at load, and a bad JSON fails loudly** in CI (`pnpm test`), not silently
  at request time in a gym.
- **Byes are first-class** — `opponent: null` — because round numbers must stay aligned with what
  the announcer calls (Wrestling Chix have three).
- **Rosters are optional.** An event JSON with schedules but no rosters renders the day sheet and
  omits the matchup view. That keeps the format useful when a roster pull isn't worth it, and it is
  how Scope A would have shipped alone.
- **Weight classes are per-division**, as strings, ordered as the source orders them — not parsed to
  numbers (Columbus Day has "Hwt", the Fall Duals had "207").

Rejected: a route per event (the thing Ray explicitly asked to avoid); a DB table (D1); generating
static pages at build time (the layout is `force-dynamic` for CSP anyway).

### D7 — Double-rostered wrestlers are expected, not an error

Liam Baker appears on **both** Mat Assassins ES4 (68) and Mat Assassins Red ES6 (64). The Fall Duals
had 41 such wrestlers. The schema must allow the same person on several teams and weights, and the
UI must not treat it as a data bug. No de-duplication.

### D5 — Data freshness is disclosed, not solved

The event schedule page on USA Bracketing is empty — **no start times are published**, so this is
dual _order_, not a clock. Mats and pools can change day-of. Every page carries an "as of" stamp and
a link to the live bracket. We do not pretend to be live.

## File-by-file changes

| File                                                     | Change                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/web/lib/duals/schema.ts`                           | Zod schema + inferred types — the drop-in contract (D6).                                         |
| `apps/web/lib/duals/events/columbus-day-duals-2026.json` | The event data: meta, divisions, teams, pools, rounds, rosters.                                  |
| `apps/web/lib/duals/registry.ts`                         | Loads + validates every `events/*.json` at module load.                                          |
| `apps/web/lib/duals/index.ts`                            | `listEvents()`, `getEvent(slug)`, `getTeam(eventSlug, teamSlug)`, `matchupsFor(team, opponent)`. |
| `apps/web/lib/duals/index.test.ts`                       | Lookups, unknown slugs, bye handling, weight pairing incl. unmatched weights.                    |
| `apps/web/lib/duals/schema.test.ts`                      | A malformed event JSON fails validation loudly.                                                  |
| `apps/web/app/duals/[event]/page.tsx`                    | Team index, grouped by division. `notFound()` on unknown slug.                                   |
| `apps/web/app/duals/[event]/[team]/page.tsx`             | The day sheet. `generateMetadata` for the link preview card.                                     |
| `apps/web/components/duals/day-sheet.tsx`                | Presentational round list. Server Component.                                                     |
| `apps/web/components/duals/matchup-table.tsx`            | Weight-by-weight roster pairing for one dual.                                                    |
| `docs/plan.md`                                           | New DUALS section + DUALS-1 row linking here.                                                    |
| `docs/status.md`                                         | Where-we-are pointer + changelog row (same PR, per AGENTS.md).                                   |

Estimated ~350–450 lines, within the <400 target if the UI stays lean.

**Feature guide:** not required — under the "four or more files across two or more packages" bar
(this is one package), and the plan carries the between-file invariant (the gate allowlist must
stay in sync with the route segment).

## UX notes (phone, gym floor)

- Round number, opponent, mat — nothing else above the fold. The card design already validated in
  `bakers-wrestling-context/shared/tournaments/columbus-day-duals-2026/` is the reference.
- Opponent name is the largest element after the round number; mat right-aligned.
- Byes visually recede (they are non-events) but stay in sequence so round numbers line up with
  what the announcer calls.
- Team index groups by division so a parent finds their squad without reading ten names.
- Link preview matters — `generateMetadata` gives GroupMe/iMessage a title + description card, or
  the forward loop looks broken.

## Risks

| Risk                                                                     | Severity   | Mitigation                                                                                                          |
| ------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Publishing third-party data                                              | **High**   | D4 — resolved to a gated club share; revisit before any public launch                                               |
| Roster/schedule name drift (team named differently in bracket vs roster) | **Medium** | Join on an explicit `teamId` in the JSON, never on display name; schema requires every schedule opponent to resolve |
| Data goes stale mid-event                                                | Medium     | "As of" stamp + link to live bracket; no live claims                                                                |
| Public pages uncached (force-dynamic)                                    | Low        | Accepted; traffic is a few dozen parents                                                                            |
| Round-6 gap for Wrestling Chix                                           | Low        | Source rendered no pairing; shown as bye and flagged in the data file                                               |

## Rollback

Revert the commit. Nothing outside `lib/duals/`, `app/duals/` and `components/duals/` changes, the
gate is untouched, and there is no migration or data to unwind.

## Adversarial review

**Panel has not run yet.** Per `docs/plans/README.md` this plan needs ≥3 engineering lenses
(correctness/data-integrity, simplicity/scope, architecture/consistency, code-reuse) **plus the
required UX panel**, with a review-response log recorded here, before implementation.

D4 is settled (option 2), which removed the auth surface. The panel now focuses on the **event
contract (D6)** — is it genuinely reusable, or shaped around this one tournament? — plus the
schedule/roster join, and the required UX panel for the matchup view on a 360px screen.

### Review-response log

_(empty — pending panel)_
