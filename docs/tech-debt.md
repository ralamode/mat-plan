# Tech-debt backlog

Known, **accepted** shortcuts and rough edges — deliberate trade-offs we chose to ship, recorded so
they're paid down on purpose rather than rediscovered. This is not a bug list (those get fixed) and
not the feature backlog ([plan.md](./plan.md)); it's the "we know, and here's the plan" ledger.

Each entry: **what & why it's debt → impact → proposed fix → severity**. Newest on top. When you pay
one down, delete it (git keeps the history) and reference this file in the PR.

Related: [lessons.md](./lessons.md) (failures → fixes, so a known trap costs one attempt),
[definition-of-done.md](./definition-of-done.md). Security-specific debt also appears in
[.github/SECURITY.md](../.github/SECURITY.md); cross-link rather than duplicate.

---

## Open

### Mutating Server Actions are not rate-limited (V1-14a)

- **What & why (V1-14a):** V1-14a rate-limits only the **access gate**. The six mutating Server Actions
  in `app/p/[profileId]/actions.ts` are deliberately unlimited, because there is nothing meaningful to
  key a limit on yet. Their only identifier is `profileId`, read from `formData.get('profileId')` —
  caller-supplied and unauthenticated. An attacker rotates a fresh UUID per request for a fresh bucket;
  worse, real ids are non-enumerable UUIDv7 (SECURITY.md's anti-IDOR design), so an attacker cannot land
  in a real bucket even by accident. Such a limit would constrain **only the household**, while adding a
  Redis round-trip to every tap on the gym floor (an INP cost against the ADR-0001 budget).
- **Impact:** low today. Reaching these actions at all requires the gate cookie, which IS now rate
  limited; the app is a single household on an unlisted URL. The residual exposure is a gate-holder
  writing unbounded rows — annoying, not dangerous, and visible in the log.
- **Proposed fix:** **Clerk / v1.5.** `getCurrentUser()` + `household_id` is the first real identifier,
  and it is exactly what AGENTS.md's rate-limit line ("auth + mutations + `/api/sync`") presumes. Add it
  in that PR, keyed by user id, reusing the existing `checkRateLimit` seam (already fail-open + tested).
  `/api/sync` should land limited from day one — the batch flush is the genuine amplification endpoint.
- **Severity:** low (accepted until Clerk; the seam and its contract already exist).

### Sentry ships without source maps, so stack frames are minified (V1-14a)

- **What & why:** `next.config.ts` sets `sourcemaps.disable: true` and `pnpm-workspace.yaml` sets
  `'@sentry/cli': false`. Uploading source maps requires `@sentry/cli`, whose postinstall pulls a ~20MB
  binary into **every** install including CI (which never uploads) — the same complaint already logged
  against `@embedded-postgres` below — and would make a production build depend on that binary plus an
  auth token.
- **Impact:** Sentry stack traces point at bundled/minified frames. Diagnosis is slower, not impossible;
  server frames retain function names reasonably well.
- **Proposed fix:** flip BOTH switches together and add `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/
  `SENTRY_PROJECT` — worth doing the first time a real incident is hard to read, not before.
- **Severity:** low (a legibility cost on a 3-user app).

### The weekday → `day_role` schedule is a hardcoded app const, not data (V1-10 slice 2)

- **What & why (V1-10 slice 2):** which `day_role` a weekday programs lives in
  `apps/web/lib/programming/day-role-schedule.ts` as `DAY_ROLE_BY_WEEKDAY` — Ray's split hardcoded
  (Mon/Wed/Fri → Strength A/B/C, everything else → nothing). The schedule genuinely belongs on the
  `program_block` (a block _is_ a weekly plan), but a `block_schedule` table would ship a migration plus an
  authoring UI for data exactly one household can author, in a slice whose whole point was "no migration".
  So it is app **policy**, deliberately in `apps/web` and not `packages/shared` — it is not part of the
  cross-boundary contract, and nothing in the DB or engine may depend on it.
- **Impact:** low today (one household, one block, a split that hasn't changed). Two real limits: a second
  household would silently inherit Ray's split, and changing a training day is a **code change + deploy**,
  not an edit. There is no override affordance either (the panel deferred the `?strengthDay=` selector), so
  lifting Strength B on a Tuesday shows no card — the coach just types the movements, today's behavior.
- **Proposed fix:** **Clerk / multi-household (v1.5)** is the promotion trigger. At that point the map
  becomes per-block schedule rows (or a `program_blocks.schedule` column), `resolveDayRole` takes the
  block, and this const is deleted. If a day-role override lands before then it must validate against the
  **strength subset only** (`DAY_ROLE_TO_SESSION_TYPE[x] === 'strength'`), never all of `DAY_ROLES` — else a
  conditioning role could be forced into a strength session.
- **Severity:** low (accepted for the pre-Clerk single-household deployment; same class as the access gate).
- **Related, same slice — the card can shift layout on first paint (CLS).** `getActiveTimeZone()` falls
  back to `DEFAULT_TIME_ZONE` until `TimeZoneSync` writes the `tz` cookie and triggers `router.refresh()`
  (V1-6c). For a device in a zone whose local weekday differs at that moment, the first paint can resolve a
  different `day_role` — so this ~150px card can appear or disappear above the strength form after
  hydration. Inherited from V1-6c, but the card is a much larger shifting block than anything V1-6c
  introduced, and CLS < 0.1 is a stated budget. Harmless for Ray's household (one zone, cookie set after
  the first visit). **Fix when it bites:** reserve height for the card, or resolve the zone before first
  paint (a `middleware` hint) — the same change that would remove the V1-6c refresh flash generally.

### Coach routine editor: no real authz, and two accepted write semantics (V1-18 PR 2)

- **What & why (V1-18 PR 2):** the routine editor (`/p/[profileId]/routine` + `editRoutineAction`) ships
  behind the access-gate stopgap with **existence-only** ownership (re-resolve by `public_id`), like every
  other writer — profile tiles are "a UX switch, not a security boundary" (AGENTS.md). So ANY gate-holder can
  edit ANY kid's routine. It's reachable by URL only (no kid-facing edit affordance on Today), which limits
  discoverability but is **not** a security control. Two write semantics are also accepted, not bugs:
  - **Default-freeze (panel C4):** a kid whose `routine_config` is `NULL` renders the live default; saving
    from the editor **materializes** that default into the column, so the kid stops auto-tracking future
    catalog additions (a new check-in won't appear in their now-frozen order). Authoring a routine is an
    explicit opt-out of default-tracking.
  - **Last-write-wins clobber (panel C6):** the write is an unconditional `SET routine_config = …` with no
    client-`updated_at` LWW guard, so a stale second tab clobbers the first. No race with the kid logging on
    Today — that writes the `entries` table, a different column.
- **Impact:** low today (single trusted household, pre-Clerk, occasional edits). The BOLA gap is the real
  item; the two semantics are edge cases a single coach won't hit.
- **Proposed fix:** **Clerk v1.5** closes the authz gap — scope the DAL read + write by `household_id` (the
  ownership seam every writer already re-resolves through). The LWW clobber is paid down with the offline/sync
  LWW work (same `incoming >= stored` guard as the set-edit debt above). Default-freeze resolves naturally if
  the editor gains a "reset to default" affordance or the write skips a no-op-vs-default save.
- **Severity:** low (accepted for the pre-Clerk single-household deployment).

### `embedded-postgres` downloads a Postgres binary on every install, incl. CI that never uses it

- **What & why (PR #43; extended by chore/local-dev-db):** the ephemeral-DB screenshot flow
  (`apps/web/scripts/screenshot-ephemeral.ts`) and now the default local-dev launcher
  (`apps/web/scripts/dev-local.ts` — `pnpm dev`) both use `embedded-postgres` (a **dev** dependency) so
  neither a screenshot nor local play touches live Neon. Its platform package
  (`@embedded-postgres/<os>-<arch>`) fetches a real Postgres binary in a `postinstall` (allow-listed in
  `pnpm-workspace.yaml`). Pinned to a **beta** (`18.4.0-beta.17`). (Two consumers now — the tool is no
  longer manual-only, which slightly raises the value of keeping the binary available, but the CI
  install-cost concern below is unchanged: CI still never runs either flow.)
- **Impact:** every `pnpm install` — including the CI `quality` and `e2e` jobs, which provision
  Postgres via a **service container** and never invoke this tool — pays the binary download. Wasted
  install time/bandwidth for a manual-only, developer-facing utility. Low correctness risk.
- **Proposed fix:** make the binary fetch **on-demand / optional** rather than install-time — e.g.
  gate the `postinstall` off a CI env flag, move `embedded-postgres` behind an optional-dependency or
  a `pnpm install --filter` boundary the screenshot script triggers itself, or lazy-install on first
  `screenshot:ephemeral` run. Also **drop the beta pin** once a stable `embedded-postgres` releases.
- **Severity:** low (works today; purely an install-cost optimization).

## EntryDTO is a wide denormalized row-DTO (per-kind split deferred)

- **What:** `EntryDTO` (`apps/web/lib/dal/entries.ts`) has grown ~13 nullable fields across V1-4/5/6a/8-3
  (metric ×4, activity ×2, session ×3, superset ×2). Most are NULL for any given row kind (a bodyweight row
  carries no session/superset fields, etc.). Each V1-8-3 slice added its pair additively — the established,
  scope-disciplined pattern, but the denormalization now visibly compounds.
- **Impact:** low — correctness is fine (nullable + read at the right seam); it's a legibility/shape smell.
  The grouped `SessionItem`/`SessionRow` already re-hoist session/superset identity to the item level while
  members still carry the columns (mirrors 3a).
- **Proposed fix:** a per-kind discriminated DTO (`BodyweightDTO | StrengthDTO | CheckinDTO | …`) once the
  read surfaces stabilize (post-V1-8), so each row carries only its own fields. Deferred — not worth churning
  the last V1-8 slice.
- **Severity:** low.

## Set-edit LWW uses server-`now()`, not the client-supplied timestamp (V1-9)

- **What:** `updateStrengthSetById` (`packages/db/src/writers/strength-session.ts`, V1-9) advances
  `entry_sets.updated_at` to the DB `now()` on each edit. The AGENTS.md schema convention mandates
  last-writer-wins on the **client-supplied** `updated_at`/`version` (`setWhere incoming >= stored`) so
  offline clock-skew resolves correctly.
- **Impact:** none today — there is a single ONLINE writer (no offline outbox until v1.5), so `now()` is
  always `> created_at` and no two devices race an edit. Correct for the current deployment.
- **Proposed fix:** at **v1.5** (offline + TanStack Query + the sync outbox), take the client `updated_at`
  in `editStrengthSetSchema`, thread it into the writer, and add `.where(incoming >= stored)` to the UPDATE
  (the same LWW guard the sync path applies to every mutable row). The writer edge already flags the spot.
- **Severity:** low (deferred with the rest of the offline/LWW work).

## `profiles.routine_config` is JSONB — a knowing exception to the typed-columns rule (V1-18)

- **What & why (V1-18 PR 1a):** the per-kid routine (ordered activity keys) is stored as a nullable JSONB
  blob (`routineConfigSchema` in `@mat-plan/shared`) instead of a `routine_items` table. Deliberate: the
  first slice only _renders_ the ordered list (`order.map` over the existing forms, PR 1b) — nothing
  queries/joins/filters INTO it, key validity is enforced on read (`resolveRoutine`, drop-unknowns), and
  `null → the default routine` ships dark with no backfill. AGENTS.md "JSONB only for opaque sync/device
  metadata; values stay in fixed typed columns" — routine config is borderline structured, accepted for the
  first slice per the V1-18 design→eng investigation (docs/plans/v1-18-*).
- **Impact:** low now (single-household, hand-seeded, read-only render). Grows if V1-10 needs to schedule /
  join / query routine rows.
- **Promotion trigger (explicit):** promote to a `routine_items` table (bigint identity PK, UUIDv7
  public_id, `profile_id` FK + covering index, `position` ordinal + partial-unique per profile,
  `activity_key` text, `conditional` → a real typed column, the per-kid check-in allowlist as rows) the
  **first time V1-10 needs to query INTO the routine** — generate rows from a program schedule, JOIN routine
  to sessions/day, or filter by conditional/day. Expand→backfill(from JSONB)→contract; keep the default as
  the seed. Until then JSONB + zod-on-read stays.
- **Severity:** low.
