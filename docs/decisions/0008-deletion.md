# ADR 0008 — What "delete" means

**Status:** Proposed · **Date:** 2026-10-18 · **Scope:** Beta 0 and later ·
**Relates:** [ADR 0007](./0007-scheduling-model.md) (program lifecycle — `program_assignments`,
`active_to`, the act `RETIRE-1` actually needs), [ADR 0006](./0006-household-addressing.md) (the
household seam every act here is scoped by), [ADR 0003](./0003-superset-log-grouping.md) (the
grouping-row degrade idiom, which is already "hide the container, keep the content")

> **This is the second draft.** The first decided the same four questions and got two of them from a
> premise that is false. It said _"every uniqueness arbiter is partial on `deleted_at IS NULL`"_ —
> **fourteen are; the non-partial `public_id` UNIQUE on all fifteen soft-deletable tables is not** —
> and built on it an undo that _"costs one `UPDATE`"_ and a `/api/sync` rule prescribing the **exact
> inverse** of a shipped, green assertion ([`verify.ts:3592-3606`](../../packages/db/scripts/verify.ts),
> V1-24 1e). A six-lens panel found that the undo is **fallible today** and the repo already said so
> ([`runbooks.md:62`](../runbooks.md): _"After 1d lands, un-deleting a row would violate its index"_),
> that the sync rule was unbuildable under the document's own "no migration", that _"delete means
> hidden **from me**"_ has **no "me"** — there is no `deleted_by` column anywhere — and that the draft
> quoted the published privacy notice with an ellipsis that removed the four words contradicting it.
> The decisions below are the maintainer's, taken with those corrections in hand. The response log is
> at the end, pushbacks included.

## Context — five positions, and the one that is published

Every one of these is in the tree today, and they do not agree.

| Source                                                                                    | What `deleted_at` means there                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`notice.md`](../privacy/notice.md) → "How long we keep it" — **published at `/privacy`** | _"**'Delete' currently means 'hidden'.** The app has no way to permanently remove a single logged item **yet** … **Per-item deletion is being built; until then**, this is how it works."_ |
| [`plan.md`](../plan.md) → `V1-9b`                                                         | the user-facing Delete, reusing `entries.deleted_at` as "the LWW tombstone model"                                                                                                          |
| [`plan.md`](../plan.md) → `PRIV-3` item 2                                                 | a **purge window** N after which soft-deleted rows are hard-deleted                                                                                                                        |
| [`plan.md`](../plan.md) → `RETIRE-1`                                                      | _"`deleted_at` means 'this was removed'"_ — therefore the wrong primitive for archiving a program                                                                                          |
| [`plan.md`](../plan.md) → `TEN-2b-2`                                                      | a tombstone is **unacceptable** for `movements`: the resolver has no `deleted_at` filter, so it would be handed back forever                                                               |

**The notice is not promising this state — it is disclosing a defect.** The document says so about
itself: _"Where something is **not yet as good as it should be, this notice says so** rather than
leaving you to find out."_ Four temporal markers sit in that one passage — _currently_, _yet_, _being
built_, _until then_. So a hide-only world does not preserve the published promise; it **retracts**
one. That is the finding that reversed this ADR's first draft, which had argued the opposite.

### What the code actually enforces

Grounding, because later plans will be written from this document.

