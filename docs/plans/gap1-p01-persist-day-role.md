# GAP-1 P0-1 — persist `day_role` on a logged session

> Backlog: [plan.md](../plan.md) row GAP-1 · analysis: [csv-recording-gaps.md](../csv-recording-gaps.md).
> Branch: `db/gap1-p01-persist-day-role` (off `main`). **Has a migration.** Significant → committed plan
>
> - adversarial panel before implementation.

## Goal

**`session_type` on a logged session can only ever be the literal `strength`.** Three facts compound:

1. `SESSION_TYPES` has no `strength_a` — the split days live in `DAY_ROLES`, a **deliberately separate**
   concept ("`session_type` is what a logged session IS; `day_role` is what a program day PRESCRIBES" —
   `programming.ts`).
2. `day_role` is **derived from the weekday at read time** and **never stored**.
3. `logStrengthSessionAction` **deliberately omits** `sessionType`, so the zod default fires.

So the CSV's `session_type` column — which must carry `strength-a`/`-b`/`-c` — can never be right, and
nothing can answer "which programmed day was this?" after the fact.

## The decision this slice turns on — and the argument that settles it

The first draft asked "selector vs auto-derive" and then contradicted itself, adopting a selector whose
default _was_ the guess it had just argued against. The panel supplied the decisive framing:

> **Export-time derivation is retroactively fixable. A persisted derivation is not.**

`DAY_ROLE_BY_WEEKDAY` is a documented stopgap due for deletion at Clerk/v1.5. If the export derives the
role, replacing that map re-corrects **every historical row**. If the write path _persists_ the map's
output, the guess is frozen into rows that can never afterwards be distinguished from a human
assertion — and it feeds the CSV and Ray's retro looking authoritative.

**So the column's entire value is PROVENANCE: a non-null `day_role` must mean _a human said so_.**

That yields three rules, and they are the plan:

- **A visible `<select>`, never a hidden input and never a silently-applied default.** The default is
  pre-selected (so the common path stays one submit) but it is _on screen_ and changeable.
- **An explicit "Not a programmed day" option**, which is the default on Tue/Thu/Sat/Sun
  (`resolveDayRole` → null) — rather than hiding the control, which would make "no role" indistinguishable
  from "never asked".
- **No forced confirmation tap.** Kids log on a gym floor.

**If the selector is rejected, the correct fallback is to DROP this slice** and derive at export time —
**not** to auto-persist. Revisit when V1-19's "Start today's program" supplies the role as a byproduct
of an explicit action, which is the ideal provenance.

## Acceptance

- A logged strength session stores the day the athlete **asserted**, including off-schedule days.
- No role selected → NULL, and the session logs normally.
- **Absent and blank both yield NULL**, not a validation error (see D2 — this is the known trap).
- The stored role is **visible on the Today log**, so a wrong value is discoverable without an exporter.
- Existing rows are untouched and still render.

## Design decisions

**D1 — A new nullable `sessions.day_role`; do NOT widen `session_type`.** Widening `session_type`'s
CHECK would collapse two concepts `programming.ts` explicitly keeps apart. Two columns, one meaning each.
`text` + CHECK against the shared `DAY_ROLES`, mirroring `prescriptions.day_role`; **no `pgEnum`**.
`db:verify`'s `assertCheckCoversConst` pins the CHECK to the const. The constraint name
`sessions_day_role_check` is distinct from `prescriptions_day_role_check`, which matters — that helper
asserts exactly one `pg_constraint` row.

**D2 — `optionalDayRoleSchema` in `packages/shared`, normalising absent AND blank to `undefined`.**
This is the trap `strength-session.ts` already documents for `sessionType`: `formData.get()` yields
`null` when absent and `''` when the "Not a programmed day" option is chosen, and `z.enum().optional()`
rejects **both**. Mirrors `freeTextNoteSchema`'s blank→undefined shape rather than re-deriving it, and
the action passes `formData.get('dayRole') ?? undefined`.

