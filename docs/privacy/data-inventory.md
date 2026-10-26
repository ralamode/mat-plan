# Data inventory — the evidence behind the privacy notice

**[notice.md](./notice.md) is the document people read. This file is why it is true.**

Every factual claim in the notice traces to a row here, and every row here traces to code. Derived by
walking `packages/db/src/schema.ts` and the third-party call sites — **not from memory**, which is the
only way a notice about minors' health data is worth anything.

> **Derived at `38f62de`, 2026-10-07** (PRIV-1, [plan](../plans/priv-1-privacy-review.md)).
> **§7 re-read 2026-10-16** for `AUTH-1` chunk **1a** ([plan](../plans/auth-1-clerk-google.md)):
> `@clerk/nextjs@7.9.15` is now a dependency of `apps/web`, deployed to production — so **Clerk is a
> processor from this chunk**, on the inventory's own standard ("what the running system does"), and the
> §7 egress paragraph is rewritten rather than annotated. Also read this date, and recorded because the
> answers are not guessable: Clerk's SDK ships an anonymous **telemetry** collector that POSTs to
> `clerk-telemetry.com`, and a **keyless** path that would PROVISION a live Clerk application from a
> `pnpm dev` (`createAccountlessApplication`) — **both are pinned off in `apps/web/next.config.ts`**, in
> code rather than by env, which is why neither appears in §7's table. ⚠️ **Still owed, and deliberately
> not written as confirmed:** Clerk's **data region**, its **retention** for user records and sign-in
> logs (a §8 row), and the exact **OAuth scope list** — all three are console reads on an instance that
> does not exist yet, and they are boxes on [runbooks.md](../runbooks.md)'s AUTH-1 checklist. 1a holds
> **no** Clerk-held personal data: sign-in is not switched on, no instance is configured, and the
> keys-absent branch in `apps/web/lib/clerk.ts` is what makes that a property of this code.
> **§9 re-derived 2026-10-08** when `OSS-1`'s sweep landed — the real surface was wider than §9 recorded
> (two further classes), and §9 now says what is true after the sweep rather than what was owed before it.
> **§8 re-read 2026-10-15** for `PRIV-1`: the three vendor retention windows are **confirmed and
> dated** — Sentry **30 days** (Developer), Vercel runtime logs **24 hours** (Pro, no drains), Neon
> point-in-time **6 hours**. ⚠️ Neon's 6h is how far back a branch can be cut FROM; the 7-day restore
> branch is cut explicitly and persists on its own, so the two are not in conflict. Also this date:
> **`SENTRY_DSN` was absent from Vercel's Production scope**, so `Sentry.init` was a silent no-op and
> Sentry had been receiving nothing — the notice's Sentry row was false until it was set. Fixed; a
> redeploy carries it. The same silent-optional shape as `OPS-1`'s Upstash finding, now twice.
> **§1 / §4 / §8 re-read 2026-10-13** for `TEN-2d`: migration `0018` ran
> `VALIDATE CONSTRAINT movements_global_row_has_pattern` — **the first and only time anything in this
> system has scanned a real production row for this invariant**, because `db:verify` runs on PGlite.
> It passed. The read leak's residual is therefore no longer merely _named_, it is **measured**: the
> report-only census `movements-ownership-2026-10-11`, run against production on 2026-10-13, returned
> **35 `movements` rows, all 35 global and all 35 curated — 0 household-owned, 0 non-curated, 0
> cross-household references, 0 rows for `TEN-2c-1` to split, 0 `pattern IS NULL` blockers.** So §4's
> residual is structurally open and empirically empty, and `TEN-2c-1` is a no-op on current data.
> ⚠️ **A dated zero is not an invariant** — `TEN-2a`'s own rule — so it is re-measured immediately
> before the invite, and §9's clone-name obligation stands for the day it is non-zero.
> **§1 / §3 / §4 / §8 re-read 2026-10-12** for `TEN-2c`
> ([plan](../plans/ten-2c-drop-global-slug-unique.md)): migration `0017` dropped the non-partial
> `movements_slug_unique`, which closes the cross-household **denial** window and closes **none** of
> the **read** leak's residual — the rows already at `household_id IS NULL`. §4's owner therefore
> re-points to `TEN-2c-1` / `TEN-2b-2`, and §8's retention is unchanged by this PR.
> **§1 / §1b / §2 / §3 / §4 / §8 re-read 2026-10-10** for `TEN-2b`
> ([plan](../plans/ten-2b-scoped-movement-lookup.md)): the column **woke up** — `findOrCreateMovement`
> now reads and writes it — so `movements` moved from §1b to §1a, §2's row was **deleted** (it no longer
> holds nothing), re-review trigger 3 was discharged, and §8 gained the retention split. The residual
> that remains is the `TEN-2b→2c` fallback, not a scoping gap.
> **§1 / §2 / §4 / §8 re-read 2026-10-09** for `TEN-2a`
> ([plan](../plans/ten-2a-household-movements.md)): `movements.household_id` was added to
> `schema.ts` — nullable, **dark**, no reader and no writer — so the column is recorded in §2 and the
> classification change it will cause is named in §1 and §4 **before** it happens, not after.
>
> **Is it stale?** Run this; if it prints anything, re-read the sections those files feed:
>
> ```bash
> git log --oneline 38f62de..HEAD -- packages/db/src/schema.ts apps/web/lib/dal \
>   apps/web/proxy.ts apps/web/lib/access-gate.ts apps/web/lib/public-paths.ts \
>   apps/web/lib/clerk.ts apps/web/next.config.ts apps/web/sentry.server.config.ts \
>   apps/web/lib/sentry-scrub.ts apps/web/lib/rate-limit.ts .github/workflows
> ```
>
> ⚠️ `apps/web/lib/access-gate.ts` joined that list at `PRIV-2`, and it should have been on it from
> the start: it is the file that **defines the public surface**, and until now the command that
> watches the public surface did not watch it. `PRIV-2` — which added a second un-gated route —
> would have printed nothing.
>
> ⚠️ **`AUTH-1` 1a added three more, and two of them are the same lesson again.** 1a **split**
> `access-gate.ts`, moving the public-surface list to `apps/web/lib/public-paths.ts` — so watching only
> the old path would have silently stopped watching the thing the warning above was added for, and 1d
> deletes `access-gate.ts` outright. `apps/web/lib/clerk.ts` decides whether a third party runs in the
> browser at all, and `apps/web/next.config.ts` is where this chunk pins Clerk's telemetry and keyless
> switches off — a change to either is a processor change, which is exactly what this command is for.

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
   ✅ **This trigger has fired once and worked.** `movements.household_id` was listed here with a named
   owner and a date; `TEN-2b` woke it on 2026-10-10, and the edits it predicted were made in that PR —
   `movements` moved §1b → §1a, §2's row went, and §1b's three claims and the notice's were corrected.
   The entry is removed because the column is now in use, not because the risk was dismissed.