- **Zero hard deletes in shipped app code.** No Drizzle `.delete(` in `apps/web` or `packages/db/src`; the seven data-mutating Server Actions only insert and update. (The only `.delete(` in `apps/web` is a JS `Set`, `strength-form.tsx:402`.) The hard deletes in the tree are the runbook's hand-typed SQL and `db:verify`'s own cascade probes.
- **`deleted_at` is on 15 tables** from one `timestamps` spread, and absent from the three reference tables (`units`, `quantity_slots`, `activity_type_categories`).
- **It is written in exactly one committed correction**, and nothing purges it.
- 🔴 **Fourteen uniqueness arbiters are partial on `deleted_at IS NULL`; the `public_id` UNIQUEs are not.** So a hide frees the **natural** key — `client_id`, the weigh-in day, the quantity arity, every ordinal-within-parent — and **keeps the public one**. The rule is not "a hide frees everything". `movements`' two arbiters are partial on `household_id` instead ([`schema.ts:533-535`](../../packages/db/src/schema.ts) says so, four lines above the prohibition this ADR quotes). ⚠️ [`data-inventory.md`](../privacy/data-inventory.md) §5 states the over-general version; **this PR fixes it there too**, or the ADR is contradicted by the document it cites.
- 🔴 **Un-hiding is therefore fallible.** A hide frees its slot; if a live row takes it, the un-hide raises `23505`. [`runbooks.md:62`](../runbooks.md) records this for the weigh-in index, and `db:verify` **constructs that state and leaves it there** — the 1c correction's losers sit beside the keeper, in production.
- **A replay must not resolve onto a hidden row**, and this is proved: `insertBodyweightEntry` pins its replay lookup to `deleted_at IS NULL` so a resubmit answers `{ dayTaken: true }` rather than the dead row's id ([`verify.ts:3592-3606`](../../packages/db/scripts/verify.ts), V1-24 1e).
- **"Hide the container, keep the content" already ships on `deleted_at`**: the day read puts `deleted_at` in the `ON`, so a soft-deleted session or superset **degrades its members to flat rows** instead of dropping them ([`entries.ts:164-175`](../../apps/web/lib/dal/entries.ts)). Subtree behaviour is per-reader, not a single rule.
- **The export excludes hidden rows at five places** ([`export-month.ts`](../../packages/db/src/queries/export-month.ts) `:88, :94, :100, :143, :170`), `loggedMonths` included — so a profile whose entries are all hidden exports an **empty zip**.
- **`movements` carries a standing prohibition** at [`schema.ts:538-542`](../../packages/db/src/schema.ts), naming the three things one PR must do together to lift it.
- **LWW does not exist yet.** `updated_at` is server-stamped (`sql\`now()\``in every writer); the client-supplied`setWhere incoming >= stored`compare is v1.5 work. And the live edit path is **not** LWW at all —`amendBodyweight`uses`seenValue` optimistic concurrency and says so.

## Decision 1 — "Delete" means **hidden from the household, then purged** _(maintainer, 2026-10-18)_

When a person deletes something, the row **stops being visible to everyone in the household** and is
**hard-deleted after a purge window `N`**. Hidden is a state with an end, not a resting place.

Two corrections to how this was first written, both from the panel:

1. ⚠️ **It is not "hidden from me".** There is **no `deleted_by` column anywhere** in `packages/` or `apps/`, and every read filter is unconditional. With no migration, a hide is hidden from **every viewer** — a child taps delete on a weigh-in and it is gone from a parent's screen too. Per-person visibility would need a `deleted_by` column **and** a per-viewer predicate, and pre-`AUTH-1` there is no "me" to scope to: one gate code reaches every athlete. Decision 2 is what gives a parent the row back.
2. ✅ **`PRIV-3` item 2 is RE-SCOPED, not rejected** — the reverse of the first draft. A purge window makes the published notice's _"per-item deletion is being built"_ **true** instead of requiring its retraction, and it is the more protective answer for a child's deleted weigh-in: without it, the only remedy finer than keeping the row forever is erasing the whole athlete. `N` is bounded below by the restore window in Decision 2, and the two are set **together**, in that row's plan, with the notice updated in the same PR.

**Erasure and archive remain different acts:**

| Act                      | Trigger                                    | What happens to the row                                                                 | Who                       |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------- |
| **Hide** (`deleted_at`)  | a person taps Delete                       | invisible to the household; restorable; hard-deleted at `N`                             | anyone who can log        |
| **Erase**                | an athlete or household asks to be deleted | hard `DELETE`, the runbook's 13 statements — **except a ledger entry that outlives it** | the operator, out of band |
| **Archive** (`RETIRE-1`) | a program is superseded                    | **its own marker, not `deleted_at`**                                                    | a parent                  |

### What this settles

