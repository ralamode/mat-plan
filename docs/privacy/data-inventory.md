# Data inventory — the evidence behind the privacy notice

**[notice.md](./notice.md) is the document people read. This file is why it is true.**

Every factual claim in the notice traces to a row here, and every row here traces to code. Derived by
walking `packages/db/src/schema.ts` and the third-party call sites — **not from memory**, which is the
only way a notice about minors' health data is worth anything.

> **Derived at `38f62de`, 2026-10-07** (PRIV-1, [plan](../plans/priv-1-privacy-review.md)).
>
> **Is it stale?** Run this; if it prints anything, re-read the sections those files feed:
>
> ```bash
> git log --oneline 38f62de..HEAD -- packages/db/src/schema.ts apps/web/lib/dal \
>   apps/web/proxy.ts apps/web/sentry.server.config.ts apps/web/lib/sentry-scrub.ts \
>   apps/web/lib/rate-limit.ts .github/workflows
> ```

**Citation policy.** This file cites **path + symbol** (`access-gate.ts` → `PUBLIC_PATHS`), not
`path:line`. Line cites rot on the next edit above them, which [ADR 0006](../decisions/0006-household-addressing.md)
already paid for once (finding C2: ~20 cites resolving to unrelated text). Symbols are greppable and
survive.

**Re-review triggers.** The standing trigger is `AGENTS.md`'s privacy-lens list and
[review-pr](../../.claude/skills/review-pr/SKILL.md) rubric dimension 10 — the schema, the DAL, an
export, logging, a new dependency, a third-party call. **This file adds three deltas**, which are the
ways this inventory specifically goes wrong:

1. **A new processor**, or a change to what an existing one receives.
2. **A changed vendor retention window** (the three unconfirmed ones below, once confirmed).
3. **A writer appears for a column this file says is unused** — `profiles.birthdate`,
   `profiles.avatar`, `entries.notes`, `day_readiness.note`, `supersets.note`. That is the exact
   mechanism by which the notice goes wrong first: not a new column, but an old one waking up.

---

## 1. What the database holds

**18 tables. Twelve are household-reachable** and hold personal data; six are reference data. Listed
exhaustively, including the ones holding nothing — **absence is a claim too**, and a reader should be
able to check coverage rather than trust it.

Every household-reachable table carries `created_at`, `updated_at` and `deleted_at` (`schema.ts` →
`timestamps`), and `deleted_at` is a **soft** delete — see §5.

### 1a. Household-reachable (personal data)

| Table                  | Personal columns                                                                                                                                                                             | Notes                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `households`           | **`name`** (free text, NOT NULL)                                                                                                                                                             | Typically a family name. The notice must tell an adult this is stored.                                            |
| `profiles`             | **`name`** (free text, NOT NULL) · **`kind`** `'kid'｜'adult'` — **the column that marks a row as a minor** · `avatar` · `routine_config` (jsonb) · `birthdate` ⚠️ · `pin_hash` ⚠️           | `public_id` (UUIDv7) is the URL segment and the CSV directory. ⚠️ see §2.                                         |
| `entries`              | **`value_num`** — the **bodyweight** value · `movement_name` · `notes` ⚠️ · `value_text` ⚠️ · `context` ⚠️ · `scheme` ⚠️ · `raw_load` · `raw_reps` · `prescribed_snapshot` · `activity_date` | The central log row. `client_id` (UUIDv7) is a device-generated idempotency key — technical, but device-linkable. |
| `entry_sets`           | `reps` · `is_bodyweight` · `is_band` · `idx`                                                                                                                                                 | Training load per set.                                                                                            |
| `entry_set_quantities` | **`value_num`** (NOT NULL) + `slot` / `dimension` / `unit`                                                                                                                                   | The weight actually lifted. No free text.                                                                         |
| `sessions`             | **`feel`** (free text) · `activity_date` · `logged_at` · `session_type` · `day_role` · `source`                                                                                              | `feel` is one of the two free-text boxes the UI exposes (§3).                                                     |
| `supersets`            | `label` (free text) · `note` ⚠️ (free text)                                                                                                                                                  | `label` is writer-reachable; `note` has no writer.                                                                |
| `day_readiness`        | **`gate_color`** green/yellow/red · `note` ⚠️ · `readiness_date`                                                                                                                             | A daily readiness signal about a child. `note` has no writer.                                                     |
| `ramp_targets`         | **`target_value`** (NOT NULL) · `metric_key` · `week_start`                                                                                                                                  | A prescribed target for a named athlete. Ships with zero rows (`ramp-schedule.ts`).                               |
| `program_blocks`       | `name` · `notes` (both free text) · `slug`                                                                                                                                                   | Household-scoped by `household_id`.                                                                               |
| `prescriptions`        | `target_reps` (verbatim free text) · `sets` · `day_role` · `idx`                                                                                                                             | Household-scoped via `block_id`.                                                                                  |
| `prescription_targets` | **`load`** · **`reps`** (both verbatim free text)                                                                                                                                            | **A per-minor prescribed load.** Joins a prescription to a profile.                                               |