---

## 1. What the database holds

**19 tables. FOURTEEN are household-reachable** and hold personal data; five are reference data.
Listed exhaustively, including the ones holding nothing — **absence is a claim too**, and a reader
should be able to check coverage rather than trust it.

✅ **The count changed at `TEN-2b`, exactly as `TEN-2a` predicted it would** (it read _"becomes
thirteen / five at `TEN-2b`"_). `findOrCreateMovement` now writes `movements.household_id`, so a
`movements` row can be household-authored content and the table moved from §1b to **§1a**. Recorded
before it happened and then actually done — the classification change is the thing that goes wrong
quietly, and this is the mechanism that stopped it.

Every household-reachable table carries `created_at`, `updated_at` and `deleted_at` (`schema.ts` →
`timestamps`), and `deleted_at` is a **soft** delete — see §5.

### 1a. Household-reachable (personal data)

| Table                  | Personal columns                                                                                                                                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `households`           | **`name`** (free text, NOT NULL)                                                                                                                                                             | Typically a family name. The notice must tell an adult this is stored.                                                                                                                                                                                                                                                                                                                                                                                 |
| `profiles`             | **`name`** (free text, NOT NULL) · **`kind`** `'kid'｜'adult'` — **the column that marks a row as a minor** · `avatar` · `routine_config` (jsonb) · `birthdate` ⚠️ · `pin_hash` ⚠️           | `public_id` (UUIDv7) is the URL segment and the CSV directory. ⚠️ see §2.                                                                                                                                                                                                                                                                                                                                                                              |
| `entries`              | **`value_num`** — the **bodyweight** value · `movement_name` · `notes` ⚠️ · `value_text` ⚠️ · `context` ⚠️ · `scheme` ⚠️ · `raw_load` · `raw_reps` · `prescribed_snapshot` · `activity_date` | The central log row. `client_id` (UUIDv7) is a device-generated idempotency key — technical, but device-linkable.                                                                                                                                                                                                                                                                                                                                      |
| `entry_sets`           | `reps` · `is_bodyweight` · `is_band` · `idx`                                                                                                                                                 | Training load per set.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `entry_set_quantities` | **`value_num`** (NOT NULL) + `slot` / `dimension` / `unit`                                                                                                                                   | The weight actually lifted. No free text.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sessions`             | **`feel`** (free text) · `activity_date` · `logged_at` · `session_type` · `day_role` · `source`                                                                                              | `feel` is one of the two free-text boxes the UI exposes (§3).                                                                                                                                                                                                                                                                                                                                                                                          |
| `supersets`            | `label` (free text) · `note` ⚠️ (free text)                                                                                                                                                  | `label` is writer-reachable; `note` has no writer.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `day_readiness`        | **`gate_color`** green/yellow/red · `note` ⚠️ · `readiness_date`                                                                                                                             | A daily readiness signal about a child. `note` has no writer.                                                                                                                                                                                                                                                                                                                                                                                          |
| `ramp_targets`         | **`target_value`** (NOT NULL) · `metric_key` · `week_start`                                                                                                                                  | A prescribed target for a named athlete. Ships with zero rows (`ramp-schedule.ts`).                                                                                                                                                                                                                                                                                                                                                                    |
| `program_blocks`       | `name` · `notes` (both free text) · `slug`                                                                                                                                                   | Household-scoped by `household_id`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `prescriptions`        | `target_reps` (verbatim free text) · `sets` · `day_role` · `idx`                                                                                                                             | Household-scoped via `block_id`.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `prescription_targets` | **`load`** · **`reps`** (both verbatim free text)                                                                                                                                            | **A per-minor prescribed load.** Joins a prescription to a profile.                                                                                                                                                                                                                                                                                                                                                                                    |
| `movements`            | **`name`** · `slug` (derived from the same text)                                                                                                                                             | 🔴 **Moved here from §1b at `TEN-2b`** — `household_id` now identifies the household that typed the name. Only the rows with a non-NULL `household_id` are personal; the seeded catalog rows (`household_id IS NULL`) are reference data and stay. ⚠️ `deleted_at` is **not** a soft delete here — nothing may set it, and the deletion procedure deletes these rows **hard** (`runbooks.md` step 11), unlike every other row in this table of tables. |

| `household_members` | **`clerk_user_id`** (NOT NULL) — Clerk's own account id for a named adult · `role` | 🔴 **New at `AUTH-1` 1b, and a NEW IDENTIFIER CLASS for this database**: a stable third-party account id, not generated here and not meaningful only here. **No email column** — the address and the Google identifier live in Clerk (§7), so this stores the opaque id and nothing else. Nothing reads the table until 1c; the only writer is a maintainer-run correction. ⚠️ A soft-deleted membership retains the identifier indefinitely — see §5 and §8. |

⚠️ **marks a column that holds nothing today** — no writer anywhere. See §2.

### 1b. Reference data (no personal content)

`units` · `quantity_slots` · `activity_type_categories` · `activity_types` · `metric_definitions` —
seeded catalogs of codes and labels. Nothing about a person, and nothing writes to them from the app,
so they are not deleted when a household is deleted: there is nothing of theirs in them.

🔴 **`movements` LEFT this section at `TEN-2b` — it is now in §1a.** It is the only catalog table with
a user-reachable writer (the free-text movement-name box), and since `TEN-2b` that writer is
**household-scoped**: `findOrCreateMovementId` takes a `HouseholdScope` and resolves **global-first**,
so a name a household types lands in that household's own namespace and **is** deleted with the
household (`runbooks.md` step 11, which `TEN-2a` added for exactly this).

⚠️ **Two claims this section used to make are now false, and one residual replaces them.** It said
there was _"no household scoping"_ and that _"a movement name one household types survives that
household's deletion"_. Both are fixed for names typed **after** `TEN-2b`. ✅ **And the mechanism that
kept minting new ones is gone at `TEN-2c`** — migration `0017` dropped the non-partial
`movements_slug_unique`, so two households can each hold their own row for one slug and the resolver's
`23505` fallback, which handed the second household the first's row, is unreachable.
⚠️ **What survives is the stock, not the flow, and `TEN-2c` did not touch it.** Three shapes still
outlive a deletion, now owned by `TEN-2c-1` and `TEN-2b-2`: a row more than one household references,
a pre-existing app-authored row nothing references, and a row whose only other referencer is a profile
with a NULL `household_id`. All three sit at `household_id IS NULL`, where global-first serves them to
**every** household — that is the **read** leak's residual, and `0017` only stops the set growing (via
`movements_global_row_has_pattern`). `runbooks.md` step 11 lists them; §4 and §8 carry the status and
the retention.

The row's unit and bodyweight flag still carry nothing from the typist — the writer only ever writes
`is_bodyweight: false` and no `unit_default`, which is **why** the resolver is global-first: a
household row would always be a strictly worse version of a curated one
(`packages/db/src/writers/movement-catalog.ts` → `findOrCreateMovement`).

## 2. Columns that exist and hold nothing

A reader can see the public schema, so the notice must account for these rather than let them be
discovered. **Three separate cases, deliberately not lumped together:**

✅ **`movements.household_id` was listed here by `TEN-2a` and `TEN-2b` removed it** — it holds values
now, so it belongs in §1a, not in a table of columns that hold nothing. (Its row cited
`apps/web/lib/movements-household-is-dark.test.ts`, which `TEN-2b` **deleted**: the deletion of that
test is the visible edit that says the column is live. Leaving the row would have left this file
pointing at a file that no longer exists.)

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
2. **The movement-name box** (`strength-form.tsx`) → `entries.movement_name`, **and** a `movements`
   row. **This is the one that leaves the household**, and since TEN-1 1d that is measured rather
   than suspected. 🔴 **`TEN-2b` narrowed it from "global" to one named case.** The row is no longer
   global: it lands in the typing household's own namespace, it is deleted with that household, and a
   prescription in another household can no longer resolve it at all (`seedProgram` reads the global
   namespace only). ✅ **`TEN-2c` closed the shape that was still crossing:** migration `0017` dropped
   the non-partial `movements_slug_unique`, so the second household to type a name now gets its own row
   rather than the first's, and `db:verify` measures the consequence instead of asserting the old one —
   pre-flight (d) reads **ZERO** across `entries` **and** `prescriptions`, and step 11's
   `DELETE FROM movements` **completes** instead of aborting `23503`, both assertions inverted rather
   than retired. ⚠️ **What still crosses is the stock `TEN-2c` did not touch:** a name typed before
   `TEN-2b` sits at `household_id IS NULL`, and global-first serves it to **every** household.
   `TEN-2c-1` (the split backfill) is what closes that. §4 carries the status; `runbooks.md` step 11
   carries the operator's answer.

Both validate through `freeTextNoteSchema` (`packages/shared/src/text.ts`), capped at
`FREE_TEXT_NOTE_MAX`. There is no content filter — whatever is typed is stored, and `feel` is exported.
Every other free-text column in §1a is seed- or correction-written only.

**The child is usually the one typing.** `docs/spec.md` — _"Real tool — hand it to them to log
everything they do in a day on a phone/iPad"_; `AGENTS.md` — _"the kids log on the gym floor"_.

## 4. Who can read it, today

Stated as it is, not as it should be. Each of these is an open row, not a new defect:

| Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Owner                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **One shared access code for the whole app** (`access-gate.ts` → `GATE_COOKIE_NAME`), no per-person identity, **no per-person revocation**. Rotating it signs everybody out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `AUTH-1`                  |
| ~~`listProfiles()` returns **every** profile in the database, with no household predicate.~~ **Closed by `TEN-1` (2026-10-08):** it runs a household-scoped picker query, proved in both directions against a real database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `TEN-1` ✅                |
| ~~The **export route** has no household predicate either.~~ **Closed by `TEN-1`:** the profile resolve and all three month reads are household-scoped. ⚠️ **The consequence has NOT changed**, because the gate is still one shared code and the scope still resolves to the single live household: **anyone holding the access code can download any athlete's full training history as a zip.** That is `AUTH-1`'s to close — scoping is not authorization.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `AUTH-1`                  |
| 🔴 **`movements` is SCOPED as of `TEN-2b`, the cross-household DENIAL window is CLOSED as of `TEN-2c`, and the READ leak’s RESIDUAL IS STILL OPEN — and, as of 2026-10-13, MEASURED EMPTY (0 rows; see the §4 re-read above).** `findOrCreateMovementId` takes a `HouseholdScope` and resolves **global-first**, so a name a household types lands in its own namespace and is deleted with the household. **Three of the four things this row used to claim are now false** and were corrected at `TEN-2b`: the write is scoped; a refused session’s row lands in the caller’s **own** namespace (garbage, not a cross-tenant write); and the other household’s Today card can no longer render it (`seedProgram` resolves the global namespace only, and **refuses** loudly instead). ✅ **`TEN-2c` (migration `0017`) dropped the non-partial `movements_slug_unique`**, so two households each hold their own row for one slug, the `23505` fallback is unreachable (it is deleted at `TEN-2d`), and the price `TEN-2b` measured is paid off: `db:verify` proves `runbooks.md` pre-flight (d) reads **ZERO** across `entries` **and** `prescriptions`, and that step 11’s `DELETE FROM movements` **completes** instead of aborting `23503` — both assertions inverted rather than retired. ⚠️ **NOT CLOSED, and this row deliberately does not read as closed:** every `movements` row already sitting at `household_id IS NULL` that is not a curated catalog row is still resolved by global-first for **every** household, and it carries the typing household’s free text. **`TEN-2c-1`** (the split backfill) closes that; **`TEN-2b-2`** removes the unreferenced ones; `0017` only stops the set growing, via `movements_global_row_has_pattern` (`NOT VALID` until `TEN-2d`). The size of the set is **measured, not assumed** — the report-only correction `movements-ownership-2026-10-11` (`pnpm --filter @mat-plan/db db:correct`) prints it as aggregate counts, never a `name` or a `slug`. See §3, §8. | `TEN-2c-1` · `TEN-2b-2`   |
| **Profile tiles are a UX switch, not a security boundary** (`AGENTS.md`). A child who taps a sibling's tile reads that sibling's weigh-in history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | by design, until `AUTH-1` |
| The **maintainer** has direct database access and can read everything.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | inherent                  |

**Two routes are served without the access code** (`access-gate.ts` → `PUBLIC_PATHS`), and neither
reads personal data:

| Un-gated route | What it serves                                                                                                                                                                                                       | Reads                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `/`            | The public landing (`OSS-2`) — static copy.                                                                                                                                                                          | No cookie, no database.                                   |
| `/privacy`     | **`PRIV-2`:** this repository's [notice.md](./notice.md), compiled into a committed data module (`lib/privacy/notice-content.ts`) by a script and rendered as semantic HTML. A drift test fails if the two disagree. | No cookie, no database, **no request input** and no `fs`. |

`marked`, the markdown parser that script uses, is a **devDependency** — it runs only when a human
regenerates the module, so it reaches no runtime and is outside `audit:check`'s `--prod` scope. The
page's `metadata` carries `robots: noindex` until `AUTH-1`: the notice is an honest inventory of the
beta's weaknesses, and the gate's brute-force limiter is not yet armed in production. Neither
property affects fetchability — the response is a 200 for the consent screen and for any reader.

The mechanism details behind these — which predicate is missing, which endpoints are unrate-limited,
the entropy of the committed seed ids — live in [tech-debt.md](../tech-debt.md) and the `SEC-6` row.
**They are deliberately not restated in the notice**, which is served unauthenticated: the notice tells
a parent the consequence, this file links the cause.

## 5. "Deleted" does not mean deleted

There is **no hard `DELETE` anywhere** in the app or the DAL. Soft delete is the only delete, and it is
written in exactly one place in the app tree (a committed data correction). **Nothing purges a
soft-deleted row today**, so it stays in the database indefinitely and a replacement coexists with it.

⚠️ **Correction (2026-10-18, [ADR 0008](../decisions/0008-deletion.md)):** this section previously said
_"every uniqueness arbiter is `WHERE deleted_at IS NULL`"_. That is wrong, and it was wrong when written.
**Fourteen are partial** on `deleted_at`, so a soft delete frees the **natural** key — `client_id`, the
weigh-in day, the quantity arity, every ordinal-within-parent. **The `public_id` UNIQUE on all fifteen
soft-deletable tables is not**, so a soft-deleted row **keeps its addressable id**; and `movements`' two
arbiters are partial on `household_id` instead. The rule is _"a soft delete frees the natural key and keeps
the public one"_, not _"it frees everything"_. Two consequences people were told the wrong version of:
un-deleting a row can **fail** where a live row took the freed slot, and a hidden profile is still
addressable, so restoring its export path needs no migration.

**This is a description of the code today, not the policy.** [ADR 0008](../decisions/0008-deletion.md)
decides that a per-item delete **hides, then purges at `N`**, and that a hidden row stays **restorable
until it is purged** — so once `V1-9b` and `PRIV-3` land, "stays indefinitely" stops being true and this
section is rewritten with them.

Also: soft-deleting a _profile_ hides it from the picker **and from the export route**, so its data
becomes un-exportable while remaining in the database. Get the export before anything is removed.
⚠️ The export filters soft-deleted rows at **five** places (`packages/db/src/queries/export-month.ts` →
`strengthMonthRows`, `bodyweightMonthRows`, `loggedMonths`), so this is **not** only a profile-level
hazard: once a per-item delete exists, every hidden entry is data we hold and the person cannot export.
ADR 0008 makes _"a hide must never remove the export path"_ a precondition on `V1-9b`.

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
- **Soft-deleted ("hidden") rows.** Every export query filters `deleted_at IS NULL`, so a hidden entry
  is absent from the zip while still held in the database. Invisible today because nothing user-facing
  writes `deleted_at`; a standing property once `V1-9b` ships a Delete button
  ([ADR 0008](../decisions/0008-deletion.md)).
- A profile with readiness rows but no entries exports an **empty zip** (`loggedMonths` keys off
  `entries`).

So the export is **the portability answer for logged training, not a full copy.** A full copy is on
request from the maintainer.

## 7. Processors — who else receives anything

**This table is the single source of truth for the processor list.** `.github/SECURITY.md`,
[notice.md](./notice.md) and `.claude/agents/privacy-reviewer.md` all point here rather than keeping
their own copy, because two of those copies had already drifted when this was written (one omitted
Google, both omitted GitHub).

**The egress claim — rewritten at `AUTH-1` 1a, because the old one stops being true.** It used to read
"no data egress from the browser to any external host", on the strength of the CSP's
`connect-src 'self'`, `font-src 'self'`, `img-src 'self' blob: data:`. 1a ships `@clerk/nextjs` to
production, and Clerk's sign-in screen is a browser-side SDK: once an instance is configured, the
browser fetches `clerk.browser.js` and `ui.browser.js` from the instance's Frontend API host and talks
to that host for the whole sign-in exchange. So the honest statement is now in **two** parts:

1. **Today, with no Clerk instance configured, the old claim still holds exactly** — and as code, not
   as a promise: `apps/web/lib/clerk.ts:clerkIsConfigured()` is false without both keys, so
   `app/layout.tsx` renders no `<ClerkProvider>`, `proxy.ts` composes no `clerkMiddleware()`, **and the
   CSP is not widened at all**. `apps/web/e2e/theme.spec.ts` asserts the consequence directly: zero
   requests to any Clerk host from `/` or `/sign-in`.
2. **Once an instance is configured, there is exactly one external host the browser talks to**, and it
   is named by **exact origin** — derived from the publishable key, never a wildcard — in
   `connect-src`, alongside `img-src https://img.clerk.com` (OAuth provider logos) and
   `frame-src https://challenges.cloudflare.com` (Clerk's bot-protection widget). `proxy.test.ts` pins
   each one and asserts the policy contains no `*` and no scheme-wide `https:`/`http:` source. What
   leaves the browser is a sign-in exchange: Clerk sees the visitor's IP and browser on that screen,
   and the email address and Google account identifier of whoever signs in. **No training, bodyweight
   or athlete data is involved** — `/sign-in` reads none of it, by the same rule `/` and `/privacy`
   follow.

(Still not the same as "no external hosts allowed": `script-src` carries `'strict-dynamic'`, which
makes a host allowlist inoperative for scripts by design — which is also why 1a adds **no** host to
`script-src` and loads Clerk's script on the existing per-request nonce instead.)

⚠️ **`clerk-js` and `@clerk/ui` are fetched from Clerk's CDN at runtime, so they are outside
`pnpm-lock.yaml` and outside the `audit:check` gate** — the one third-party code path in this app that
no supply-chain check in CI can see. [tech-debt.md](../tech-debt.md) carries the row.

| Processor     | Wired?               | What it receives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon**      | yes                  | **Everything** — it is the database. Pooled at runtime (`packages/db/src/client.ts`), unpooled for migrations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Vercel**    | yes                  | **The server that runs the app.** Every request and **every value entered** is handled inside a Vercel function. Separately it retains platform logs with IP, time and URL path — and `/p/<profileId>` puts a profile id in that path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **GitHub**    | yes, **two roles**   | (a) the **public repository** — source, fixtures, plans, and screenshot images on the `screenshots` branch; (b) **GitHub Actions holds the production database credential** (`DATABASE_URL_UNPOOLED`, `.github/workflows/migrate.yml`) and connects to the live database on every merge to `main`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Sentry**    | yes, **server only** | Server and edge errors. **No client SDK is shipped**, so no visitor IP and no browser data. `dataCollection` is set off field by field (`apps/web/lib/sentry-scrub.ts`), `tracesSampleRate: 0`, no Session Replay, source maps off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Upstash**   | yes, one endpoint    | The **visitor's IP address**, in the plaintext key `mat-plan:gate:<ip>`, on gate submits only. 10 attempts / 10 minutes. No training data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Clerk**     | yes, **code only**   | **Runs the sign-in screen.** `@clerk/nextjs@7.9.15` is a dependency of `apps/web` from `AUTH-1` 1a and is deployed, so Clerk is a processor — but **sign-in is not switched on**: no instance is configured, so with both keys absent no `<ClerkProvider>` renders, no `clerkMiddleware()` runs and no request reaches a Clerk host (`lib/clerk.ts`; asserted in `e2e/theme.spec.ts`). Once configured, Clerk holds the email address, the Google account identifier and the sign-in sessions, and sees the visitor's IP and browser on the sign-in screen. **Never training or bodyweight data.** Its **telemetry** collector and its **keyless** auto-provisioning are pinned off in `next.config.ts`, so neither sends anything. ⏳ Region and retention are console reads owed on the instance — [runbooks.md](../runbooks.md). |
| **Google**    | **not wired**        | Planned by `AUTH-1` **1c** (sign-in switched on): Google is told that someone signed in to this app, and gives Clerk the email address and account identifier on that Google account. ⏳ The exact **scope list** is a runbook box, and `no photos` in [notice.md](./notice.md) depends on its answer. **Fonts do not reach Google at runtime** — `next/font/google` self-hosts at build, and `font-src 'self'` would block a runtime fetch.                                                                                                                                                                                                                                                                                                                                                                                        |
| **Anthropic** | CI only, conditional | A pull request's head and diff, **only if `CLAUDE_CODE_OAUTH_TOKEN` is configured** (`.github/workflows/claude-review.yml`); it is currently dormant by choice. Repository content — never the production database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Sentry is deliberately the thin case.** The scrubber strips cookies, denied headers, request bodies,
query strings, Server-Action form data, stack-frame variables, and everything after a `params:` line
(the SEC-3 fix). The honest claim is **"designed and tested to carry no personal data", not "cannot"**
— an unexpected string in an error message is still possible.

**One thing the code does not guarantee:** TLS. `client.ts` **upgrades** an `sslmode` that is already
present to `verify-full`, and explicitly does not invent one if absent; nothing validates that
`DATABASE_URL` carries it. Whether production is `verify-full` is an environment fact to confirm, not a
code guarantee — it is on the operator checklist in [runbooks.md](../runbooks.md).

## 8. Retention — and the three windows that are not knowable from here

| What                                                 | Kept for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Training data                                        | While the household uses the app; deleted on request, plus one sweep when the beta ends                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| An item the household "deletes"                      | ⚠️ **Hidden, not erased** — until the whole household is deleted. Nothing purges it. (§5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **A household-authored movement name**               | **Split as of `TEN-2b`.** A name typed **after** `TEN-2b`: until that household is deleted — it carries `household_id`, and `runbooks.md` step 11 (added by `TEN-2a`) deletes it **hard**. ⚠️ **`TEN-2c` changed nothing here — it closed the denial window, not the retention.** Three shapes are still kept **indefinitely**, each with a named owner: a row more than one household references and a row whose other referencer has a NULL `household_id` (**`TEN-2c-1`**, the split backfill), and a pre-existing app-authored row nothing references (**`TEN-2b-2`**, the orphan correction). Seeded catalog rows are reference data and are kept. (§3, §4, `runbooks.md` step 11) |
| **A Clerk account id in `household_members`**        | **New at `AUTH-1` 1b.** While the household exists: `runbooks.md` step 13 deletes it **hard**, and the FK is `NO ACTION`, so the household cannot be deleted without it. ⚠️ **A SOFT-DELETED membership keeps the identifier indefinitely** — §5 applies here as everywhere ("nothing purges them"), and this is the first row where what is retained is a **third-party account id for a named adult** rather than content they authored. The household deletion is its only purge.                                                                                                                                                                                                    |
| Access-gate cookie `mp_gate`                         | One year (`apps/web/lib/constants.ts` → `COOKIE_MAX_AGE`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Timezone cookie `tz`                                 | One year — **the same constant**. A coarse location signal, on the child's device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Theme preference                                     | In the browser's `localStorage` (`next-themes`) until the browser is cleared                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Rate-limit counter (an IP) at Upstash                | About the limiter's window (`apps/web/lib/rate-limit.ts` → `GATE_RATE_LIMIT`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Playwright CI artifacts (fixture data only)          | 7 days (`.github/workflows/ci.yml`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Screenshot images on the public `screenshots` branch | Until the PR closes (`.github/workflows/prune-screenshots.yml`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Server error reports at Sentry**                   | **30 days** — Developer (free) plan, read from Sentry 2026-10-15. Retention is a plan property, not a setting, so a tier change moves it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Request logs at Vercel**                           | **24 hours** — Runtime Logs on **Pro**, read from the Vercel console 2026-10-15. Build logs are separate; this row is the one carrying IP addresses. No log drains configured.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Database point-in-time window at Neon**            | **6 hours** — read from the Neon console 2026-10-15. ⚠️ This is how far back a branch can be cut FROM. It is **not** the 7-day restore branch two rows down, which is cut explicitly and persists on its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A CSV export already downloaded                      | Not ours to keep or delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The public repository                                | Permanently, including history                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **A Neon restore branch held across a deletion**     | 7 days after the apply, then deleted — a **whole-database** copy, so it holds every household                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **A deletion-ledger entry**                          | Until the restore window that made it necessary has passed. See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

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
source tree.

**The committed data was broader than [plan.md](../plan.md)'s `OSS-1` audit recorded.** That audit
(dated 2026-08-11, and flagged stale in its own blocker box) concluded there is _"no measurement
history… no health record, and no log data"_. **That conclusion did not hold**: a data correction
landed in 2026-10-01 carrying log-row identifiers and weigh-in clock times for a named minor.

> ### ✅ Swept 2026-10-08 — `OSS-1` follow-up
>
> **The two children's given names are out of the working tree**, along with their ages and the real
> bodyweight values that were quoted as contract examples. **Before: 309 occurrences across 57 files.
> After: 1**, listed under "What remains" below.
>
> ⚠️ **A rename is not a removal, and this document does not claim it is.** `git log -S` on either
> removed name still finds every prior value across the repository's history, and the commit author and
> email are in every commit regardless. What the sweep achieves is the **forward** exposure: every
> future commit, preview deploy and PR screenshot is clean **by construction**, which is the property
> that matters when another household is invited in (`TEN-1`). History rewriting was out of scope and
> was not done.

### The surface, and what each class got

The real surface was **57 files / 309 occurrences** — the five classes below plus **a sixth this
section had missed**. Established with `git grep -il` and reconciled against this table (note git's
POSIX regex has no `\b`, so the counts come from a token pattern, not a word-boundary one).

| Class                                     | Where                                                                                                                                                                                           | Fix                                                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture identities                        | `packages/db/src/seed.ts`, `packages/shared/src/seed-ids.ts`, `packages/db/scripts/verify.ts`, `apps/web/e2e/**`, unit tests                                                                    | **Renamed** to role names, hoisted to `SEED_PROFILE_NAME` / `SEED_PROFILE_2_NAME` so the next rename is two lines                                                                                                                                  |
| Names as exported API symbols             | `packages/db/src/index.ts`, `packages/db/src/seed.ts`, `apps/web/lib/routine/contract.test.ts`                                                                                                  | **Renamed, clean break** — no deprecated alias. See the decision below                                                                                                                                                                             |
| Names bound to prescribed loads           | `packages/shared/src/programming.ts`                                                                                                                                                            | **Renamed.** The claim "a named minor wired to a per-child load, in shipped source" was **stale**: `PROGRAM_SEED` ships every per-athlete load as `null` (`db:verify` asserts it). The names were identifier labels and one doc-comment example    |
| A per-minor program table                 | `docs/programs/kids-sc-foundation-archived.md`                                                                                                                                                  | **Scrubbed, not renamed** — the per-athlete load/rep columns are deleted. See the decision below                                                                                                                                                   |
| Real log rows quoted as doc examples      | `packages/shared/src/csv/row.ts`, `apps/web/lib/csv/strength-log.test.ts`, `docs/csv-export-contract.md`                                                                                        | **Scrubbed, not renamed** — the examples now quote the already-cleared `docs/samples/legacy-csv/` corpus verbatim. See the decision below                                                                                                          |
| Dated incidents about a named minor       | `packages/db/scripts/corrections/registry.ts` + its `README.md`, `packages/db/scripts/correct.ts`, `strength-form.tsx`, `docs/status.md`, a changelog fragment                                  | **De-named** — the correction `name`s now describe the **defect**, not the person; prose reads "an athlete"                                                                                                                                        |
| 🆕 **Real bodyweight VALUES as examples** | `docs/csv-export-contract.md`, `docs/csv-recording-gaps.md`, `packages/shared/src/csv/bodyweight.ts`, `apps/web/lib/csv/strength-log.test.ts`, `apps/web/lib/entries/format-value-unit.test.ts` | **A class this section missed.** `71` / `71.0` / `71.2` / `71.4` were a real weigh-in series, which is the one class [SECURITY.md](../../.github/SECURITY.md) singles out as privileged. Replaced with the sample corpus's already-replaced values |
| 🆕 **Two minors' ages and bodyweights**   | `docs/plans/v1-10-two-week-program-source.md` frontmatter, and the `OSS-1` finding row in `docs/plan.md` that **restated** them                                                                 | **A class this section missed.** Removed from both                                                                                                                                                                                                 |

**Still committed, deliberately:** the seed's **fixed, zero-entropy** household and profile `public_id`s
(`packages/shared/src/seed-ids.ts`) — which is why `SEC-6` exists and why no code may ever treat a seed
id as authorization. Unchanged by this sweep.

`docs/samples/legacy-csv/` keeps its own `Athlete A` / `Athlete B` labels and its 2020 dates: a
different corpus, deliberately **not** fixtures, scrubbed before it ever reached `main` and cleared for
release in its own [README](../samples/legacy-csv/README.md). The fixtures use `One`/`Two` instead,
because the program's day roles are already Day A / Day B.

### The three judgement calls, with reasoning

**1. The exported symbol took a clean break, not an alias.** The second profile's seeded-routine export
is now `SEED_ATHLETE_TWO_ROUTINE`. Every consumer was checked first: three in-workspace sites (the definition
in `packages/db/src/seed.ts`, the re-export in `packages/db/src/index.ts`, and one import in
`apps/web/lib/routine/contract.test.ts`), plus doc mentions. `@mat-plan/db` is `private: true` and has
never been published, so there is no downstream consumer to deprecate for — and an alias would have
**left the name in the public API surface**, which is the one thing the sweep exists to remove. The
A≠B routine contrast the symbol carries is load-bearing and survives unchanged.

**2. The archived program table was scrubbed, not renamed** —
`docs/programs/kids-sc-foundation-archived.md`. It carried four columns (a load and a rep target per
child) across 21 rows: a minor's prescribed training programme. **A rename only de-labels that; the
numbers were the exposure.** Kept: the day split, the order, the movements and the shared prescription —
the part a re-seed actually needs. Dropped: the per-athlete numbers, which that file's own note already
said must be re-confirmed against logged working sets before use, so there was no forward value to trade
against. The shipped `PROGRAM_SEED` already seeds every per-athlete load as `null`, so the scrubbed table
matches how a program is seeded today.

**3. The CSV contract's example rows now quote the cleared corpus verbatim** —
`docs/csv-export-contract.md`, `packages/shared/src/csv/row.ts`,
`apps/web/lib/csv/strength-log.test.ts`. These were **pre-scrub** copies of rows that already exist,
scrubbed, in `docs/samples/legacy-csv/` — the doc was quoting a version of its own evidence file that
the evidence file no longer contains. **Checked before changing them, because they are load-bearing for
the byte-faithful contract**: the property each vector pins is the _bare inch marks in an unquoted field_
(`30" box`), the unescaped comma, `SKIPPED`, `sub-failure` and the slash-list arity — **not** the name or
the date. So aligning them to the committed sample rows preserves every tripwire byte-for-byte while
removing the names, the real dates and the real bodyweight values. No real row is required to pin the
contract; a real _shape_ is, and the shape is unchanged. This is strictly better than deleting the
examples, and it makes the quoted rows checkable against a committed file instead of unverifiable prose.

**Retained with reasons: `docs/plans/v1-10-two-week-program-source.md`.** Its ages and bodyweights are
gone. Its **de-named per-athlete load splits stay**, because they are the evidence for a schema decision
— that `prescription_targets` must be **per profile** rather than per block, since two athletes on one
prescription genuinely carry different loads. Delete the split and the only record of _why_ that table
exists goes with it. This follows the standard the repo already set and reviewed for
`docs/samples/legacy-csv/`: names, dates and bodyweight **values** out, de-named strength loads in. The
difference from decision 2 is that the archived doc is **packaged for re-seeding** (its numbers are an
instruction), while this one is a dated **design record** (its numbers are testimony about shape), and the
file now says so at the top. A stricter call remains available if the maintainer wants it.

### What remains — residuals, not oversights

1. 🔴 **Git history.** `git log -S` finds every removed value across the repository's history, and the
   commit author and email are in every commit. Removing it means `git filter-repo` plus a force-push and
   a re-clone, which was **not** in this sweep's scope and remains an open, un-chosen option
   ([plan.md](../plan.md) → `OSS-1` → "The names question").
2. ⚠️ **One occurrence in the working tree, and it stays.**
   `packages/db/migrations/0012_bodyweight_one_per_day.sql` carries a given name in a **comment**. It is an
   **applied** migration: the forward-only guard (`.github/workflows/ci.yml`) permits only **added** files
   under `packages/db/migrations/`, because a migration's SQL is hashed in `__drizzle_migrations` and
   editing it makes prod and the repo diverge. Changing a comment is not worth breaking the one DB rule
   that has no exception. It goes only if history is rewritten, which is residual 1.
3. ⚠️ **The `screenshots` branch.** `prune-screenshots.yml` deletes image files when a PR closes but does
   not rewrite that branch, so earlier screenshots of the picker and Today remain reachable in its history.
   Noted, not acted on.
4. ⚠️ **PR refs #152–#167** still carry a third-party roster of minors that only GitHub Support can purge
   (`OSS-1`).
5. **The production database is untouched, on purpose.** The real names in `profiles.name` are the
   household's own legitimate data, and the seed is `onConflictDoNothing` on `public_id`, so a re-seed
   cannot and does not rename a live row. No correction was written and none is proposed.

**Status:** `OSS-1`'s rename is **done**; the Beta 0 blocker it held is cleared.

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
