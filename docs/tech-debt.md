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

### The access-gate matcher excludes `/api`, so any Route Handler there is ungated (found 2026-09-24)

- **What & why:** `apps/web/proxy.ts` matches `'/((?!api|_next/static|_next/image|favicon.ico).*)'`.
  The `api` exclusion is a copied Next default and has never been exercised, because **the repo has
  no `/api` routes**. The moment one exists it is **completely ungated** — no access-gate cookie
  required, nothing between the internet and the handler.
- **Impact:** high, and **latent by construction** — it cannot be noticed until the first `/api`
  route ships, at which point it is already live. AGENTS.md plans **`/api/sync`** explicitly ("reads
  / external / batch → Route Handlers. `/api/sync` is a Route Handler"), which would be a
  write endpoint for the entire offline replay graph.
- **Found how:** V1-13b's CSV export was about to be `/api/export`. It ships at
  `/p/[profileId]/export` instead — inside the matcher — and re-checks the gate in the handler anyway,
  because middleware is not an authorization boundary. The e2e asserts a cookie-less request never
  gets a 200.
- **The fix, when `/api` is needed:** either drop `api` from the exclusion and let the gate cover it,
  or require every handler to call the gate check itself and **prove it with a test per route**. The
  first is one character and covers the class; the second is the AGENTS.md rule ("every Route Handler
  is a PUBLIC endpoint") and does not depend on a matcher staying correct. Do both.
- **Payoff trigger:** the first `/api` route — realistically `/api/sync` at v1.5.

### Test-time path overrides are ad-hoc, so gates quietly go vacuous (audit, 2026-09-24)

- **What & why:** there is **no consistent way to force a code path for a test**, so each one invents
  its own — and when a path cannot be reached, the test tends to **skip or pass vacuously rather than
  fail**. Three live instances, all found the same week:
  - **The scaffold a11y check self-skipped 4 days in 7.** It ran only when the seeded program had
    movements _today_ (Mon/Wed/Fri), so GAP-3 PR 4a shipped without it ever running. Worse, the skip
    conflated "not a programmed day" with "the button regressed" — a real regression on a Monday would
    have gone green. Fixed in #141 by **shifting the Playwright context timezone** to reach an adjacent
    programmed day, which works only because every unprogrammed day happens to be adjacent to a
    programmed one and a tz can move a date by exactly ±1. It is a workaround, and it is the _good_
    case, because at least it is deterministic.
  - **`expectTapTargets` skips invisible controls** (`a11y.spec.ts`), so anything behind a disclosure
    passes without being measured. A collapsed UI can be entirely broken and green.
  - **`INTERACTIVE` excludes `<a>`**, so any control built from `<Link>` is measured by nothing —
    which is exactly what V1-15's day arrows and week strip are.
- **Impact:** high, and **silent** — the failure mode is a green check that proves nothing, which is
  strictly worse than no check, because it is trusted. This is the same class as the five CI gates
  AGENTS.md claimed for months that did not exist.
- **The audit:** walk every gate and ask **"can this go vacuous, and would anyone notice?"** Then give
  the app **one deliberate seam for test-time path selection** instead of per-test cleverness — a
  seeded fixture that covers every weekday, an explicit day override (V1-15's `?d=` is the first real
  one), and a rule that a gate **fails rather than skips** when its precondition is unmet.
- **Payoff trigger:** V1-15, which lands `?d=` — the first honest override and the natural moment to
  do the sweep. Any new `test.skip()` on a precondition should be treated as a finding until then.

### Several files have outgrown their shape; shared values are re-derived per call site (audit, 2026-09-24)

- **What & why:** growth has concentrated rather than spread, and the big files are where reuse gets
  missed. `packages/db/scripts/verify.ts` is **~3,000 lines** of sequential proofs with assertion
  helpers (`expectRejectedBy`, `columnsOf`, `assertCheckCoversConst`) that had to be _rediscovered_
  mid-edit; `apps/web/app/p/[profileId]/page.tsx` is ~390 lines doing profile resolve, day derivation,
  five reads and the whole render; `strength-form.tsx` is ~660. Concrete symptoms already paid for:
  - **A bidirectional reference-table parity loop was open-coded twice** before `assertRefTableMatches`
    was extracted (GAP-3 PR 3).
  - **`unitsOfDimension` and `UNIT_LABELS` sat unused** while a plan proposed hand-writing both
    (caught by a panel, GAP-3 PR 4a).
  - **`resolveDeclaredDay` was about to be duplicated** as a second near-identical day resolver in a
    different directory (caught by a panel, V1-15).
  - **"Untouched card" is computed in THREE places** from the same fields; PR 4a had to extend all
    three, and missing one silently deletes an athlete's logged set.
- **Impact:** medium, compounding. Nothing is broken; the cost is paid per change, as research time
  and as near-miss duplication that only a panel catches. The **feature guides** (#140) treat the
  symptom — they tell you the map — but the map is large because the files are.
- **The audit:** for each file over ~300 lines, ask what would split cleanly along a seam that already
  exists (the day-view vs the forms; the proof groups in `verify.ts`), and sweep `packages/shared` for
  exports with **zero callers** — each is either a missing reuse or a deletion.
- **Explicitly NOT a rewrite.** Split only where a change is already coming, so the move rides a PR
  that has to touch the file anyway. A refactor-for-its-own-sake PR at ~4h/wk is the wrong trade, and
  a big mechanical diff is the hardest kind to review.
- **Payoff trigger:** the next PR that touches one of the named files. V1-15 touches `page.tsx`.

### `apps/web`'s drizzle peers are incidental, so a dep bump can split `drizzle-orm` in two

- **What & why:** `apps/web` declares `drizzle-orm` but **none of its optional peers** — `pg`,
  `@types/pg`, `@electric-sql/pglite` are declared **only in `packages/db`**. So `apps/web`'s peer
  resolution is whatever pnpm happened to pick, not something we state. Dependabot's lockfile updater is
  **minimal by design**: it rewrites the input it bumped and leaves the rest of drizzle's five-part peer
  key frozen. Bump one peer package and the two workspaces can end up on **two copies of the same
  `drizzle-orm` version**, which TypeScript treats as nominally distinct (private `shouldInlineParams`) —
  so every `eq()`/`and()` across the seam fails and `next build` dies at type-check **in files the PR
  never touched**.
- **Impact:** medium, and **recurring**. Two samples so far:
  - **#111** — `pg` ^8.22.0 → ^8.23.0 **broke it**. `@dependabot recreate` reproduced a byte-identical
    commit; `pnpm dedupe` and `pnpm.overrides` both produced **zero churn**. Fixed with
    `pnpm update pg --recursive`.
  - **#112** — bumped **two** more peer-key packages (`@types/pg`, `@electric-sql/pglite`) and **did not
    break**, because the merge conflict forced a lockfile **regeneration**, which re-resolves the whole
    peer key at once. The weakness wasn't fixed there, it just wasn't triggered.
  - **The tell:** read the full `.pnpm/` paths in the type error — they differ only in one peer segment.
    Diagnosis is that one line; without it this reads as an inscrutable drizzle bug.
- **Proposed fix:** declare `pg`, `@types/pg` and `@electric-sql/pglite` in `apps/web` so dependabot bumps
  both workspaces together and the peer is **stated rather than inferred**. Costs three declared-but-
  unimported devDeps. (`pnpm.overrides` is the alternative, but it only takes effect at lockfile-creation
  time — verified inert on an already-pinned peer — and needs manual bumping.)
- **Trigger:** the next dependency PR that bumps **exactly one** peer-key package **and merges without a
  conflict**. A conflict masks the bug by forcing regeneration, so a _clean_ dep PR is the dangerous one.
- **Severity:** medium — never reaches production (it fails the build), but it burns a full debugging
  cycle each time and looks nothing like its cause. Symptom → fix is in
  [lessons.md](./lessons.md) → **pnpm / build**.

### A labeled set can't be edited, and a duration isn't structurally queryable (GAP-1 P0-2)

- **What & why:** GAP-1 P0-2 made `entry_sets.weight_label` writable, so a set can finally record `BW`,
  `band`, `30in` or `30s` instead of the lie of `weight: 0`. Two knowingly-accepted consequences:
  - **A labeled set has no inline edit.** `isEditableSet` excludes it (an edited `weight_num` would be
    masked at the read seam, since `formatSetLine` prefers the label) and `updateStrengthSetById` refuses
    it in SQL. So a mistyped `BW` can only be fixed by deleting the entry — which needs **V1-9b**
    (delete/clear-day), not yet built. Mitigated by the chips: the common labels are one tap, not typed.
  - **A duration lives in `weight_label` as `30s`, not in `entry_sets.seconds`.** That column stays
    unwritten. It reproduces the CSV exactly (the contract puts duration in the `load` column), but the
    value is text, so nothing can sum time-under-tension.
- **Impact:** low. Labels are a minority of sets, and the chips make the common ones un-typoable.
- **Proposed fix:** V1-9b closes the edit gap. `seconds` gets written when something queries duration
  structurally — **V1-16 progress charts is the promotion trigger**; at that point a timed set writes
  both `seconds` and the label (the two columns are deliberately not mutually exclusive — see below).
- **Severity:** low (accepted; both have named triggers).

### `weight_num` and `weight_label` are deliberately NOT mutually exclusive (GAP-1 P0-2)

- **What & why:** no CHECK enforces "exactly one of". That is a decision, not an oversight. Several real
  loads carry a recoverable number inside a text form — `123 (50ft)`, `30 (2x 15 DB)`, `BW+8 (vest)`. A
  later slice should store **both** (`weight_num = 123` _and_ the label) so volume charts aren't blind to
  them, and the read seam already prefers the label while the edit guard already refuses any labeled set,
  so coexistence is pre-defended.
- **Impact:** none today — the writer emits exactly one. The cost is that a future reader must not assume
  exclusivity.
- **Proposed fix:** implement numeric-prefix extraction when V1-16 needs the volume. **Do not add a
  mutual-exclusion CHECK** — it would be a breaking migration and would foreclose the above.
- **Severity:** informational.

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

### Local/CI parity gaps (measured 2026-09-24; e2e gap closed 2026-09-23)

- **What & why:** following the [CI gate audit](#) below, every check was actually run locally and timed.
  **`pnpm verify` now covers the fast set in ~25s** (`format:check` · `lint` · `typecheck` · `test` ·
  `db:verify` · `audit --prod`), and **`pnpm e2e:local` now runs the Playwright smoke** (the gap that
  actually mattered — see below). Two gaps remain, both by choice:

  | Gap                                 | Cost to close | Notes                                                                                                                                                                                       |
  | ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **`next build` is not in `verify`** | Zero          | Deliberate: it is the slowest step and CI runs it. Run `pnpm build` manually when touching anything build-shaped. (`e2e:local` builds it as a side effect, so a smoke run covers this too.) |
  | **gitleaks / forward-only guard**   | n/a           | gitleaks is installable locally (and is, here); the forward-only guard is inherently a diff-against-base check and has no meaningful local form.                                            |

- **CLOSED — the Playwright smoke now runs locally (`pnpm e2e:local`).** `playwright.config.ts`'s
  `webServer` builds and starts the app but provisions **no database**; it inherits `DATABASE_URL`
  (→ `.env.local` → live Neon), which is why the smoke was CI-only. `apps/web/scripts/e2e-local.ts`
  supplies the missing piece the same way CI does — boot a **Dockerless** `embedded-postgres` (the
  existing `scripts/embedded-pg.ts` helper, already behind `dev-local` and `screenshot:ephemeral`),
  migrate + seed it with the `packages/db` scripts, then run `playwright test` with that DB, a local
  gate code and a free port injected — and deletes the cluster on exit. **This supersedes the
  long-standing "e2e needs real Postgres, can't run locally" assumption** (true before the embedded-pg
  work, #43/#46). Residual, accepted: it is a **throwaway** Postgres 18 cluster, not CI's `postgres:17`
  service container, and the run costs minutes (it builds the prod app), so it stays out of `verify`.
- **Impact:** low — the remaining two gaps are a deliberate speed trade and a check with no local form.
- **Severity:** low.

### 20 pre-existing Squawk findings on `main` are never linted (accepted 2026-09-24)

- **What & why:** Squawk (GAP-3 PR 1b) lints **added migrations only**. All-files is not viable — 20
  findings remain across 6 migrations already on `main`, and Squawk has **no baseline or suppression
  feature**, so an all-files gate would be red on arrival and get disabled rather than fixed.
- **Are they bugs? Mostly no.** `0009`'s own comment names the Squawk objection and justifies it: the
  column is created in the same statement, so every existing row is NULL, `NULL in (...)` is NULL, and a
  CHECK passes on anything but FALSE — the validating scan reads rows that cannot fail, on a few dozen
  rows. `0008`'s is on still-empty V1-10 tables. These were reasoned, not missed.
- **Impact:** low, but the gate **silently implies `main` is clean**, which it is not. Recorded so that
  implication is not mistaken for a fact.
- **Also still unenforced:** `require-concurrent-index-creation` is excluded, because `CONCURRENTLY`
  cannot run inside drizzle's per-file transaction and the transaction-stripping runner AGENTS.md
  describes **does not exist**. So AGENTS.md's "Indexes CONCURRENTLY" rule remains review-enforced only.
- **Severity:** low.

### The Neon-branch migration apply is the last unwired CI gate (audit 2026-09-23)

- **What & why:** the DB-safety reviewer on GAP-3's panel checked the plan's claim that _"Squawk hard-fails
  a `DROP COLUMN` alongside app code"_ and found **no Squawk in CI at all**. Auditing the rest of
  [AGENTS.md](../AGENTS.md)'s required-checks list against `.github/workflows/` turned up **five** gates the
  rules claimed and the workflows never had. Four have since been wired; **one is left**:

  | Gate AGENTS.md claims                                           | Reality                                                                                                                   |
  | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
  | format · lint · typecheck · test · build · gitleaks · e2e       | ✅ present (`format:check` and `pnpm build` are the prettier/next-build steps — easy to miss by name)                     |
  | DB **drift guard** + `db:verify`                                | ✅ present                                                                                                                |
  | **Forward-only guard** (blocks `M` on `packages/db/migrations`) | ✅ wired — `ci.yml` `quality`, PRs only (#134)                                                                            |
  | **Squawk** migration lint                                       | ✅ wired — `ci.yml` `quality`, added migrations only (#135)                                                               |
  | **`pnpm audit`** (fail high/critical)                           | ✅ wired — `audit --prod --audit-level high`, inside `pnpm verify`                                                        |
  | **CodeQL**                                                      | ✅ wired — `codeql.yml`, but **not a PR check** (see below)                                                               |
  | **Neon-branch apply** on PRs                                    | ❌ **still absent** — `migrate.yml` runs only on merge to `main`, and warns-and-skips if `DATABASE_URL_UNPOOLED` is unset |

- **What CodeQL being "wired" does and does not mean.** `codeql.yml` runs `javascript-typescript` over the
  whole workspace on **push to `main`, weekly (Mon 06:17 UTC), and `workflow_dispatch`** — deliberately
  **not** on pull requests, because a minutes-long scan on every <400-line PR is the wrong trade at ~4h/wk.
  So a green PR proves nothing about CodeQL, and findings only ever appear in **Security → Code scanning**.
  Two live caveats:
  - **Unverified precondition: this is a PRIVATE repo on a personal account.** Code scanning needs GitHub
    Code Security (Advanced Security) there; `GET /code-scanning/default-setup` currently returns
    `403 Code scanning is not enabled`, which is the same response for "not licensed" and for "not
    configured yet". If the plan does not include it, the `analyze` step will fail on the **first push to
    `main` after merge** with "Advanced Security must be enabled" — loudly, and blocking nothing. That
    first run is the real test; until it is green, treat CodeQL as claimed-not-proven.
  - **No `pnpm install` before extraction**, so cross-package `@mat-plan/*` imports are not resolved and
    dataflow does not reach across workspace boundaries. Deliberate: it keeps a minute and a lockfile-drift
    failure mode out of a weekly job, for reach a 3-user app does not need. Revisit if a finding is ever
    obviously truncated at a package seam.
- **Impact of the remaining gap:** a migration's first real execution is still **on production**. The
  drift guard, `db:verify` (PGlite), forward-only and Squawk all run pre-merge, so the shapes that were
  genuinely dangerous are now caught; what is missing is the prod-shaped rehearsal — a migration that is
  valid SQL, passes Squawk, and still fails against real data/row counts would not surface until merge.
- **Why it went unnoticed:** the rules were written as the intended end state and never re-verified.
  `db:verify` and the drift guard _are_ real and genuinely good, which makes the DB section read as
  covered at a glance. The lesson generalizes: **do not cite a gate without opening `.github/workflows/`.**
- **Proposed fix:** a PR job that cuts a Neon branch from `main` and applies the migration against it
  (AGENTS.md's "(b) a Neon branch cut from main"). Needs a Neon API token in repo secrets and a
  create/delete branch step — the reason it has been deferred is credentials plus per-PR cost, not
  difficulty. Trigger: the first migration whose risk is **data-shaped** (a backfill over real row counts)
  rather than shape-shaped — GAP-3's backfill step is the candidate.
- **Severity:** medium — the highest-value DB gates now exist; this is the remaining one, and it is the one
  that costs money and a token rather than a workflow step.

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
- **Proposed fix:** ~~**Clerk / multi-household (v1.5)** is the promotion trigger.~~ **Amended 2026-09-18
  — the trigger is now whichever of Clerk or MOT-1 lands first.** MOT-1's streak has to know what is
  **due** on a given day or it breaks on a correctly-taken rest day, and that needs the same schedule
  rows — for a **single** household, with no Clerk involved. Folded into **SCHED-1**
  ([plan.md](./plan.md)), which treats scheduling as one primitive serving this const, `routine_config`'s
  missing schedule, and the streak. Original reasoning, still correct as far as it went: Clerk /
  multi-household (v1.5) is the promotion trigger. At that point the map
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
  edit ANY kid's routine. **Updated V1-23 (2026-09-26): it is no longer URL-only** — Today now renders an
  `→ Edit {name}'s routine` link below the logged-entries list, so anyone past the access gate reaches the
  editor in one tap. The obscurity was never a security control, so nothing regressed; but the sentence this
  entry used to carry ("reachable by URL only … limits discoverability") is now false, and the mitigation it
  implied is gone. **The gap was knowingly accepted when the link shipped**: there is no Clerk until v1.5,
  the household is three people behind one shared access gate, and the alternative — leaving the coach
  affordance undiscoverable to make a BOLA hole feel smaller — is security theatre that costs the feature.
  Two write semantics are also accepted, not bugs:
  - **Default-freeze (panel C4):** a kid whose `routine_config` is `NULL` renders the live default; saving
    from the editor **materializes** that default into the column, so the kid stops auto-tracking future
    catalog additions (a new check-in won't appear in their now-frozen order). Authoring a routine is an
    explicit opt-out of default-tracking.
  - **Last-write-wins clobber (panel C6):** the write is an unconditional `SET routine_config = …` with no
    client-`updated_at` LWW guard, so a stale second tab clobbers the first. No race with the kid logging on
    Today — that writes the `entries` table, a different column.
- **Two sharp edges the V1-23 link now EXPOSES to whoever finds it — deliberately not fixed there:**
  - **A kid can remove `strength` itself and make the session unloggable, with nothing on screen saying
    why.** `strength` is the first entry in `ROUTINE_CATALOG` and gets a `Remove` button like any other
    row; Today's strength block is routine-DRIVEN, so dropping the key removes the program card **and**
    the whole strength form. The kid then sees a Today with no way to log their session and no
    explanation — the failure is silent and looks like a bug, not a setting they changed.
  - **`Remove` fires with no confirm, and re-adding APPENDS — so the authored order is unrecoverable.**
    `toggle()` (`apps/web/lib/routine/editor.ts:19-23`) filters on remove and `[...order, item]` on
    re-add, so a mis-tapped `Remove` + `+ Add` puts the row at the BOTTOM; the only way back is the
    ▲▼ buttons, one step at a time. There is no undo and no "restore default routine".
  - **Fix when it bites:** a confirm (or undo) on `Remove`, a "Restore default routine" button, and
    either pinning `strength` or an empty-state on Today explaining that strength is off this routine.
    Ray deferred all three when the link shipped (V1-23 PR 2); use the app for a week first.
- **Impact:** low today (single trusted household, pre-Clerk, occasional edits). The BOLA gap is the real
  item; the two semantics are edge cases a single coach won't hit. The two sharp edges above are newly
  **reachable** as of V1-23 — still low (one coach, three kids), but no longer hidden behind a URL.
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
