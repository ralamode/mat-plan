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
  UPSTASH["Upstash Redis<br/>gate rate limit"]
  GHA["GitHub Actions<br/>migrate.yml"]

  UI -->|"Server Action"| ACT
  UI -->|"RSC render"| RSC
  OUTBOX -->|"background sync"| RH
  DAL --> DRIZZLE --> NEON
  ACT -.->|"auth()"| CLERK
  RH -.->|"auth()"| CLERK
  RH -->|"CSV export v1 · MCP+REST v3"| CLAUDE
  ACT -.->|"scrubbed errors"| SENTRY
  RSC -.->|"scrubbed errors"| SENTRY
  ACT -.->|"visitor IP, gate only"| UPSTASH
  GHA ==>|"prod DDL + seed on every merge<br/>holds DATABASE_URL_UNPOOLED"| NEON
```

⚠️ **This is the containers view, not the egress list.** Sentry, Upstash and GitHub Actions are drawn
now because each receives something, and **GitHub Actions holding the production database credential**
is the edge people miss. But **Vercel is where every value entered actually passes through**, and its
platform logs hold IP + path. The complete, cited list of who receives what is
[privacy/data-inventory.md](./privacy/data-inventory.md) §7, which owns it.

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
  DAL->>DB: tx: session → entry → entry_set<br/>ON CONFLICT(client_id) DO UPDATE (LWW)
  DB-->>DAL: rows
  DAL-->>Act: minimal DTO
  Act-->>UI: {ok:true} + revalidate
  UI-->>Kid: updated Today view
```

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

## 2b. Profile routing — landing → picker → scoped Today (V1-3, OSS-2)

`/` is the **public landing** (OSS-2): no cookie read, no DB query, the only route in `PUBLIC_PATHS`.
A caller who already holds the gate cookie never sees it — the proxy sends `/` (and `/gate`) to the
picker at **`/p`** (`APP_HOME_PATH`). That redirect is convenience routing, not authorization: every
gated page still calls `requireGatedPage()`, and `app/pages-are-gated.test.ts` fails CI if one
doesn't.

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
- **Zero live households → `null` (the app goes dark); ≥ 2 → THROW.** Different states, different
  paths: `null` for both would tell a parent their data does not exist and suggest a production write.
- **AUTH-1 replaces only `getHouseholdScope()`'s body** (session → `household_members` → household).
  Nothing else moves, which is the whole reason the seam landed before its consumers.
- ⚠️ **Scoping is not authorization.** Before AUTH-1 the principal is a shared access code, so what
  is proved is _consistent scoping_, not that the requester is who they claim.
- ✅ **`movements` came inside the seam at `TEN-2b`.** `findOrCreateMovementId` takes a
  `HouseholdScope` and resolves **global-first** — the curated namespace (`household_id IS NULL`),
  then this household's own, then an insert into this household's own — so a name a household types
  belongs to it and is deleted with it. ⚠️ **One leak survives to `TEN-2c`:** the non-partial
  `movements_slug_unique` still forbids two households a row for one slug, so the second household to
  type a name is handed the first's row (a deliberate choice over failing a child's session write),
  and that leaves a cross-household `entries.movement_id` which **blocks household deletion**. Status:
  [data-inventory.md](./privacy/data-inventory.md) §4; the resolver's shape is in §4 below. TEN-1
  chunk 1d **proved** the original defect rather than assuming it, and its verdict is still `LEAKS`.

```mermaid
flowchart LR
  LANDING["/ — public landing<br/>(no cookie, no DB)"]
  GATE["/gate — access code"]
  PICKER["/p — profile picker<br/>householdProfileRows(scope) → tiles"]
  TODAY["/p/[profileId] — scoped Today<br/>getProfileByPublicId(id) → notFound() if null"]
  ACT["Server Action<br/>log bodyweight / strength"]
  SCOPE["getHouseholdScope()<br/>THE scope point, once per request<br/>0 → null (dark) · ≥2 → throw"]
  DAL["DAL (server-only)<br/>isLiveProfile(publicId, scope)"]

  LANDING -->|"Household sign-in"| GATE
  GATE -->|"code OK → APP_HOME_PATH"| PICKER
  LANDING -.->|"proxy: already has the cookie"| PICKER
  SCOPE -->|"the one live household<br/>(AUTH-1: the session's)"| PICKER
  PICKER -->|"tap tile → next/link"| TODAY
  TODAY -->|"back-link"| PICKER
  TODAY -->|"hidden field profileId"| ACT
  ACT -->|"re-validate id (never trust the form)"| DAL
  SCOPE -->|"required + positional:<br/>a missed site is a compile error"| DAL
  DAL -->|"wrong household → the SAME 404 as unknown"| TODAY
  DAL -->|"revalidatePath('/p/'+id)"| TODAY
```

## 2d. Program read path — today's weekday → the kid's prescribed movements (V1-10)

