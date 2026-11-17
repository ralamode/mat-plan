# mat-plan — Architecture Diagrams

Visual overview of the system — **v0 is built and live on Vercel + Neon; v1 (the generalized activity
model) is in progress** (V1-1). Detail in [spec.md](./spec.md); roadmap in [plan.md](./plan.md); the
v1 schema plan is [plans/v1-1-generalize-schema.md](./plans/v1-1-generalize-schema.md). Diagrams
render on GitHub (Mermaid).

## 1. System architecture (containers)

```mermaid
flowchart TB
  subgraph Client["Client — installable PWA (phone / iPad)"]
    UI["React UI<br/>RSC + client components + shadcn/ui"]
    OUTBOX[("IndexedDB outbox (Dexie)<br/>append-only, per-event UUIDv7")]
    UI <--> OUTBOX
  end

  subgraph Vercel["Vercel — Next.js App Router (Node runtime, Fluid)"]
    RSC["Server Components<br/>(reads)"]
    ACT["Server Actions<br/>(mutations)"]
    RH["Route Handlers<br/>/api/* · /api/sync"]
    DAL["DAL — server-only<br/>auth → household authz → DTO"]
    RSC --> DAL
    ACT --> DAL
    RH --> DAL
  end

  DRIZZLE["Drizzle ORM<br/>pg via PgBouncer pooler"]
  NEON[("Neon Postgres<br/>pooled = runtime · direct = migrations")]
  CLERK["Clerk<br/>household auth"]
  CLAUDE["Claude skills<br/>/retro · /daily-plan"]
  SENTRY["Sentry<br/>server + edge errors only"]
  UPSTASH["Upstash Redis<br/>mutation rate limit"]
  GHA["GitHub Actions<br/>migrate.yml"]

  UI -->|"Server Action"| ACT
  UI -->|"RSC render"| RSC
  OUTBOX -->|"background sync"| RH
  DAL --> DRIZZLE --> NEON
  ACT -.->|"auth()"| CLERK
  RH -.->|"auth()"| CLERK
  PROXY["proxy.ts<br/>nonce CSP · clerkMiddleware()<br/>enforces nothing (1d)"]
  UI --> PROXY
  PROXY -.->|"authenticateRequest()"| CLERK
  UI ==>|"AUTH-1 1a: BROWSER egress — clerk-js + sign-in<br/>exact Frontend API origin in connect-src"| CLERK
  RH -->|"CSV export v1 · MCP+REST v3"| CLAUDE
  ACT -.->|"scrubbed errors"| SENTRY
  RSC -.->|"scrubbed errors"| SENTRY
  ACT -.->|"Clerk user id, mutations only"| UPSTASH
  GHA ==>|"prod DDL + seed on every merge<br/>holds DATABASE_URL_UNPOOLED"| NEON
```

⚠️ **This is the containers view, not the egress list.** Sentry, Upstash and GitHub Actions are drawn
now because each receives something, and **GitHub Actions holding the production database credential**
is the edge people miss. But **Vercel is where every value entered actually passes through**, and its
platform logs hold IP + path. The complete, cited list of who receives what is
[privacy/data-inventory.md](./privacy/data-inventory.md) §7, which owns it.

🔴 **`AUTH-1` 1a added the thick `UI ==> CLERK` edge, and it is the only BROWSER→third-party edge in
this diagram.** Clerk was previously drawn as a dashed server-side `auth()` dependency only, which was
the whole picture while `@clerk/nextjs` was not installed. It is now: the sign-in screen is a
browser-side SDK, so once an instance is configured the browser fetches `clerk-js` from the instance's
Frontend API host and talks to it for the sign-in exchange. **Today that edge is dormant** — both keys
are optional and unset, `lib/clerk.ts` renders no provider without them, and the CSP is not widened at
all; `e2e/theme.spec.ts` asserts zero requests to any Clerk host. The dashed `proxy.ts ⇢ Clerk` edge
is the other half 1a wired: `clerkMiddleware()` is composed **inside** `proxy.ts` so `auth()` can
answer at all, and 1a removed the `api` exclusion from its matcher for that reason.

## 2. Write path — logging one entry

```mermaid
sequenceDiagram
  actor Kid as Kid (phone)
  participant UI
  participant Act as Server Action
  participant Zod
  participant DAL as DAL (server-only)
  participant DB as Neon (Drizzle)
  Kid->>UI: enter a set / bodyweight
  UI->>Act: submit + client_id (UUIDv7)
  Act->>Zod: parse & validate input
  Zod-->>Act: typed value (or field errors)
  Act->>DAL: logEntry(dto)
  DAL->>DAL: getCurrentUser() + verify household ownership
  DAL->>DB: tx: session → entry → entry_set<br/>ON CONFLICT(client_id) DO NOTHING + re-select live
  DB-->>DAL: rows
  DAL-->>Act: minimal DTO
  Act-->>UI: {ok:true} + revalidate
  UI-->>Kid: updated Today view
```

## 2g. Resolving a movement — the id decides, ids before inserts (PICK-1 PR 2)

```mermaid
flowchart TD
  S["submitted movements[]<br/>each: movementPublicId? + movementName"] --> P1
  subgraph DB["packages/db · resolveSessionMovements — OUTSIDE the transaction"]
    P1{"phase 1:<br/>every movementPublicId"} -->|resolves global-or-own| OK[row: id + name]
    P1 -->|any miss| NO["throw MovementNotAvailableError<br/>'Movement not available'"]
    OK --> P2["phase 2: findOrCreateMovement<br/>for the TYPED names only — INSERTS"]
  end
  P2 --> B["ResolvedSessionMovement[]<br/>built FIELD BY FIELD<br/>movementName = the DATABASE's"]
  B --> W
  subgraph TX["writeStrengthSession · db.transaction"]
    W[isLiveProfile — the profile seam] --> RC{"assertMovementsAreAvailable<br/>global-or-own, re-checked HERE"}
    RC -->|any not available| RB["throw → ROLLBACK<br/>nothing commits"]
    RC -->|all available| I[insert session → entries → sets]
  end
  style P1 fill:#fde68a,stroke:#b45309
  style RC fill:#fecaca,stroke:#b91c1c
  style NO fill:#fecaca,stroke:#b91c1c
  style RB fill:#fecaca,stroke:#b91c1c
```

**Two shapes to read off it:** phase 2 is the only phase that writes, which is why phase 1 comes
first; and the **red node is the seam** — phase 1 reads outside the transaction, so the re-check is
what the rollback protects.

The invariant itself — the phase order, the seam, what the refusal may and may not say, and the one
bounded consequence the id path creates — is [write-path.md](./features/write-path.md) → **14**. This
section is the shape; that one is the rule. (§2f above is its neighbour and the two compose: §2g
resolves the `movement_id` that §2f freezes.)

## 2c. Batch write path — logging a day's check-ins (V1-5)