**D3 — Cross-field refine using `DAY_ROLE_TO_SESSION_TYPE`, not a hardcoded `'strength'`.** The
invariant this change introduces is `DAY_ROLE_TO_SESSION_TYPE[day_role] === session_type`. Expressing it
against the existing map keeps it DRY and correct if `sessionType` ever becomes settable.
**No DB CHECK for the pairing** — folding role↔type pairs into `sessions_day_role_check` would inject
extra literals and break `assertCheckCoversConst`'s exact-set assertion. The invariant is stated in the
schema comment (the `prescriptions` precedent).

**D4 — Migration: hand-augmented, and the DDL choice justified in the file.** `drizzle-kit generate`
emits neither the timeouts AGENTS.md mandates nor `IF NOT EXISTS`; `0007`/`0008` are
generated-**then-edited**, and this follows them. Written explicitly:

```sql
-- GAP-1 P0-1 — persist which programmed day a logged session was.
-- Bound lock acquisition + statement runtime before the DDL (AGENTS.md DB rules). drizzle-kit migrate
-- wraps each file in a transaction, so these apply to it.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "day_role" text;

-- Plain (validating) ADD CONSTRAINT, NOT `NOT VALID`, deliberately: `sessions` is the first POPULATED
-- table to take a new CHECK, so the usual Squawk objection applies — except the column was created NULL
-- in the statement above, and `NULL in (...)` is NULL, which a CHECK passes. The validating scan
-- therefore reads rows that cannot fail, on a table of a few dozen. `NOT VALID → VALIDATE` would also
-- have to live in this same file (one migration per PR) inside one transaction, which is theatre.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_day_role_check"
  CHECK ("day_role" in ('strength','conditioning','skill','push','pull','legs','core','strength_a','strength_b','strength_c'));
```

**D5 — Export precedence, stated now so V1-13 doesn't rediscover it.** CSV `session_type` ←
`day_role ?? session_type`, hyphenated at the edge (`strength_a` → `strength-a`); the DB never knows
about hyphens. **A NULL `day_role` emits bare `strength`, which is NOT in the contract's observed value
set** (`trainer`, `strength-a`, `home-pull`, `home-push`, `private`) — flagged here as a V1-13 decision,
not silently deferred.

**D6 — The read path shows the stored role.** `DAY_ROLE_LABELS[dayRole] ?? SESSION_TYPE_LABELS[type]` on
the session block. Without this, a mis-stored role is invisible until an exporter that doesn't exist yet
— which is exactly what makes a persisted value dangerous. This is what makes the provenance argument
hold in practice rather than in principle.

**D7 — Write-once, and the remount reset.** `insertStrengthSessionRow` is `onConflictDoNothing` on
`client_id`, so `day_role` is write-once like `feel`: a replay with the same `clientId` silently no-ops.
And `StrengthForm` remounts on success (`key={gen}`), so an override resets to the weekday default for
the next session that day. Both intended; both stated so neither is discovered as a bug.

## File-by-file changes

| Path                                                         | New/Edit | What & why                                                                                 |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------ |
| `packages/db/src/schema.ts`                                  | EDIT     | `sessions.dayRole` + CHECK + the invariant comment (D3)                                    |
| `packages/db/migrations/0009_*.sql`                          | NEW      | the SQL in D4, verbatim                                                                    |
| `packages/shared/src/programming.ts`                         | EDIT     | `optionalDayRoleSchema` (D2)                                                               |
| `packages/shared/src/strength-session.ts`                    | EDIT     | `dayRole` on the log schema + cross-field refine (D3)                                      |
| `packages/db/src/writers/strength-session.ts`                | EDIT     | pass `dayRole` into the `sessions` insert                                                  |
| `apps/web/lib/dal/entries.ts`                                | EDIT     | thread `dayRole`; add to `EntryDTO` for D6                                                 |
| `apps/web/app/p/[profileId]/actions.ts`                      | EDIT     | `formData.get('dayRole') ?? undefined`                                                     |
| `apps/web/app/p/[profileId]/page.tsx`                        | EDIT     | thread the resolved role into `StrengthForm`; render D6                                    |
| `apps/web/app/p/[profileId]/strength-form.tsx`               | EDIT     | the visible `<select>` + "Not a programmed day"                                            |
| `apps/web/app/p/[profileId]/strength-session-schema.test.ts` | EDIT     | absent/blank → NULL; bad role rejected                                                     |
| `packages/db/scripts/verify.ts`                              | EDIT     | CHECK parity, round-trip **via `writeStrengthSession`**, NULL insert, bad literal rejected |
| `docs/plan.md` · `docs/status.md`                            | EDIT     | GAP-1 row links this plan; status rides with the work                                      |