The programming tables (§4) surface on Today as a **read-only** card. The calendar date comes from the
active-tz local day (V1-6c) and maps through a hardcoded app-config schedule — a documented stopgap,
see [tech-debt.md](./tech-debt.md) — to a `day_role`, and one single-sourced query resolves that day's
prescriptions **plus this kid's own suggested loads**.

⚠️ **The schedule is epoch-day PARITY, not a weekday map.** `resolveDayRole` alternates
`strength_a`/`strength_b` on every calendar day with no rest day
(`apps/web/lib/programming/day-role-schedule.ts:41-43`); the `DAY_ROLE_BY_WEEKDAY` Mon/Wed/Fri map this
section described was **deleted in #151**. Where it goes next is
[ADR 0007](./decisions/0007-scheduling-model.md).

Two properties are load-bearing. **Ownership**: the household is resolved INSIDE the query
(`profiles.public_id → household_id → program_blocks`), so no caller can name a household and read
another one's program. **Read-only**: the card never writes and never pre-fills the log form — the
suggested load is Ray-authored text ("BW", "~75-85") that must be **typed** by a human to become a
logged, performed value. A prescription and a log entry stay strictly separate records.

```mermaid
flowchart LR
  RSC["/p/[profileId] RSC<br/>day = localDayIso(activeTz)"]
  SCHED["resolveDayRole(day)<br/>epoch-day parity, every day<br/>(even → strength_b, odd → strength_a)"]
  DAL["DAL getProgramDay(publicId, dayRole)<br/>server-only · uuid guard · → DTO"]
  Q["packages/db programDayRows<br/>(single-sourced, db:verify-proven)"]
  DB[("program_blocks → prescriptions<br/>⟕ prescription_targets (this profile)")]
  CARD["&lt;ProgramReference&gt; RSC<br/>read-only, zero client JS"]
  FORM["&lt;StrengthForm&gt;<br/>UNCHANGED — empty + required"]

  RSC --> SCHED
  SCHED -->|"null → no card, no query"| FORM
  SCHED -->|"day_role"| DAL
  DAL --> Q
  Q -->|"profile → household → newest block<br/>(ownership resolved internally)"| DB
  DB -->|"movements in idx order<br/>+ THIS kid's load/reps, verbatim"| CARD
  CARD -.->|"coach reads it,<br/>TYPES what was performed"| FORM
```

## 3. Offline outbox → sync

```mermaid
flowchart LR
  A["Log action<br/>(maybe offline)"] --> B[("IndexedDB outbox<br/>append, per-event UUIDv7")]
  B --> C{"Online?"}
  C -- no --> B
  C -- yes --> D["POST /api/sync<br/>batch = whole session graph"]
  D --> E["DAL: authz + zod"]
  E --> F[("Neon: upsert ON CONFLICT client_id<br/>LWW = client-supplied timestamp")]
  F --> G["per-item results"]
  G --> H["mark synced,<br/>clear from outbox"]
  G -->|"semantic dupe"| I["client-side dedupe<br/>(profile/date/activity/movement/set-idx)"]
```

## 4. Data model — v1 generalized model (target of V1-1)

The concrete tables the v0 thin slice (`units · profiles · entries · entry_sets`) generalizes into.
`households` is the authz root; the catalogs (`activity_types · movements · metric_definitions`, all
keyed by natural keys and seeded from `@mat-plan/shared` in V1-2) classify each `entry`; `sessions`
group a training day's entries. Full column detail in [spec.md](./spec.md) §4a.

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
reference is "prevented by construction". **`TEN-2c` drops the constraint and closes it.**

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

  entries {
    bigint id PK
    uuid public_id UK "anti-IDOR"
    uuid client_id "UNIQUE partial (offline idempotency)"
    bigint activity_type_id FK
    bigint movement_id FK "nullable — set_list only"
    text metric_key FK "nullable — single_metric only"
    numeric value_num "single_metric value"
    text raw_load "verbatim → lossless CSV export"
    text prescribed_snapshot "what was ASKED, frozen at log time (0013) — export-only"
    date activity_date "calendar date in the ACTIVE IANA tz (V1-6c), not UTC"
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

## 5. Deploy & CI topology

```mermaid
flowchart TB
  DEV["feature branch → PR"] --> CI
  subgraph CI["GitHub Actions — on every PR"]
    Q["<b>quality</b> (required)<br/>prettier · eslint · tsc · vitest · next build<br/>+ drift guard + PGlite db:verify"]
    E["<b>e2e</b><br/>Postgres 17 service · migrate+seed · Playwright smoke<br/>auto-skips docs-only PRs · ci-skip-e2e label override"]
    G["<b>gitleaks</b> (required)"]
  end
  CI --> PREV["Vercel preview<br/>(preview scope: seed-only Neon project,<br/>own gate code + Upstash, no prod secret)"]
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