- 🔴 **The notice needs one sentence changed, and this PR changes it.** The first draft claimed _"the notice stands unchanged"_; it does not. Its retention **table** row stands; the _"per-item deletion is being built"_ passage becomes a description of what was built — a Delete that hides, then purges at `N`.
- ✅ **`V1-9b` is a hide**, and "tombstone" leaves its row: a tombstone implies erasure with no way back, and this one has both a way back and an end.
- ✅ **`RETIRE-1` keeps its own marker** — but ⚠️ **not for the reason the first draft gave.** "`deleted_at` drops children out of live reads" is false for the two grouping parents, which deliberately degrade instead (`entries.ts:164-175`). The real discriminator: **archive is a lifecycle state a parent can see and restore from, orthogonal to existence; hide is invisible and ends in erasure.** A program's history must stay _readable in place_, which is not what hiding does. ⚠️ ADR 0007 already authorizes a fourth act on the same subtree — **closing an assignment** (`active_to`) — and whether archiving closes open assignments is `RETIRE-1`'s own open question. Three acts here, four in the authorized schema; that gap is named, not resolved.
- ✅ **`movements` is exempt — for the index reason, not a data-kind one.** The first draft said "reference data, not a person's content". Half wrong: since TEN-2a the table holds household-authored rows too, and a parent who typed "RDL" authored that one. The actual reason is `schema.ts:533-537`: the resolver has **no `deleted_at` filter**, so a tombstone is handed back forever. ⚠️ A household's own mis-typed movement therefore has **no user-facing removal path**, by decision — a gap `TEN-2c-1` or a successor owns.

### The general rule — mechanical, not authorial

> **A row may be hidden only if every resolver that reads its namespace filters `deleted_at IS NULL`.
> A namespace whose resolver does not — today, `movements` — is removed, not hidden, and only by a
> correction.**

The first draft's rule was _"`deleted_at` is for content a person authored about themselves"_, which
**misclassifies four tables that use it today** (`program_blocks`, `prescriptions`,
`prescription_targets` — a parent authors programming _for a kid_ — and `profiles`, which is a person,
not content). The mechanical rule keeps all four inside, predicts the `movements` prohibition's
three-part lift condition, and does not depend on who authored what.

### One constraint this creates

A hide must **never** remove the export path: we would hold the data while the person could no longer
get it, which is the one thing the notice promises unconditionally. The first draft scoped this to
profiles; it is **every grain**, because the export filters hidden rows at five places.

Good news the panel found: `profiles.public_id` is **non-partial** UNIQUE, so a hidden profile **keeps
its addressable id** — the fix is a predicate in one resolver, no migration. ⚠️ But that resolver is
`isLiveProfile`, a deliberately single-sourced **security** predicate with two structural guards
asserting no copy exists. So a deleted-tolerant export path is one audited variant in `packages/db`,
counted against those guards — or, cheaper, **export-before-hide**: the routine export omits hidden
rows, and the notice's on-request _"full copy"_ includes them. `V1-9b` picks one and says which.

## Decision 2 — a hide is **restorable until it is purged**, through a visible Hidden row

Not a toast. _(maintainer, 2026-10-18)_

A hidden row stays visible **as a count**: a collapsed `Hidden on this day (2) — Restore` row under
the day's list. Chosen over a transient undo because the transient one cannot work here — the day nav
is plain server-rendered `<Link>`s, so any client-held state dies on a day change or a reload, and a
kid who puts the phone down mid-set loses the only recovery path. It also answers Decision 1's cost:
a parent can see that something was removed, which a silent hide never allows.

- **This is the repo's first read that returns `deleted_at IS NOT NULL`.** Name it as such: a narrow, day-scoped read, not a relaxation of the filter everywhere.
- 🔴 **Restore is conditional and fallible, and the UI must render the refusal.** The freed slot may be taken by the time Restore is tapped → a typed per-item result (`slot_taken`), **never a `23505`** and never a silent no-op. The first draft's _"undo costs one `UPDATE`"_ was false, and a prototype built on it would have had no failure state at all.
- **Restore is also defeated by a later write.** Under v1.5's LWW a hide from another device with a later client clock beats it, so Restore can report success and lose. The prototypes owe copy for both refusals.
- **The restore window is the purge window.** Restorable until purged, at `N`. One number, not two, and that is what makes Decision 1's re-scope coherent rather than two mechanisms with different clocks.
- **"Clear a whole day" restores as ONE event**, not N. A per-row restore of a seven-entry day on a phone is not a recovery path.
- ⚠️ **Erasure's 7-day cancellable pause is unrelated and unenforced** — operator memory plus a ledger field, owned by `PRIV-3`. And `OPS-3`, extracting one household from a restore branch, is still a `_TODO_` stub, so the runbook's words stand: _"a mistaken or fraudulent deletion is not practically recoverable."_ Its rehearsal is a precondition of the first real erasure.