The first **batch multi-row** write and the first writer to insert `kind = NULL` (unblocked by
V1-1c). Differs from §2 in three ways worth seeing at a glance: the action derives its fields from a
**server-side registry** rather than the request body, results are **per-item**, and the conflict
policy is `DO NOTHING` (not §2's LWW `DO UPDATE` — editing a check-in is V1-9).

```mermaid
sequenceDiagram
  actor Kid as Kid (phone)
  participant UI as CheckinForm
  participant Act as Server Action
  participant Reg as Field registry (seeded catalogs)
  participant DAL as DAL (server-only)
  participant DB as Neon (Drizzle)
  Kid->>UI: tick habits / rate drills
  UI->>Act: submit v: and c: field names (UUIDv7 each) plus profileId and day
  Act->>Reg: walk CHECKIN_FIELDS (never enumerate the body)
  Reg-->>Act: expected field names plus value_type
  Act->>Act: per-field zod, accumulate ALL field errors, bound day to +/-1
  Act->>DAL: logCheckinEntries(profile, day, items)
  DAL->>DB: resolve activity_type plus metric_definition (cached)
  DB-->>DAL: catalog rows (unit comes from HERE, never the body)
  DAL->>DB: one multi-row INSERT, kind NULL, value_num always set, ON CONFLICT DO NOTHING
  DB-->>DAL: inserted rows
  DAL-->>Act: per-item clientId, id, created
  Act-->>UI: ok plus revalidate (or already-logged if none created)
  UI-->>Kid: check-ins rendered in Today
```

> ⚠️ **The Check-ins form is off the day page since V1-24 3b-page (2026-11-15, #418)**;
> `logCheckinsAction` and this write path stay, tested, until FAM-1 12f.

## 2b. Profile routing — landing → picker → scoped Today (V1-3, OSS-2, PRIV-2)

`/` is the **public landing** (OSS-2): no cookie read, no DB query — and since `AUTH-1` 1c-3b
**every caller sees it**, signed in or not.

🔴 **Every non-public surface requires a Clerk session whose principal holds a `household_members`
row, re-checked in-process — and as of `1d` that is the ONLY requirement.**
`app/pages-need-a-session.test.ts` reports the offender by name, asking the question differently per kind:
a **page** or **Route Handler** names the check itself, while an **action** must call `enterMutation`
and **return its refusal** — the session check, the limiter and their order are asserted once inside
that helper.

**Why in-process, and why it matters MORE now.** `1c-3b` required the access code AND a session
because `getHouseholdScope()` did not consult the principal until `1c-4`, so a session alone meant
_"anyone this Clerk instance admits"_ — deleting the gate first would have **widened** access.
`1c-4` discharged that and `1d` deleted the gate. ⚠️ **What `1d` also removed is the backup**: the
proxy's bounce used to stand between a stranger and a page, so these per-surface checks are now the
only thing there. SEC-1's scar was a prefetch header missing the matcher, CVE-2025-29927 is the
general case, and [SECURITY.md](../.github/SECURITY.md) refuses to call middleware a boundary.
[beta-1](./milestones/beta-1.md) records the ordering as a security obligation rather than a
preference.
🔴 **The proxy now enforces nothing, literally.** The gate bounce was the one thing it enforced
itself; its matcher stays wide for a different reason — `auth()` must be able to answer and the
security headers must land.

⚠️ **Two routing arms were deleted, one per chunk, and neither was authorization.** `1c-3b` removed
the forward that sent a cookie-holder from `/` or `/gate` to `/p`: it **looped** once the pages also
required a session, and meant such a visitor could never reach the landing at all. `1d` removed the
bounce itself, with the gate:

```text
1c-3b deleted:  /sign-in → footer "mat-plan" → /     → (forward) → /p → requireSession() → /sign-in
1d    deleted:  any un-gated request         → /gate?from=…  (the bounce, and /gate with it)
```

Nothing security-relevant went with either: an unauthenticated caller never reached the forward, and
the bounce was never the boundary.

**`PUBLIC_PATHS` holds TWO routes since PRIV-2**: `/` and `/privacy`. The notice at `/privacy` is a
compiled copy of [`docs/privacy/notice.md`](./privacy/notice.md) — rendered from a committed data
module, so it reads **no cookie, no database and no request input** (no `params`, no `searchParams`,
no `fs`), and a byte-exact drift test fails when the page and the reviewed source disagree. It
exists because the Clerk and Google consent screens need a privacy-policy **URL**.

⚠️ **Both public routes now render in place for every caller** — the asymmetry that once sent `/`
to the picker went with the forward above. Keep its reasoning in mind before re-adding any bounce: a
public path that jumped into the app would be unreadable to the person who most needs it, and the
notice is the URL the Clerk and Google consent screens point at. ✅ **From `1d` the notice is also
`index`able** — the reason it was not (publishing a description of a lock whose limiter could fail
open) is dissolved rather than satisfied, because the lock is deleted. `/privacy` owns **no
subtree**: `/privacy/x` is NOT public (`PUBLIC_PATH_TREES` is the separate opt-in a route with
children joins) and now simply 404s, and `/privacy/` 308s to `/privacy` before the proxy runs.

The picker at `/p` lists profiles; a tile routes to `/p/[profileId]` (the profile's UUIDv7 `public_id`). The
selection lives entirely in the URL — no client state. The `profileId` rides the log forms as a hidden
field, and every Server Action **re-validates it server-side** via `getProfileByPublicId`. Profile
tiles are a **UX switch, not a security boundary**; an unknown/malformed id resolves to `notFound()`
(404), never a 500.

**The household scope is where that re-validation now happens, and it is ONE point (TEN-1).**
[ADR 0006](./decisions/0006-household-addressing.md) decided the address stays `/p/<profileId>` with
**no household segment**, so `/p` is byte-identical for every household and the picker query is the
whole front-door isolation boundary. `lib/dal/household.ts` → `getHouseholdScope()` is the **one**
function that decides whose request this is; every DAL read and write resolves it there and passes it
into `packages/db`, so no page, action or Route Handler signature carries a scope.
`isLiveProfile(publicId, scope)` is the single predicate they all share, its `scope` parameter
**required and positional** so an unconverted call site is a compile error.

- **A wrong-household id is a 404, byte-identical to an unknown id** — the same `notFound()` /
  `NO_PROFILE_LOG` path, no new error shape and no new copy. The signal the scoped predicate destroys
  is recovered on the miss path only, as a structured `cross_household` / `unknown_resource` event
  (ADR 0006 obligation 3), never in the response.
- 🔴 **FIVE outcomes since `AUTH-1` 1c-4**, not the two this said. The resolver reads the principal,
  then the membership — never a household count:

  | #   | condition                      | answer                                               |
  | --- | ------------------------------ | ---------------------------------------------------- |
  | A   | one live membership            | that household's scope                               |
  | B   | no principal                   | `null`, silently — 1c-3b refused the caller upstream |
  | B′  | `household_members` missing    | `null` + `scope_outcome: schema_missing`             |
  | C   | principal, no membership       | `null` + `scope_outcome: no_membership`              |
  | D   | principal, **two** memberships | **THROW** — "pick one" is a silent cross-wire        |

  `null` and the throw must stay different paths: `null` for both would tell a parent their data does
  not exist and suggest a production write. ⚠️ **`no_household` is retired** — nothing counts
  households now, so an event carrying it is pre-1c-4.

- ✅ **`1c-4` replaced only `getHouseholdScope()`'s body** (session → `household_members` →
  household). Nothing else moved, which is the whole reason the seam landed before its consumers —
  no page, action or Route Handler signature carries a scope.
- ✅ **Scoping IS authorization now, and that is what unblocked `1d` — which has landed.** Until 1c-4
  the scope came from the single live household, so a session proved only that the caller was someone
  this Clerk instance admits, and deleting the access gate then would have **widened** access. A
  session now decides _whose_ data you get, and `1d` deleted the gate. ⚠️ **At the household boundary
  only** — inside one household there is still no per-profile authorization, and there is not meant to
  be: profile tiles are a UX switch, not a security boundary (AGENTS.md). ⚠️ **The consequence of the
  gate going:** a request that bypasses the proxy now meets only the in-process check, so that check
  is the whole boundary (SEC-1's scar; CVE-2025-29927).
- ⚠️ **The ≥2-live-households throw is gone with the old body**, and was not ported to an alert: two
  live households is the intended end state once a family is invited, so it would fire on every
  request forever. The creator is closed instead — `seed.ts` refuses to insert when a live household
  exists, which matters because `migrate.yml` seeds production on every merge.
- ✅ **`movements` came inside the seam at `TEN-2b`.** Movement resolution takes a
  `HouseholdScope` (`findOrCreateMovement`, and `resolveMovementByPublicId` since `PICK-1` PR 2;
  the `findOrCreateMovementId` wrapper that used to sit in the DAL is deleted) and resolves
  **global-first** — the curated namespace (`household_id IS NULL`),
  then this household's own, then an insert into this household's own — so a name a household types
  belongs to it and is deleted with it. ✅ **`TEN-2c` (migration `0017`) dropped the non-partial
  `movements_slug_unique`, so two households each hold their OWN row for one slug and the denial
  window is closed** — and with it the cross-household `entries.movement_id` that blocked household
  deletion, which was the fallback's measured price. ⚠️ **One residual survives, and it is not the
  constraint:** the **pre-`TEN-2b`** rows still at `household_id IS NULL`, which global-first serves
  to every household — closing at **`TEN-2c-1`** (the split backfill). `0017` only stops it growing,
  via `movements_global_row_has_pattern`. Status:
  [data-inventory.md](./privacy/data-inventory.md) §4; the resolver's shape is in §4 below. TEN-1
  chunk 1d **proved** the original defect rather than assuming it, and its verdict now names both
  halves rather than reading `LEAKS`.

```mermaid
flowchart LR
  LANDING["/ — public landing<br/>(no cookie, no DB)"]
  PRIVACY["/privacy — the notice<br/>compiled from docs/privacy/notice.md<br/>(no cookie, no DB, no request input)"]
  SIGNIN["/sign-in — Clerk<br/>(invite-only) — THE ONLY DOOR (1d)"]
  PICKER["/p — profile picker<br/>householdProfileRows(scope) → tiles<br/>+ Sign out (session only)"]
  TODAY["/p/[profileId] — scoped Today<br/>getProfileByPublicId(id) → notFound() if null"]
  RENAME["/p/[profileId]/edit — rename<br/>static title, never a name (PROF-1 a-r)"]
  ACT["Server Action · app/p/[profileId]/actions.ts<br/>log bodyweight / strength / routine"]
  ATHACT["Server Action · app/p/profile-actions.ts<br/>rename (add / archive / restore follow)"]
  SCOPE["getHouseholdScope()<br/>THE scope point, once per request<br/>principal → membership<br/>no membership → null · ≥2 memberships → throw"]
  DAL["DAL (server-only)<br/>isLiveProfile(publicId, scope)"]

  LANDING -->|"Household sign-in"| SIGNIN
  LANDING -->|"site footer"| PRIVACY
  PICKER -->|"site footer"| PRIVACY
  PRIVACY -->|"footer: mat-plan"| LANDING
  SIGNIN -->|"its own privacy link<br/>(SiteFooter hidden here, 1d)"| PRIVACY
  SIGNIN -->|"its own mark links home"| LANDING
  SIGNIN -->|"session OK"| PICKER
  PICKER -.->|"no session → redirect (1c-3b)"| SIGNIN
  TODAY -.->|"no session → redirect (1c-3b)"| SIGNIN
  PICKER -.->|"Sign out: clears the Clerk session —<br/>the whole story since 1d"| SIGNIN
  SCOPE -->|"the session's household<br/>(membership-derived, 1c-4)"| PICKER
  PICKER -->|"tap tile → next/link"| TODAY
  TODAY -->|"back-link"| PICKER
  TODAY -->|"hidden field profileId"| ACT
  TODAY -->|"→ Rename {name} ?from=/p/[id]"| RENAME
  RENAME -->|"back-link, and router.back() after a save"| TODAY
  RENAME -->|"hidden field profileId"| ATHACT
  ACT -->|"re-validate id (never trust the form)"| DAL
  ATHACT -->|"re-validate id, then renameProfile(scope)"| DAL
  SCOPE -->|"required + positional:<br/>a missed site is a compile error"| DAL
  DAL -->|"wrong household → the SAME 404 as unknown"| TODAY
  DAL -->|"revalidatePath('/p/'+id)"| TODAY
```

## 2e. The app shell — one frame, two layouts, one `<main>` (UI-5)

Every authenticated **app screen** renders inside `components/layout/app-shell.tsx`. Below `lg` the
shell is the single centred column the app has always had; at `lg` and up it adds a nav rail — **the
athlete switcher**, so a laptop changes kid without a round trip through `/p`.

⚠️ **Two authenticated routes are deliberately outside it**, both named in `OWN_MAIN` or its sibling
list in `app/pages-need-a-session.test.ts`: `/design/tokens` (a full-width token gallery, not an app
screen) and the root error boundary (`app/error.tsx`, which replaces the page rather than filling
it). Both declare their own `<main>`, and the error boundary renders `SiteFooter` itself — ⚠️ this
PR's footer move is what made that necessary, and it **supersedes `PRIV-2`'s "one `<footer>` in the
root layout, not three use sites"**: a layout cannot know the pathname, so the choice was three use
sites or two `contentinfo` landmarks on `/sign-in`.

**The shell is a seam, which is why it is here.** `<main>`, the `<footer>` and the skip link are
declared in exactly one file instead of nine, and two things depend on that: `sheet.tsx` patches
`tabIndex` onto `document.querySelector('main')` for its focus fallback, and `privacy.spec.ts`
clicks `getByRole('contentinfo')` — a `<footer>` nested inside `<main>` is not exposed as
`contentinfo` at all. ⚠️ **No automated check would catch a second `<main>`:** axe's
`landmark-no-duplicate-main` is tagged `best-practice` and the scan runs `wcag2a`/`wcag2aa`, so the
guard is a source scan in `app/pages-need-a-session.test.ts`.

```mermaid
flowchart TD
  PAGE["app/**/page.tsx<br/>(RSC — writes content only)"]
  SHELL["AppShell<br/>(server component, no client boundary)"]
  RAIL["NavRail — hidden lg:flex<br/>athletes + Settings"]
  MAIN["main#main tabIndex=-1<br/>content capped at max-w-2xl"]
  FOOT["SiteFooter — sibling of main<br/>('use client', aria-current)"]
  SKIP["skip link → #main"]
  PR4["PICK-1 PR 4<br/>context rail (third track)"]

  PAGE -->|"children"| SHELL
  PAGE -->|"athletes, current — the page knows what it is,<br/>so no usePathname and no client boundary"| SHELL
  SHELL --> SKIP
  SHELL -->|"only when athletes exist AND nav !== false"| RAIL
  SHELL --> MAIN
  SHELL --> FOOT
  SHELL -.->|"not yet — a page-level prop cannot host<br/>a picker that lives in a client form"| PR4
  RAIL -->|"aria-current='page' on the open athlete"| MAIN
```

⚠️ **`/p` passes `nav={false}`** in all three of its states: it _is_ the athlete switcher, so a rail
there would render a second link to every athlete beside the tile it duplicates. The no-household
branch was already excluded for the adjacent reason — a rail pointing at the page you are on.

## 2h. Hide and restore — what "delete" does to a row (V1-9b B1-1)

`deleted_at` is a tombstone, not a deletion: the row keeps its values, its `public_id`, its
`created_at` and its `client_id`, and stays restorable until `PRIV-3`'s purge. The invariants and the
full reader audit are in [delete-and-restore.md](./features/delete-and-restore.md); this is the shape.

🔴 **Two things decide everything else here.** A hide event is `(profile, day, deleted_at)` carried
as **fixed-format UTC text** — one transaction shares one `now()`, so a folded row is one event, and
the token never passes through a JS `Date` (Postgres keeps microseconds, a `Date` keeps
milliseconds). And `ON DELETE CASCADE` is **hard-delete only**, so a hidden entry keeps **live
children**: every reader must reach ownership through the parent, or it returns the sets of a row
the person deleted.

**The app's first caller (V1-24 3b-bw).** A blank Save on a weigh-in reaches `writers/hide.ts`
through `writers/single-value.ts`'s `clearBodyweight`: it opens the transaction, locks the one row
`FOR UPDATE OF entries`, compares unit and seen-value after the lock (a concurrent amend answers
`stale`), and calls `hideEntries` for that row on its own day. The diagram below is the general shape;
the clear is one item, with no restore offered for it.

**Clear this day (V1-9b B2-0).** `clearDay` hides every live entry of the day as one event and
stamps each `hide_reason = 'clear_day'`; `restoreClear` brings back exactly that event's rows. Both
work out the rows on the server (no id list, no cap). Every un-hide sets `UNHIDE`, so the reason
leaves with the tombstone, and a CHECK refuses a live row that kept one. **B1-2:** one predicate
(`clearEventOn`, `queries/clear-events.ts`) serves `clearDay`'s replay, `restoreClear` and the
banner's read `clearEventsForDay` (every clear of a day, newest first, as a token and a count), so the
banner offers exactly what Restore all restores. Restore all's action answers counts, counted in the
DAL so no `heldBy.value` leaves it; 0 and 0 means nothing left to restore. The diagram below gains
the banner when B2 renders it.

```mermaid
sequenceDiagram
  participant P as Person
  participant W as writers/hide.ts
  participant DB as entries
  participant R as every other reader

  P->>W: hide [ids] on (profile, day)
  W->>DB: one tx — every id owned, that day? else notFound
  DB-->>W: deleted_at = now() · ONE token
  W-->>P: hiddenAt (six-digit UTC text)
  Note over DB,R: children keep deleted_at IS NULL —<br/>readers reach ownership through the PARENT
  R->>DB: month export · adherence · amends
  DB-->>R: the hidden parent AND its live children are absent

  P->>W: restore [ids] under token, keepInsteadOf?
  loop per item, in its own SAVEPOINT
    W->>DB: lock the item (FOR UPDATE), scoped
    alt already live
      W-->>P: ok (replay)
    else hidden under a DIFFERENT token
      W-->>P: changed — the holder is NEVER touched
    else the day's weigh-in slot is held, no swap asked
      W-->>P: slot_taken + heldBy
    else swap
      W->>DB: hide the holder (owned · same slot · live)
      W->>DB: restore the item (guarded by the token)
      W-->>P: ok — or ROLLBACK TO SAVEPOINT
    end
  end
```

⚠️ **The savepoint is the half-swap guard.** "Use this one instead" hides a live weigh-in to make room
for the one being restored; without a per-item savepoint, a restore that then failed would commit the
holder's hide and leave the item hidden too — the person loses both. A refusal therefore leaves by
`throw`, because returning it would commit.

## 2f. The `prescribed` column — frozen at log time, live only as a fallback (V1-22 chunk 2)

```mermaid
flowchart TD
  L[log a strength set<br/>day role asserted] --> R[programDayRows<br/>BEFORE the transaction]
  R --> M["liveMatchesByKey()<br/>packages/shared/src/csv/prescribed.ts"]
  M --> F["freeze onto<br/>entries.prescribed_snapshot"]
  X[export a month] --> Q{snapshot IS NULL?}
  Q -- no --> U[use the frozen string<br/>including '']
  Q -- yes --> V[read today's program] --> M
  style M fill:#fde68a,stroke:#b45309
  style U fill:#bbf7d0,stroke:#15803d
```

🔴 **The highlighted node is one function with two callers, and that is the point.** Both paths must
answer "what was prescribed" identically; while the composer was private to a `server-only` async
function, `packages/db` could not call it and the agreement could only be asserted by a test.

⚠️ **`''` is an answer, not a missing value** — it is what an `open()` prescription renders, and 11 of
the 13 seeded are open. Only `IS NULL` takes the fallback branch. NULL means "logged before chunk 2,
or logged with no day role"; everything else freezes, so chunk 4's edits cannot rewrite history.

**Since FAM-1 11b the snapshot has two freezing paths.** The flow above is the strength writer's (a
day-role prescription, matched by movement). A program row (§2i) freezes its own prescription's text
inside its transaction, through `prescribedText` (`@mat-plan/shared/program/prescribed-text`), the
renderer the day page and the export share; its `''` (a Check) is the same real value as above. The
export's NULL fallback reaches only the first path's rows: a program row is never written NULL.

## 2i. Logging a program row — `logRow` (FAM-1 11b)

```mermaid
sequenceDiagram
  autonumber
  participant A as Server Action (12b)
  participant W as logRow (packages/db)
  participant DB as Postgres (one transaction)
  A->>W: scope, today, workout_item id, RowWrite
  W->>DB: profile in scope (isLiveProfile); archived?
  Note over W: outside the window (today, yesterday) → closed_day
  W->>DB: who holds clientId? (unguarded, pinned)
  alt held by this write
    DB-->>W: live → ok with stored values · hidden → own_hidden
  else held by anything else
    DB-->>W: not_found
  end
  W->>DB: workout: templateBlockIn(scope) ∧ programBlockOfProfile
  W->>DB: prescription IN that workout + live quantities
  W->>DB: movement available to the household
  W->>DB: scheduledOn(block, workout, weekday of the day)
  Note over W: set and values: fillRowValues(prescribedTarget) → else bad_value
  W->>DB: INSERT session ON CONFLICT DO NOTHING → re-select exactly one
  W->>DB: INSERT superset (if grouped) → re-select exactly one
  W->>DB: INSERT entry ON CONFLICT DO NOTHING (client_id, row arbiter)
  alt not inserted
    W->>DB: classify the holder again; else a live row on the set → slot_taken
  else inserted
    W->>DB: INSERT entry_sets + entry_set_quantities
  end
  W-->>A: RowResult (a refusal after an insert rolls back by RowRefused)
```

🔴 **The order is the contract**, and every step has a `db:verify` proof with its own mutation
(`scripts/verify/day.ts`). The replay answers before the program checks, so a retry after the program
changed answers as the first call did. A refusal is thrown as `RowRefused` and caught at the
transaction's edge, so a session the call created is never left behind. Un-tick and re-tick are the
same profile and window steps, then `hideEntries` / `restoreHidden` (§2h) on a program row of that
athlete and day only. Step 8, "on the program that day", is `isOnProgramThatDay`, on the same
`onProgramOn` conjunct the day resolver reads (§2d), so the page and the ✓ agree.

## 2d. Program read path — the day resolver, `resolveDayPlan` (FAM-1 12a)

An athlete and a day → the `DayPlan` the day page shows (`packages/shared/src/program/day-shapes.ts`),
every field but `athletes`, which 12b's DAL adds. A read only, in `packages/db/src/queries/day/`; the
invariants are in [day-writers.md](./features/day-writers.md) (E1–E7) and the decisions in
[the plan](./plans/fam-1-12a-day-resolver.md).

```mermaid
flowchart TB
  DAL["12b DAL<br/>scope, profile public id, day, today"]
  P["profile: isLiveProfile(scope)<br/>missing or foreign → null"]
  W["writable = inWritableWindow(day, today) ∧ ¬archived (R1)<br/>future = day > today"]
  subgraph LIVE["Live branch — anchored on the assignment (E1)"]
    A["dayAssignments: liveAthleteTemplateBlockIn(scope, profile)<br/>flags: onProgramOn(day) · assignmentCurrentAsOf(today) · onProgramOn(day + 1)"]
    S["weekSlotsOn(blocks on the day): weekSlotOn(day), live workouts"]
    PR["live prescriptions + live quantities<br/>prescriptionTerms → target, unit, text (E5)"]
  end
  subgraph LOGGED["Logged branch — anchored on the athlete (E1)"]
    E["entries: programRowOf(profile, day) ∧ movement_id IS NOT NULL (E4) ∧ live (E3)"]
    J["⟕ scoped workout, ⟕ scoped prescription<br/>(each ⋈ its own block: athleteTemplateBlockIn)<br/>WHERE a set FK resolved in scope, and the session is the athlete's own,<br/>else the row is dropped"]
    V["readRowValues: one live set per row, else throw"]
  end
  M["movements: movementIsAvailableTo(scope) (E2)"]
  PV["previousRows: same profile, movement, set; before the day;<br/>latest day, then created_at, then id (writable days only)"]
  OUT["Omit&lt;DayPlan, 'athletes'&gt;<br/>programs (R6, R7) · workouts: program order, week order,<br/>then left the week · items (E6, then R4) · rows (R3) · progress"]

  DAL --> P --> W
  W --> A --> S --> PR
  W --> E --> J --> V
  J -->|"live workouts that left the week"| PR
  PR --> M
  J --> M
  M --> PV --> OUT
  V --> OUT
```

🔴 **Two anchors, one scope.** What is on the day comes from the athlete's assignments on live template
blocks of the scope and of the athlete's own household; what was logged comes from the athlete's own
program rows, whose workout and prescription pointers are resolved through scoped subqueries. A
pointer that is set but does not resolve in scope (runbook pre-flight (f), (g)), or a session of
another profile ((i)), drops the row; a NULL one (a purge) keeps it with null ids. A logged workout of
a hidden program or a hidden workout carries an id only for what is still live (C21); a live one logged
on a day no assignment covers any more keeps its ids, read from the live block (C24). A weigh-in, a practice or a check-in never enters a `DayPlan`
(E4). Every rule has a `db:verify` proof in `scripts/verify/day-plan.ts`, against the contract's
fixtures with ids mapped exactly.

> **The V1-10 program card before it** (`resolveDayRole` → `getProgramDay` → `programDayRows`) is
> unmounted from the day page since V1-24 3b-page (#418). `programDayRows` still feeds the export and
> the legacy snapshot writer (§2f) until FAM-1 12f deletes it; its history is in
> [ADR 0007](./decisions/0007-scheduling-model.md).

## 3. Offline outbox → sync

```mermaid
flowchart LR
  A["Log action<br/>(maybe offline)"] --> B[("IndexedDB outbox<br/>append, per-event UUIDv7")]
  B --> C{"Online?"}
  C -- no --> B
  C -- yes --> D["POST /api/sync<br/>batch = whole session graph"]
  D --> E["DAL: authz + zod"]
  E --> F[("Neon: upsert ON CONFLICT client_id<br/>LWW = client-supplied timestamp — v1.5 TARGET, not today")]
  F --> G["per-item results"]
  G --> H["mark synced,<br/>clear from outbox"]
  G -->|"semantic dupe"| I["client-side dedupe<br/>(profile/date/activity/movement/set-idx)"]
```

## 4. Data model — v1 generalized model (target of V1-1)

The concrete tables the v0 thin slice (`units · profiles · entries · entry_sets`) generalizes into.
`households` is the authz root; the catalogs (`activity_types · movements · metric_definitions`, all
keyed by natural keys and seeded from `@mat-plan/shared` in V1-2) classify each `entry`; `sessions`
group a training day's entries. Full column detail in [spec.md](./spec.md) §4a.

📌 **`household_members` (AUTH-1 1b) is how a person reaches a household at all**, and it ships
**dark**: nothing reads it until 1c replaces `getHouseholdScope()`'s body with
session → `household_members` → household. It holds Clerk's own `user_…` and **no email** — the
address lives in Clerk, which is the point of using Clerk. One partial unique index on
`clerk_user_id WHERE deleted_at IS NULL` is **both** the one-live-household-per-account rule and the
resolver's access path. ⚠️ Its FK to `households` is `ON DELETE NO ACTION`, which makes it the **19th**
table in the deletion runbook's hand-maintained order — step 13, before `households`, or the whole
delete transaction aborts.

⚠️ **`households` is the authz root for everything that hangs off `profiles` — and two of the three
catalogs hang off nothing.** Global is right for `activity_types` and `metric_definitions` (seeded,
never written by the app) and **was wrong for `movements`**, which the strength form writes from free
text. TEN-1 1d proved the consequence: one household's typed name resolved to another household's
row, the first typist pinned that slug's `name` / `is_bodyweight` / `unit_default` for everyone, and
the row survived a session write the household seam refused.

**`TEN-2a` added the edge the ERD below draws** — `movements.household_id`, nullable, where `NULL`
means _reference data owned by no household_ (the seeded catalog) and a value means _this household
typed this name_ — plus the two partial unique indexes that give the table two namespaces.
✅ **`TEN-2b` lit it up**, so the edge is now in the behaviour as well as the schema: the resolver is
global-first (flowchart below), `seedProgram` reads the global namespace only, and the FK is
validated. **Two of 1d's three defects are closed**: a refused session's row lands in the caller's own
namespace, and a prescription can no longer resolve another household's movement — `seedProgram`
refuses loudly instead.

🔴 **One is not, and it is a schema window, not a code gap.** While the **non-partial**
`movements_slug_unique` lives, at most one row per slug exists in the whole table, so two households
cannot both hold one. `TEN-2a` chose, for that window, to hand the second household the first's row
(the pre-existing read leak) rather than fail its write forever with `23505` — availability over
confidentiality, bounded by the named invite precondition. ⚠️ **Its price:** the resulting
cross-household `entries.movement_id` **aborts the household-deletion procedure** (`23503`, measured),
which is why `runbooks.md` pre-flight (d) carries a repair step and `schema.ts` no longer claims the
reference is "prevented by construction". **`TEN-2c` dropped the constraint, and `db:verify` now
asserts pre-flight (d) reads ZERO across `entries` and `prescriptions` while step 11's `DELETE`
completes instead of aborting** — both assertions inverted rather than retired.

```mermaid
flowchart TD
  S["findOrCreateMovement(exec, scope, name)"] --> SL["slug = movementSlug(name)"]
  SL --> G{"slug WHERE household_id IS NULL?"}
  G -- yes --> GR["return the SEEDED row<br/>pattern · unit_default · is_bodyweight<br/>a human chose"]
  G -- no --> H{"slug WHERE household_id = scope?"}
  H -- yes --> HR["return this household's own row"]
  H -- no --> I["INSERT (scope, slug)<br/>ON CONFLICT (household_id, slug)<br/>WHERE household_id IS NOT NULL"]
  I -- ok --> RR["re-resolve in this household's namespace"]
  I -- "23505 movements_slug_unique" --> F["TEN-2b→2c WINDOW ONLY:<br/>another household owns this slug<br/>(the only reachable cause)"]
  F --> FB["log + resolve UNSCOPED → that household's row<br/>= the pre-existing read leak, not a 500"]
  FB --> P["⚠️ PRICE: a cross-household entries.movement_id<br/>→ household deletion aborts 23503"]
```

**Why global-first and not household-first** — the question a reader will ask: the only writer can
author `{publicId, slug, name, isBodyweight: false}` and never `pattern` or `unit_default`, so a
household row is always a **strictly worse** version of a curated one, and `programDayRows` reads
exactly those columns as _"the movement's declaration"_.

```mermaid
erDiagram
  households ||--o{ profiles : "scopes"
  households ||--o{ household_members : "claimed by (AUTH-1 1b; one live row per Clerk account)"
  households ||--o{ movements : "owns custom (TEN-2a; NULL = seeded, owned by nobody)"
  profiles ||--o{ sessions : "logs"
  profiles ||--o{ entries : "logs"
  profiles ||--o{ day_readiness : "gate 🟢🟡🔴"
  profiles ||--o{ ramp_targets : "weekly target (V1-6b)"
  sessions ||--o{ entries : "groups"
  entries ||--o{ entry_sets : "expands to"
  entry_sets ||--o{ entry_set_quantities : "measured quantities (GAP-3)"
  quantity_slots ||--o{ entry_set_quantities : "(slot, dimension)"
  units ||--o{ entry_set_quantities : "(unit, dimension)"
  activity_type_categories ||--o{ activity_types : "categorizes"
  activity_types ||--o{ entries : "classifies"
  movements ||--o{ entries : "set_list (0..1)"
  metric_definitions ||--o{ entries : "single_metric (0..1)"
  metric_definitions ||--o{ ramp_targets : "targets (V1-6b)"
  units ||--o{ activity_types : "default_unit"
  units ||--o{ movements : "unit_default"
  units ||--o{ metric_definitions : "unit"
  units ||--o{ entries : "unit"

  profiles {
    bigint id PK
    uuid public_id UK "anti-IDOR — the athlete's id for life"
    uuid client_id "UNIQUE NON-partial (PROF-1 a-0) — the slot is never freed"
    bigint household_id FK "the authz root — isLiveProfile's household conjunct"
    text kind "kid｜adult — marks a row as a minor; NOT an authority input"
    timestamptz archived_at "not currently training — a LIST filter, never in isLiveProfile"
    timestamptz deleted_at "the soft delete — distinct from archived_at"
  }
  entries {
    bigint id PK
    uuid public_id UK "anti-IDOR"
    uuid client_id "UNIQUE non-partial (V1-9b B0) — the identity is never freed"
    bigint activity_type_id FK
    bigint movement_id FK "nullable — set_list only"
    text metric_key FK "nullable — single_metric only"
    numeric value_num "single_metric value"
    text raw_load "verbatim → lossless CSV export"
    text prescribed_snapshot "what was ASKED, frozen at log time (0013) — export-only"
    date activity_date "calendar date in the ACTIVE IANA tz (V1-6c), not UTC"
    text hide_reason "clear_day or NULL; never on a live row (V1-9b B2-0)"
  }
  activity_types {
    text key UK "natural key"
    text category FK
    text input_shape "set_list, single_metric, boolean, timing"
  }
  ramp_targets {
    bigint id PK
    uuid public_id UK "anti-IDOR"
    bigint profile_id FK
    text metric_key FK "→ metric_definitions"
    date week_start "ISO-week Monday, UTC"
    numeric target_value "the weekly ramp target"
  }
```

> **Ramp targets (V1-6b):** `ramp_targets` holds a per-profile, per-week TARGET value for a calisthenics
> metric, so weekly adherence (actual `entries` vs target) is computable in **SQL** (spec.md §4). A
> coach-authored weekly calendar, not engine-computed progression — see
> [ADR 0002](./decisions/0002-calisthenics-ramp-targets.md). Config data → no `client_id`; idempotency
> is the partial natural-key UNIQUE `(profile_id, metric_key, week_start) WHERE deleted_at IS NULL`.

> **Tagged union (V1-1b):** an `entry` carries **at most one** of `{movement_id, metric_key}` —
> `CHECK (movement_id IS NULL OR metric_key IS NULL)`. `boolean`/`timing` activities (e.g. `wake`,
> `brain_rep`) reference **neither** and are typed by `activity_type_id` alone.

### 4a. How one activity maps to an entry (the tagged union)

```mermaid
flowchart TB
  AT["activity_type.input_shape"] --> D{"which shape?"}
  D -->|set_list| SET["movement_id set · metric_key NULL"] --> ES["N × entry_set (reps × load)"]
  D -->|single_metric| SM["metric_key set · movement_id NULL"] --> VN["value_num + unit"]
  D -->|boolean| BOOL["movement_id NULL · metric_key NULL"] --> ST["status = done"]
  D -->|timing| TIM["movement_id NULL · metric_key NULL"] --> EA["event_at (moment)"]
  ES --> CHK
  VN --> CHK
  ST --> CHK
  EA --> CHK
  CHK["✓ CHECK: at-most-one of movement_id / metric_key"]
```

### 4b. The program tables (FAM-1, through step 5)

A household's program is a `program_blocks` row (`kind` is `template` for a block built in the
app, `legacy` for the seeded one). Its workouts are `workouts`; the week template places them on weekdays through
`block_day_workouts`; a workout's items are `prescriptions`, with typed targets in
`prescription_quantities`. Two links run from the log side back to the plan: `sessions.workout_id`
and `entries.prescription_id`. Both are `ON DELETE SET NULL` and identity only: what was asked
is frozen on the log row (`sessions.workout_name`, `entries.prescribed_snapshot`), so a rename or
purge never rewrites history. Who is on which program is `program_assignments` (FAM-1 step 5): one
row per athlete and program from `active_from` through `active_to` (inclusive; NULL while open), with
`program_assignment_weekdays` saying which days it is due. A template block reaches an athlete only
through an assignment; "on day D" and "due on D" are spelled once, in
`packages/db/src/queries/program-assignments.ts`.

```mermaid
erDiagram
  households ||--o{ program_blocks : "owns (household_id)"
  program_blocks ||--o{ workouts : "block_id"
  program_blocks ||--o{ block_day_workouts : "the week template (block_id)"
  workouts ||--o{ block_day_workouts : "(workout_id, block_id) composite FK"
  program_blocks ||--o{ prescriptions : "block_id"
  workouts |o--o{ prescriptions : "(workout_id, block_id) composite FK (4b); NULL on legacy rows"
  workouts |o--o{ workouts : "copied_from_workout_id, SET NULL"
  movements ||--o{ prescriptions : "movement_id"
  prescriptions ||--o{ prescription_quantities : "typed targets (4b)"
  quantity_slots ||--o{ prescription_quantities : "(slot, dimension)"
  units ||--o{ prescription_quantities : "(unit, dimension)"
  prescriptions ||--o{ prescription_targets : "per-athlete load and reps (legacy)"
  profiles ||--o{ prescription_targets : "profile_id"
  workouts |o--o{ sessions : "workout_id, SET NULL (4a-ii)"
  prescriptions |o--o{ entries : "prescription_id, SET NULL (4a-ii)"
  program_blocks ||--o{ program_assignments : "block_id (5); template blocks only, writer-enforced"
  profiles ||--o{ program_assignments : "profile_id (5); same household, writer-enforced"
  program_assignments ||--o{ program_assignment_weekdays : "assignment_id (5)"

  program_blocks {
    bigint id PK
    uuid public_id UK "anti-IDOR"
    bigint household_id FK "the authz root"
    text kind "legacy or template (4a-i)"
    uuid client_id "UNIQUE per household; required on template"
    text name
  }
  workouts {
    bigint id PK
    uuid public_id UK "anti-IDOR"
    uuid client_id "UNIQUE per block (block_id, client_id)"
    bigint block_id FK
    text name
    bigint copied_from_workout_id FK "SET NULL"
    text copied_from_program_name "frozen on Copy"
  }
  block_day_workouts {
    bigint block_id FK
    int weekday "the week template"
    int idx "order within the day"
    bigint workout_id FK "composite with block_id"
    text label "optional"
  }
  prescriptions {
    bigint id PK
    uuid public_id UK "anti-IDOR"
    bigint block_id FK
    bigint workout_id FK "4b; XOR with day_role"
    text day_role "legacy rows only"
    uuid client_id "4b; on template rows; UNIQUE per workout"
    int sets "prescribed set count"
    text notes "the author's instructions"
    text rest_after "a superset's last item only"
    text superset_label "copied to supersets.prescription_group"
    int superset_order "place in the group"
  }
  prescription_quantities {
    bigint prescription_id FK
    text slot "FK as a pair with dimension"
    text dimension "denormalized for the two pair FKs"
    text unit "FK as a pair with dimension"
    numeric value_min "NULL means no target"
    numeric value_max "a range needs both ends"
  }
  sessions {
    bigint workout_id FK "identity only"
    text workout_name "frozen at log time"
  }
  entries {
    bigint prescription_id FK "identity only"
    int prescription_set "1-based; marks a row logged in a program"
    text prescribed_snapshot "what was asked, frozen"
  }
  program_assignments {
    bigint profile_id FK
    bigint block_id FK
    int idx "the athlete's program order"
    date active_from "NOT NULL"
    date active_to "inclusive last day; NULL while open"
  }
  program_assignment_weekdays {
    bigint assignment_id FK
    int weekday "0 is Sunday"
  }
```

## 5. Deploy & CI topology

```mermaid
flowchart TB
  DEV["feature branch → PR"] --> CI
  subgraph CI["GitHub Actions — on every PR"]
    Q["<b>quality</b> (required)<br/>prettier · eslint · tsc · vitest · next build<br/>+ drift guard + PGlite db:verify"]
    E["<b>e2e</b><br/>Postgres 17 service · migrate+seed · Playwright smoke<br/>auto-skips docs-only PRs · ci-skip-e2e label override"]
    G["<b>gitleaks</b> (required)"]
  end
  CI --> PREV["Vercel preview<br/>(preview scope: seed-only Neon project,<br/>own Upstash, no prod secret)"]
  DEV -. "a writer comments @claude review<br/>(on request only)" .-> CR["<b>claude-review</b> (advisory, never required)<br/>review: model, read-only token, PR head as data<br/>→ post: no model; scans, then one comment"]
  CR -. "one review comment" .-> REV
  PREV --> REV["review + squash-merge to main"]
  REV --> MIG["migrate-on-deploy<br/>GH Actions single migrator<br/>migrate.yml (prod) + migrate-preview.yml"]
  REV --> PROD["Vercel prod (pooled Neon, Node runtime)"]
  MIG --> NEON[("Neon: production")]
  MIG --> NEONP[("Neon: mat-plan-preview<br/>seed-only, separate project")]
  PROD --> NEON
  PREV --> NEONP
```

> `e2e` soaks as non-blocking until **PR 28**, then becomes a required check. Squawk (migration lint)
> and a Neon-branch apply are documented gates not yet wired into `ci.yml` (a follow-up).
>
> ⚠️ **Previews do NOT get a Neon branch of production, and never did.** This diagram said
> "Neon branch (prod-shaped)" in the present tense for months. A preview reads a **separate,
> seed-only Neon project** — a branch is a copy-on-write clone, so it would put every family's
> bodyweight in every preview ([OPS-1](./plans/ops-1-preview-isolation.md)). The unwired
> prod-shaped rehearsal is a different thing, and when it is built it must branch the **preview**
> project or use an anonymized snapshot, for the same reason.

## 6. Roadmap to MVP and beyond

```mermaid
flowchart LR
  B["Bootstrap ✅"] --> V0["v0 ✅<br/>thin slice"]
  V0 --> V1["v1 🚧<br/>online logger 🎯 MVP"]
  V1 --> AI1["AI-1<br/>NL logging + eval"]
  AI1 --> V15["v1.5<br/>offline PWA + Clerk"]
  V15 --> V2["v2<br/>PPL + engine"]
  V2 --> V3["v3<br/>AI depth + MCP/REST"]
```

## 7. v1 build order & parallelization

The serial spine (schema → catalogs) must land first; then the feature slices are additive on the
settled model and **fan out in parallel**, before the serial tail (edit → prefill → export → capstone).

```mermaid
flowchart LR
  V11["V1-1<br/>generalize schema<br/>(a → b → c)"] --> V12["V1-2<br/>seed catalogs<br/>+ coverage test"]
  V12 --> BAND
  subgraph BAND["parallelizable — additive on the generalized model"]
    direction TB
    V13["V1-3 profile tiles"]
    V14["V1-4 weigh-ins"]
    V15["V1-5 checkins / habits"]
    V16["V1-6 calisthenics totals"]
    V17["V1-7 life activities"]
    V18["V1-8 strength session"]
  end
  BAND --> V19["V1-9 fix-a-set (LWW)"]
  V19 --> V110["V1-10 block-template prefill"]
  V110 --> V111["V1-11 copy-set-to-kid"]
  V111 --> V112["V1-12 a11y pass"]
  V112 --> V113["V1-13 CSV export"]
  V113 --> V114["V1-14 full-day E2E<br/>🎯 MVP complete"]
```

> Migrations serialize by rule (one per PR, drift-checked, forward-only), so schema-touching PRs stay
> on the spine; the parallel band is app-layer (no new migrations). The **training-log day**
> (`2026-07-20`) becomes fully loggable once V1-4 + V1-8 + V1-5 + V1-6 land, and V1-13 exports it.

## 8. Household deletion — the only path that removes rows (PRIV-1)

The procedure is [runbooks.md](./runbooks.md) → "Delete a household and everyone in it"; this is its
shape. It spans three systems and is irreversible, which is why the ordering is drawn rather than
left in prose. Two edges carry the non-obvious constraints: **Clerk ids are captured before the
transaction** (after AUTH-1 the mapping lives in the rows the transaction destroys), and **`entries`
is deleted before `sessions` and `supersets`** (it holds FKs to both).

```mermaid
sequenceDiagram
  autonumber
  actor OP as Operator
  participant CH as Household<br/>(verified channel)
  participant LED as Deletion ledger<br/>(outside git + DB)
  participant APP as App
  participant PG as Neon Postgres
  participant CLK as Clerk

  CH->>OP: "please delete us"
  OP->>CH: confirm on the INVITATION channel
  Note over OP,CH: never the address that asked
  OP->>CH: scheduled for T+7, here is how to cancel
  OP->>LED: request date · household public_id · channel
  OP->>CLK: read user ids
  OP->>LED: Clerk user ids (BEFORE the transaction)
  CH->>APP: household exports its own data
  Note over OP,CH: export is PARTIAL — offer a full extract
  OP->>PG: cut restore branch (whole DB — not a per-household net)
  OP->>CH: re-confirm, immediately before applying
  OP->>PG: dry run — counts + cross-household pre-flight
  alt any pre-flight count non-zero
    PG-->>OP: STOP
  else clean
    OP->>PG: BEGIN · re-check · 12 DELETEs · re-count · COMMIT
    Note over PG: entries BEFORE sessions and supersets<br/>no deleted_at in any WHERE
  end
  OP->>CLK: delete the users
  OP->>LED: apply date
  OP->>PG: delete the restore branch (T+7 after apply)
  OP->>LED: branch-deleted date, then clear the entry
  OP->>CH: done + what remains (notice → Deleting your data)
```

⛔ **Two preconditions this diagram assumes**: the household is **not in the seed** (`db:seed` runs on
every merge and would re-create it — `OPS-2`), and **`OPS-3`'s per-household restore has been
rehearsed** (without it a mistaken deletion is not practically recoverable, because the branch above
restores _everyone_).

### 8a. The erasure graph — one list, read by every deletion (PRIV-3)

`PRIV-3` turns the step-4 table above into code: `HOUSEHOLD_GRAPH` in
`packages/db/src/erasure/graph.ts`, proved against the catalog by `db:verify` (P1, P2, P7, P8 in
`packages/db/scripts/verify/erasure.ts`). The guide is [erasure.md](./features/erasure.md). Only the
graph exists today; the core, the two corrections and the ledger replay are planned (PRIV-3 PR 2a, 2b
and 3). The athlete grain is the graph's 11 tables reachable from `profiles`, which is `ATHLETE_GRAPH`.

```mermaid
flowchart TD
  G["HOUSEHOLD_GRAPH<br/>19 tables, child before parent<br/>11 of them athlete grain"]
  P["db:verify P1 P2 P7 P8<br/>the catalog and a household in every table"]
  C["delete core (planned, PRIV-3 2a)<br/>lock the parent rows<br/>re-run pre-flights a to h<br/>delete in graph order"]
  EH["erase-household (planned, PRIV-3 2b)<br/>household grain: all 19"]
  EA["erase-athlete (planned, PRIV-3 3)<br/>athlete grain: the 11"]
  L["deletion ledger<br/>grain and public id"]
  R["OPS-3 restore<br/>walks the graph in reverse,<br/>then replays the ledger through the core"]
  P -. proves .-> G
  G --> C
  C --> EH
  C --> EA
  EH --> L
  EA --> L
  L --> R
  G --> R
```
