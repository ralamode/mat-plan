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

  UI -->|"Server Action"| ACT
  UI -->|"RSC render"| RSC
  OUTBOX -->|"background sync"| RH
  DAL --> DRIZZLE --> NEON
  ACT -.->|"auth()"| CLERK
  RH -.->|"auth()"| CLERK
  RH -->|"CSV export v1 · MCP+REST v3"| CLAUDE
```

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
field, and every Server Action **re-validates it server-side** via `getProfileByPublicId` (the seam
v1.5's Clerk household scoping tightens). Profile tiles are a **UX switch, not a security boundary**;
an unknown/malformed id resolves to `notFound()` (404), never a 500.

```mermaid
flowchart LR
  LANDING["/ — public landing<br/>(no cookie, no DB)"]
  GATE["/gate — access code"]
  PICKER["/p — profile picker<br/>listProfiles() → tiles"]
  TODAY["/p/[profileId] — scoped Today<br/>getProfileByPublicId(id) → notFound() if null"]
  ACT["Server Action<br/>log bodyweight / strength"]
  DAL["DAL (server-only)<br/>getProfileByPublicId(id)"]

  LANDING -->|"Household sign-in"| GATE
  GATE -->|"code OK → APP_HOME_PATH"| PICKER
  LANDING -.->|"proxy: already has the cookie"| PICKER
  PICKER -->|"tap tile → next/link"| TODAY
  TODAY -->|"back-link"| PICKER
  TODAY -->|"hidden field profileId"| ACT
  ACT -->|"re-validate id (never trust the form)"| DAL
  DAL -->|"revalidatePath('/p/'+id)"| TODAY
```

## 2d. Program read path — today's weekday → the kid's prescribed movements (V1-10)

The programming tables (§4) surface on Today as a **read-only** card. The weekday comes from the
active-tz local day (V1-6c), maps through a hardcoded app-config schedule (`DAY_ROLE_BY_WEEKDAY` —
a documented stopgap, see [tech-debt.md](./tech-debt.md)) to a `day_role`, and one single-sourced
query resolves that day's prescriptions **plus this kid's own suggested loads**.

Two properties are load-bearing. **Ownership**: the household is resolved INSIDE the query
(`profiles.public_id → household_id → program_blocks`), so no caller can name a household and read
another one's program. **Read-only**: the card never writes and never pre-fills the log form — the
suggested load is Ray-authored text ("BW", "~75-85") that must be **typed** by a human to become a
logged, performed value. A prescription and a log entry stay strictly separate records.

```mermaid
flowchart LR
  RSC["/p/[profileId] RSC<br/>day = localDayIso(activeTz)"]
  SCHED["resolveDayRole(day)<br/>localWeekday → DAY_ROLE_BY_WEEKDAY<br/>(Mon/Wed/Fri → strength_a/b/c)"]
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

```mermaid
erDiagram
  households ||--o{ profiles : "scopes"
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
  CI --> PREV["Vercel preview + Neon branch (prod-shaped)"]
  DEV -. "a writer comments @claude review<br/>(on request only)" .-> CR["<b>claude-review</b> (advisory, never required)<br/>review: model, read-only token, PR head as data<br/>→ post: no model; scans, then one comment"]
  CR -. "one review comment" .-> REV
  PREV --> REV["review + squash-merge to main"]
  REV --> MIG["migrate-on-deploy<br/>GH Actions single migrator<br/>(direct/unpooled Neon)"]
  REV --> PROD["Vercel prod (pooled Neon, Node runtime)"]
  MIG --> NEON[("Neon Postgres")]
  PROD --> NEON
```

> `e2e` soaks as non-blocking until **PR 28**, then becomes a required check. Squawk (migration lint)
> and a Neon-branch apply are documented gates not yet wired into `ci.yml` (a follow-up).

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