## Test plan

- **`db:verify`:** `assertCheckCoversConst('sessions_day_role_check', DAY_ROLES)`; a session with a role
  and one with NULL both round-trip **through `writeStrengthSession`** (not a raw insert — the writer's
  pass-through is precisely the thing most likely to be forgotten); a garbage literal rejected via
  `expectRejectedBy`.
- **Boundary:** absent → NULL; `''` → NULL; `conditioning` rejected (D3); `'nope'` rejected.
- **Screenshots:** tri-viewport, **two states** — a strength day (default pre-selected) and a Tuesday
  (default "Not a programmed day", which is where the control's value is least obvious).

## Risks / rollback

- **The advertised DB gates do not exist.** Verified: `ci.yml`'s only DB steps are the `db:generate`
  drift diff and `db:verify`; **Squawk is not wired anywhere**, and `migrate.yml` early-exits with
  `DATABASE_URL_UNPOOLED secret not set — skipping (Neon not wired yet)`. So this migration is exercised
  **only against PGlite on an empty database**. That is why D4 writes the lock profile by hand and
  justifies the DDL in the file — nothing downstream will catch it. **This gap is worth its own issue.**
- Additive and expand-only; rollback is fix-forward (a drop is a contract step, separate deploy).
- A wrong stored role is the residual risk, mitigated by D6 making it visible.

## Out of scope

`prescribed` (P1-2); the CSV export (V1-13); backfilling historical sessions; retiring
`DAY_ROLE_BY_WEEKDAY` (Clerk/v1.5).

---

## Panel review log — reconciled

- **BLOCKING — the `null`/`''` wire trap**, verbatim the bug this repo already documents for
  `sessionType`. → D2.
- **BLOCKING — "generated" was wrong**: `0007`/`0008` are generated-then-hand-augmented with the
  timeouts, `IF NOT EXISTS`, and a justifying header. Verified. Also: drizzle emits a **validating**
  `ADD CONSTRAINT`, and `sessions` is the first POPULATED table to take a new CHECK — the plan was
  silent on the one DDL decision a DB reviewer must see. → D4 writes the SQL verbatim and justifies it.
- **BLOCKING — the plan contradicted itself on Q1.** Accepted wholesale, including the framing that
  beats the original ("export-time derivation is retroactively fixable; a persisted one is not") and the
  fallback that if the selector is rejected the answer is to **drop the slice**, not auto-persist. → D6
  added so the value is visible, which is what makes provenance real rather than rhetorical.
- **VALUABLE — the test plan claimed CI gates that don't exist.** Verified: no Squawk, Neon skipped. Now
  stated honestly in Risks, and flagged as deserving its own issue.
- **VALUABLE — "blocks P1-2" was overstated.** A stored `day_role` doesn't pin _which_ block/prescription
  was fulfilled; the durable link is `entries.prescription_id`. Demoted to necessary-but-not-sufficient;
  the CSV justification stands alone.
- **Accepted:** cross-field refine over hardcoded `'strength'` (D3); export precedence + the NULL case
  (D5); write-once/remount semantics (D7); round-trip via the writer, not a raw insert; the missing
  files (`page.tsx`, tests, `docs/plan.md`, `docs/status.md`); the 3-column table and this log.
- **Answers:** Q2 `sessions` (every strength entry has one — `scLift` has a single call site, and on
  `entries` it would be one value denormalised across N rows). Q3 keep the strength subset. Q4 **yes**,
  show it (→ D6). Q5 not a question: `NULL in (...)` is NULL and a CHECK fails only on FALSE — converted
  into two `db:verify` assertions.