## Decision 3 — a hide is a **syncable event**; the freed slot is a migration this ADR does not authorize

1. **A hide is an event in the outbox**, carrying the row's `client_id` and the client's timestamp — not an absence, which is indistinguishable from "this device never had it". Un-hide likewise.
2. ✅ **A replay must never resolve onto a hidden row.** This **adopts** V1-24 1e rather than overturning it; the first draft prescribed the inverse and cited that very proof as support.
3. 🔴 **`deleted_at` is never written as a side effect of an ordinary field upsert** — otherwise an edit from a device that never saw the delete silently un-hides the row, which defeats item 1 from the other direction.
4. ⚠️ **The freed `client_id` is a real hazard and closing it is a schema change.** All five `client_id` arbiters are partial, so a hidden row is **not an `ON CONFLICT` target** and a replay inserts a second row instead of replaying. Making it occupy its slot means re-predicating five indexes — a **migration owed by whichever of `V1-9b` or the sync PR lands first**, which must first prove no hidden/live `client_id` pair exists in prod. The alternative is an app-level pre-check, which AGENTS.md forbids by name. ⚠️ **This is not only a v1.5 concern:** `logCheckIns` already arbitrates on `client_id WHERE deleted_at IS NULL`, so **`V1-9b` arms the inversion**, not the sync PR, by being the first thing that writes `deleted_at` at volume.
5. **LWW is row-level and does not exist yet.** One `updated_at` per row, server-stamped today. So when it lands, the winning event's whole row lands, `deleted_at` included — and the live edit path is `seenValue` optimistic concurrency, not LWW, where a hide currently beats an edit unconditionally. Whoever builds sync reconciles three policies, not one.

## Decision 4 — deletion authority **equals logging authority**

⚠️ **Stated honestly, which the first draft did not.** It said _"a child may hide their own data"_.
There is no "own": one gate code reaches every athlete and profile tiles are _"a UX switch, not a
security boundary"_, so **anyone who can log may hide any athlete's data, including a sibling's
weigh-ins** — which `SECURITY.md` treats as privileged precisely because siblings are the threat
model.

This is accepted rather than mitigated, because anyone who can log **can already destroy more than
they can hide**: `editRoutineAction` overwrites `routine_config` with no history. Gating a restorable
hide more tightly than an irrecoverable overwrite would be theatre. It is also why Decision 2's
Restore row must live on the **athlete's page**, reachable by a parent, not only on the device that
hid the row.

⚠️ **After `AUTH-1` this is revisited, not inherited.**

## What this ADR does NOT authorize

No migration, no column, no purge job, no new table. `V1-9b`, `PRIV-3` and `RETIRE-1` each carry their
own plan and panel. Also carried forward: `PRIV-3`'s rule that **no household id may be committed** —
that plus the public `Applied` table would publish a register of who asked to be erased.

## Backlog impact

| Row                  | What this ADR gives it                                               | What it must NOT do                                                                                        |
| -------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `V1-9b`              | hide, not tombstone; entry grain; the Restore row; one typed refusal | ship without the `notice.md` edit, the entry→set live-parent proof, or a decision on the freed `client_id` |
| `PRIV-3`             | item 2 re-scoped and alive; `N` ≥ the restore window                 | set `N` without setting the restore window in the same plan                                                |
| `RETIRE-1`           | its own marker confirmed, on the corrected discriminator             | reuse `deleted_at`; ignore `active_to` (ADR 0007)                                                          |
| `TEN-2c-1`           | the `movements` exemption, on the index reason                       | leave a household's mis-typed movement with no path at all, silently                                       |
| v1.5 sync            | items 1-5; V1-24 1e adopted                                          | invert `verify.ts:3592-3606` without a plan that says so                                                   |
| `HIST-1` / `CLONE-1` | hidden rows are absent from history reads, and end at `N`            | assume a hidden row is permanent                                                                           |

## What this does not settle