⚠️ **marks a column that holds nothing today** — no writer anywhere. See §2.

### 1b. Reference data (no personal content)

`units` · `quantity_slots` · `activity_type_categories` · `activity_types` · `metric_definitions` —
seeded catalogs of codes and labels. Nothing about a person. Not deleted when a household is deleted,
because there is nothing of theirs in them.

**`movements` is the exception, and it matters.** It is a reference table by position and a
**user-writable global table** in practice: the free-text movement-name box upserts into it by slug,
with **no household scoping** (`apps/web/lib/dal/catalog.ts` → `findOrCreateMovementId`). It is the
only user-reachable writer to any catalog table — `activity_types` and `metric_definitions` have no
equivalent. Consequence: **a movement name one household types survives that household's deletion**,
and until `TEN-2` lands another household can inherit its unit and bodyweight flag on a name clash.

## 2. Columns that exist and hold nothing

A reader can see the public schema, so the notice must account for these rather than let them be
discovered. **Three separate cases, deliberately not lumped together:**

| Column                                                    | Status                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles.birthdate`                                      | **Unowned and dead.** No writer, reader, UI or seed value anywhere outside the migration that created it. **The app never asks for a date of birth.** Minimisation says drop it — [tech-debt](../tech-debt.md).                                 |
| `profiles.pin_hash`                                       | **Reserved, and owned** — `PROF-1`, under [ADR 0006](../decisions/0006-household-addressing.md). Not debt; it has a destination.                                                                                                                |
| `profiles.avatar`                                         | **No writer, but a live read path** — it is in the profile DTO and rendered by `profile-tile.tsx`. A column that is already read will acquire a writer quietly, and what it would then hold is a picture of a child. Hence re-review trigger 3. |
| `entries.notes` · `day_readiness.note` · `supersets.note` | No input renders them. `entries.notes` is nonetheless **emitted in the CSV export**, so it is not inert.                                                                                                                                        |

## 3. Free text — where unforeseen content enters

Free-text columns are where a notice stops being able to enumerate what is stored, so they are listed
separately. **Two reach the UI today:**

1. **`sessions.feel`** — "how it felt", one input on the strength form.
2. **The movement-name box** (`strength-form.tsx`) → `entries.movement_name`, **and** a new global
   `movements` row. **This is the one that leaves the household.**

Both validate through `freeTextNoteSchema` (`packages/shared/src/text.ts`), capped at
`FREE_TEXT_NOTE_MAX`. There is no content filter — whatever is typed is stored, and `feel` is exported.
Every other free-text column in §1a is seed- or correction-written only.

**The child is usually the one typing.** `docs/spec.md` — _"Real tool — hand it to them to log
everything they do in a day on a phone/iPad"_; `AGENTS.md` — _"the kids log on the gym floor"_.

## 4. Who can read it, today

Stated as it is, not as it should be. Each of these is an open row, not a new defect:

| Fact                                                                                                                                                                                                                          | Owner                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **One shared access code for the whole app** (`access-gate.ts` → `GATE_COOKIE_NAME`), no per-person identity, **no per-person revocation**. Rotating it signs everybody out.                                                  | `AUTH-1`                          |
| `listProfiles()` returns **every** profile in the database, with no household predicate.                                                                                                                                      | `TEN-1`                           |
| The **export route** resolves a `public_id` and checks the shared cookie — no household predicate either. With the point above, **anyone holding the access code can download any athlete's full training history as a zip.** | `TEN-1`                           |
| **Profile tiles are a UX switch, not a security boundary** (`AGENTS.md`). A child who taps a sibling's tile reads that sibling's weigh-in history.                                                                            | by design, until `AUTH-1`/`TEN-1` |
| The **maintainer** has direct database access and can read everything.                                                                                                                                                        | inherent                          |

The mechanism details behind these — which predicate is missing, which endpoints are unrate-limited,
the entropy of the committed seed ids — live in [tech-debt.md](../tech-debt.md) and the `SEC-6` row.
**They are deliberately not restated in the notice**, which is served unauthenticated: the notice tells
a parent the consequence, this file links the cause.

## 5. "Deleted" does not mean deleted

There is **no hard `DELETE` anywhere** in the app or the DAL. Soft delete is the only delete, it is
written in exactly one place in the whole repo (a committed data correction), and every uniqueness
arbiter is `WHERE deleted_at IS NULL` — so a soft-deleted row **stays in the database indefinitely**
and a replacement coexists with it. Nothing purges them.

Also: soft-deleting a _profile_ hides it from the picker **and from the export route**, so its data
becomes un-exportable while remaining in the database. Get the export before anything is removed.

The only path that actually removes rows is the household deletion in
[runbooks.md](../runbooks.md) → "Delete a household and everyone in it".

## 6. Getting data out — and what the export omits

`GET /p/<profileId>/export` returns a zip, per athlete, per month. The directory is the profile's
`public_id`, **never a name**, and **no CSV contains `profiles.name`**. The byte-level contract is
[csv-export-contract.md](../csv-export-contract.md), which owns it; only the privacy-relevant facts
are here.

**What it contains:** the strength log (date, session type, movement, sets, reps, load, prescribed,
notes) and bodyweight (date, weight, context, notes).

**What it does not contain — the notice must say this:**

- **Check-ins and life activities.** The check-ins CSV is written **header-only, always**
  (`apps/web/lib/dal/export.ts` → `buildCheckins([])`), and the month query inner-joins `movements`,
  so a metric or check-in entry reaches **no file at all**.
- `day_readiness.gate_color` · `ramp_targets.target_value` · `sessions.feel` ·
  `profiles.routine_config` · `prescription_targets` (folded only into a derived `prescribed` string).
- A profile with readiness rows but no entries exports an **empty zip** (`loggedMonths` keys off
  `entries`).

So the export is **the portability answer for logged training, not a full copy.** A full copy is on
request from the maintainer.

## 7. Processors — who else receives anything

**This table is the single source of truth for the processor list.** `.github/SECURITY.md`,
[notice.md](./notice.md) and `.claude/agents/privacy-reviewer.md` all point here rather than keeping
their own copy, because two of those copies had already drifted when this was written (one omitted
Google, both omitted GitHub).

The CSP (`apps/web/proxy.ts`) sets `connect-src 'self'`, `font-src 'self'`,
`img-src 'self' blob: data:` — **no data egress from the browser to any external host.** (Not the same
as "no external hosts allowed": `script-src` carries `'strict-dynamic'`, which makes a host allowlist
inoperative for scripts by design. The egress claim is the one that holds.)

| Processor     | Wired?               | What it receives                                                                                                                                                                                                                                                                                   |
| ------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon**      | yes                  | **Everything** — it is the database. Pooled at runtime (`packages/db/src/client.ts`), unpooled for migrations.                                                                                                                                                                                     |
| **Vercel**    | yes                  | **The server that runs the app.** Every request and **every value entered** is handled inside a Vercel function. Separately it retains platform logs with IP, time and URL path — and `/p/<profileId>` puts a profile id in that path.                                                             |
| **GitHub**    | yes, **two roles**   | (a) the **public repository** — source, fixtures, plans, and screenshot images on the `screenshots` branch; (b) **GitHub Actions holds the production database credential** (`DATABASE_URL_UNPOOLED`, `.github/workflows/migrate.yml`) and connects to the live database on every merge to `main`. |
| **Sentry**    | yes, **server only** | Server and edge errors. **No client SDK is shipped**, so no visitor IP and no browser data. `dataCollection` is set off field by field (`apps/web/lib/sentry-scrub.ts`), `tracesSampleRate: 0`, no Session Replay, source maps off.                                                                |
| **Upstash**   | yes, one endpoint    | The **visitor's IP address**, in the plaintext key `mat-plan:gate:<ip>`, on gate submits only. 10 attempts / 10 minutes. No training data.                                                                                                                                                         |
| **Clerk**     | **not wired**        | Planned by `AUTH-1`: an email address and a Google account identifier. No `@clerk` dependency exists in any `package.json` today.                                                                                                                                                                  |
| **Google**    | **not wired**        | Planned by `AUTH-1` (sign-in). **Fonts do not reach Google at runtime** — `next/font/google` self-hosts at build, and `font-src 'self'` would block a runtime fetch.                                                                                                                               |
| **Anthropic** | CI only, conditional | A pull request's head and diff, **only if `CLAUDE_CODE_OAUTH_TOKEN` is configured** (`.github/workflows/claude-review.yml`); it is currently dormant by choice. Repository content — never the production database.                                                                                |

**Sentry is deliberately the thin case.** The scrubber strips cookies, denied headers, request bodies,
query strings, Server-Action form data, stack-frame variables, and everything after a `params:` line
(the SEC-3 fix). The honest claim is **"designed and tested to carry no personal data", not "cannot"**
— an unexpected string in an error message is still possible.

**One thing the code does not guarantee:** TLS. `client.ts` **upgrades** an `sslmode` that is already
present to `verify-full`, and explicitly does not invent one if absent; nothing validates that
`DATABASE_URL` carries it. Whether production is `verify-full` is an environment fact to confirm, not a
code guarantee — it is on the operator checklist in [runbooks.md](../runbooks.md).

## 8. Retention — and the three windows that are not knowable from here

| What                                                 | Kept for                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Training data                                        | While the household uses the app; deleted on request, plus one sweep when the beta ends       |
| An item the household "deletes"                      | ⚠️ **Hidden, not erased** — until the whole household is deleted. Nothing purges it. (§5)     |
| Access-gate cookie `mp_gate`                         | One year (`apps/web/lib/constants.ts` → `COOKIE_MAX_AGE`)                                     |
| Timezone cookie `tz`                                 | One year — **the same constant**. A coarse location signal, on the child's device.            |
| Theme preference                                     | In the browser's `localStorage` (`next-themes`) until the browser is cleared                  |
| Rate-limit counter (an IP) at Upstash                | About the limiter's window (`apps/web/lib/rate-limit.ts` → `GATE_RATE_LIMIT`)                 |
| Playwright CI artifacts (fixture data only)          | 7 days (`.github/workflows/ci.yml`)                                                           |
| Screenshot images on the public `screenshots` branch | Until the PR closes (`.github/workflows/prune-screenshots.yml`)                               |
| **Server error reports at Sentry**                   | ⏳ **Not confirmed** — read from the Sentry project settings                                  |
| **Request logs at Vercel**                           | ⏳ **Not confirmed** — read from the Vercel console                                           |
| **Database point-in-time window at Neon**            | ⏳ **Not confirmed** — read from the Neon console (Project → Settings → History retention)    |
| A CSV export already downloaded                      | Not ours to keep or delete                                                                    |
| The public repository                                | Permanently, including history                                                                |
| **A Neon restore branch held across a deletion**     | 7 days after the apply, then deleted — a **whole-database** copy, so it holds every household |
| **A deletion-ledger entry**                          | Until the restore window that made it necessary has passed. See below.                        |

⚠️ **The deletion ledger is a store of personal data that the deletion procedure creates**
([runbooks.md](../runbooks.md) → the ledger). It holds a household `public_id`, Clerk user ids and the
channel that verified the request — data about an identifiable family, and a permanent record that
they asked to be deleted, unless it is cleared. It exists only because `OPS-3` cannot make a deletion
survive a database restore without it, it lives **outside git and outside the restorable database**,
and it is deleted once the restore windows have passed.

The three ⏳ rows are **named rather than guessed**: a false number in a notice is worse than an
admitted gap. Filling them is on `PRIV-2`'s acceptance — the PR that publishes the URL — and on
[beta-1.md](../milestones/beta-1.md)'s exit criteria.

## 9. Personal data committed to this public repository

🔴 **This is the sharpest thing in this document.** It is not about the database; it is about the
source tree, and it is not fixed yet.

**The committed data is broader than [plan.md](../plan.md)'s `OSS-1` audit records.** That audit (dated
2026-08-11, and flagged stale in its own blocker box) concluded there is _"no measurement history… no
health record, and no log data"_. **That conclusion no longer holds**: a data correction landed in
2026-10-01 carrying log-row identifiers and weigh-in clock times for a named minor. This file is the
live inventory; `OSS-1` points here.

Two minors' given names appear across roughly fifty files, in five classes that need different fixes:

| Class                                | Where                                                                                                                                                        | What is actually there                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Names bound to prescribed loads      | `packages/shared/src/programming.ts`                                                                                                                         | A named minor wired to a per-child training load, in shipped source      |
| A per-minor program table            | `docs/programs/kids-sc-foundation-archived.md`                                                                                                               | Per-child load and rep **columns** across a 37-line program              |
| Real log rows quoted as doc examples | `packages/shared/src/csv/row.ts`, `docs/csv-export-contract.md`                                                                                              | Named minors with performance values                                     |
| Dated incidents about a named minor  | `packages/db/migrations/0012_*.sql` (an **applied migration**), `strength-form.tsx` (a **shipped component**), `packages/db/scripts/corrections/registry.ts` | Weigh-in frequency, dates and clock times                                |
| Names as exported API symbols        | `packages/db/src/index.ts`                                                                                                                                   | A rename is an API change across a workspace boundary, not a string edit |

Also committed: the seed's **fixed, zero-entropy** household and profile `public_id`s
(`packages/shared/src/seed-ids.ts`) — which is why `SEC-6` exists and why no code may ever treat a seed
id as authorization.

**No bodyweight _value_ is committed** in the corrections registry — that was deliberately dropped when
it was written. Separately, `docs/samples/legacy-csv/` holds weigh-in rows **with values**; that
folder's provenance paragraph says they are synthesised from real files with the values replaced, and
that reading is credible. Its summary table used to label them "Real data"; that contradiction is
corrected rather than left for the next reader to re-litigate.

**A rename is not a removal.** `git log -S` finds what a working-tree edit takes out, and the commit
author and email are in every commit regardless. Separately, the read-only PR refs #152–#167 still
carry a third-party roster of minors that only GitHub Support can purge (`OSS-1`).

**Status:** the rename is a **Beta 0 blocker** on `OSS-1`, not work this document does.

---

## Where each rule lives

So the next change edits one file, not four:

| Claim                                                 | Owner                                                   |
| ----------------------------------------------------- | ------------------------------------------------------- |
| What is stored, who receives it, retention, residuals | **this file**                                           |
| What we tell people, in plain language                | [notice.md](./notice.md)                                |
| The threat model, bodyweight-is-privileged, logging   | [.github/SECURITY.md](../../.github/SECURITY.md)        |
| The deletion procedure                                | [runbooks.md](../runbooks.md)                           |
| The byte-level CSV contract                           | [csv-export-contract.md](../csv-export-contract.md)     |
| Accepted shortcuts and their payoff plan              | [tech-debt.md](../tech-debt.md)                         |
| "Not legal advice"                                    | [notice.md](./notice.md) → About this notice (one copy) |
