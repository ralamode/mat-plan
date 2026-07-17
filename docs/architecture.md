# mat-plan — Architecture Diagrams

Visual overview of the **designed** system (app not built yet). Detail in [spec.md](./spec.md);
roadmap in [plan.md](./plan.md). Diagrams render on GitHub (Mermaid).

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

## 4. Data model (core — full ERD in spec.md §4a)

```mermaid
erDiagram
  household ||--o{ profile : has
  profile ||--o{ session : logs
  profile ||--o{ entry : logs
  session ||--o{ superset : groups
  session ||--o{ entry : contains
  entry ||--o{ entry_set : "expands to"
  activity_type ||--o{ entry : classifies
  movement ||--o{ entry : "of"
  metric_definition ||--o{ entry : "typed by"
  program_block ||--o{ prescription : contains
  prescription ||--o{ prescription_target : "per-profile load"
```

## 5. Deploy & CI topology

```mermaid
flowchart TB
  DEV["feature branch → PR"] --> CI
  subgraph CI["GitHub Actions — required checks"]
    L["lint · prettier · tsc"]
    T["tests vs Docker Postgres"]
    S["Squawk (migrations) · gitleaks · CodeQL"]
  end
  CI --> PREV["Vercel preview<br/>+ Neon branch (prod-shaped)"]
  PREV --> REV["review + squash-merge"]
  REV --> MIG["GH Actions migrator<br/>(direct/unpooled) on merge to main"]
  MIG --> PROD["Vercel prod"]
  PROD --> NEON[("Neon Postgres<br/>pooled runtime")]
```

## 6. Roadmap to MVP and beyond

```mermaid
flowchart LR
  B["Bootstrap ✅"] --> V0["v0<br/>thin slice"]
  V0 --> V1["v1<br/>online logger 🎯 MVP"]
  V1 --> AI1["AI-1<br/>NL logging + eval"]
  AI1 --> V15["v1.5<br/>offline PWA + Clerk"]
  V15 --> V2["v2<br/>PPL + engine"]
  V2 --> V3["v3<br/>AI depth + MCP/REST"]
```