`N` itself. The restore window's exact surface. Whether the export omits hidden rows or includes them
on request. Whether archiving closes open assignments. Who may hide what after `AUTH-1`. The grain
beyond entries — **entry only** is decided _(maintainer, 2026-10-18)_; `entry_sets.deleted_at` exists,
so set grain stays available and unbuilt.

## Prototypes before implementation _(maintainer, 2026-10-16)_

Deletion is the first surface where **a child can remove something a parent will look for later**, so
the interaction is reviewed before it is built. **One prototype**, not three — archive-vs-hide was cut
because `RETIRE-1` is gated on `CLONE-1` and `SCHED-1` and already owes its own UX panel, which will
see archive next to delete in context:

**Per-item hide + the Hidden/Restore row on Today**, covering: where the control lives; what the
Hidden row looks like and whether it survives a reload and a day change; **what Restore looks like
when the slot was re-taken**; a second delete before the first restore; where focus lands when a row
leaves a `<ul>`; **what a parent sees on a day a child hid from**; and the longest real movement label
measured at 360px, where the row has ≈294px of content and the set-fields row already takes ≈275 of it.

A11y constraints the plan must not get wrong, none of which `e2e/a11y.spec.ts` covers: the live region
must be **mounted before** its text changes (this repo has paid for that twice, with the reasoning
committed in `saved-announcer.tsx` and `editable-set.tsx`); focus must land somewhere deliberate when
a row unmounts; and no timed affordance, which would be a WCAG 2.2.1 problem — the Hidden row avoids
it by not being timed.

## Consequences

**Good.** The published notice becomes true by construction: a Delete that hides and then purges is
the "per-item deletion" the page already told families was coming. A mis-tap is recoverable for the
first time, and recoverable by a **parent**, not only by the device that caused it. `deleted_at`
finally means one thing with one lifecycle. And a child's deleted weigh-in eventually goes.

**Costs, stated.** A hidden row is retained until `N`, so the honest cost is **reachability and
retention, not growth** — prod is ~51 rows after several weeks, and a hidden row leaves the fourteen
partial indexes entirely, so those _shrink_. Restore is fallible, which is new user-visible failure
surface. The Hidden row is the first read that returns deleted rows, and it is visible to anyone with
the gate code, which is a different privacy statement than the inventory currently makes. Per-**item**
erasure on demand still does not exist: `PRIV-3` item 1 is per athlete and per household.

## Review-response log

### Six-lens panel, round 1 (2026-10-18)

Lenses: correctness · scope · architecture · privacy · UX · DB-safety. **16 BLOCKING raised, 14
accepted.** Every finding below was re-verified in the code before being accepted or declined.

| #   | Lens                                   | Critique                                                                                                                                                   | Verdict                 | Resolution                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | correctness · DB-safety · architecture | _"Every uniqueness arbiter is partial on `deleted_at`"_ is false — 14 are, the `public_id` UNIQUEs are not, and `movements`' are partial on `household_id` | **accepted**            | Context rewritten to the 14-vs-non-partial split; the `movements` exemption re-grounded on the index reason; the upstream sentence in `data-inventory.md` §5 fixed in this PR                                                                                                        |
| C2  | DB-safety · correctness                | _"undo costs one `UPDATE`"_ is false — a hide frees the slot, so an un-hide can raise `23505`; `runbooks.md:62` already said so                            | **accepted**            | Decision 2 rewritten: restore is conditional, with a typed `slot_taken` refusal the UI must render; added to the prototype brief                                                                                                                                                     |
| C3  | all four                               | Decision 3.3 prescribed the inverse of green assertion V1-24 1e, and was unbuildable under "no migration"                                                  | **accepted**            | V1-24 1e **adopted**; the freed slot demoted to a named migration precondition with an owner                                                                                                                                                                                         |
| C4  | UX                                     | "hidden from me" has no "me" — no `deleted_by` column, every read filter unconditional                                                                     | **accepted**            | Decision 1 renamed to "hidden from the household" and the consequence stated plainly                                                                                                                                                                                                 |
| C5  | privacy                                | The notice quote was elided at the four words contradicting it; it discloses a defect, it does not promise a state                                         | **accepted**            | Context carries the full passage; _"the notice stands unchanged"_ struck; the notice edit is owed in this PR                                                                                                                                                                         |
| C6  | privacy                                | Rejecting the purge window mistook a disclosure for a justification, and no `N` was ever evaluated                                                         | **accepted**            | `PRIV-3` item 2 **re-scoped, not rejected**; `N` ≥ the restore window, both set together                                                                                                                                                                                             |
| C7  | UX · architecture                      | An indefinite undo is a restore surface, not an undo, and nothing owns it                                                                                  | **accepted**            | Decided as the visible Hidden/Restore row, with its read named as the repo's first deleted-row read                                                                                                                                                                                  |
| C8  | privacy                                | The export hazard is every grain, not profiles — five filters, and `loggedMonths` yields an empty zip                                                      | **accepted**            | Generalised; the `isLiveProfile` single-sourcing cost named; export-before-hide offered as the cheaper shape                                                                                                                                                                         |
| C9  | architecture                           | _"`deleted_at` drops children out of live reads"_ is false for sessions and supersets, which degrade deliberately                                          | **accepted**            | The archive discriminator re-grounded; the false Consequences line removed                                                                                                                                                                                                           |
| C10 | architecture · correctness             | The general rule misclassifies four tables that use `deleted_at` today                                                                                     | **accepted**            | Replaced with the mechanical resolver-filter rule                                                                                                                                                                                                                                    |
| C11 | privacy · UX                           | _"a child may hide their own data"_ is unenforceable; the sibling axis was unnamed                                                                         | **accepted**            | Decision 4 restated honestly; Restore placed on the athlete's page                                                                                                                                                                                                                   |
| C12 | architecture                           | `Relates: ADR 0005` is not real; 0007 owns program lifecycle and was never cited                                                                           | **accepted**            | Header corrected to 0007 · 0006 · 0003; `active_to` named as a fourth act                                                                                                                                                                                                            |
| C13 | architecture                           | No Backlog-impact table, no "What this does not settle" — both siblings carry them                                                                         | **accepted**            | Both added                                                                                                                                                                                                                                                                           |
| C14 | scope · UX                             | Three prototypes with "several rounds" is a net-new recurring gate; prototype 3 earns it least                                                             | **accepted**            | Cut to one, with the questions the set was missing — including the parent's view — folded in                                                                                                                                                                                         |
| S1  | scope                                  | The ADR should be ~half its length; Decisions 3 and 4 decide a subsystem and a principal that do not exist                                                 | **partly declined**     | Both compressed hard and re-framed as preconditions rather than rules. Kept because `V1-9b` **arms** the sync hazard (`logCheckIns` already arbitrates that way), so a sync-only framing would mislead the next author; and Decision 4 is what justifies the Restore row's placement |
| S2  | scope · privacy · architecture         | The ADR instructs `plan.md`, `data-inventory.md` and `notice.md` edits and makes none                                                                      | **accepted**            | All made in this PR; see the PR description                                                                                                                                                                                                                                          |
| S3  | correctness · scope                    | `grep` evidence overstated; two cite ranges off by a line                                                                                                  | **accepted**            | Corrected to "no Drizzle `.delete(`"; ranges fixed; per the inventory's own policy, cites into files this PR edits are now **by section**                                                                                                                                            |
| N1  | architecture                           | "hide/erase/archive" will not survive contact with UI copy, which says _Remove_, _Delete_, _Clear_                                                         | **deferred to `V1-9b`** | The vocabulary mapping belongs with the screen that uses it, not here. Named in the prototype brief                                                                                                                                                                                  |

**Also declined:** a finding that `SECURITY.md` owes an edit (it is pointers-only and already points
at the grain this ADR keeps), and the suggestion to take ADR number 0009 — the number goes to the
document that gets written, so the ladder spec's forward reference moves instead, in this PR.

## Decision box

The maintainer signs off on: Decision 1 (hidden from the household, then purged at `N`), Decision 2
(restorable until purged, via a visible Hidden row, with a typed refusal), Decision 3 (V1-24 1e
adopted; the freed slot is an owned migration precondition), Decision 4 (authority equals logging
authority, revisited at `AUTH-1`), the mechanical general rule, entry grain, and one prototype.

_Signed off by the maintainer (the household operator), 2026-10-18._
