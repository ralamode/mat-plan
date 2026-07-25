# ADR 0003 — Superset log grouping (V1-8)

**Status:** accepted (V1-8-1) · **Date:** 2026-07-25 · **Supersedes/relates:** ADR 0002 (ramp targets)

## Context

V1-8 turns the single-movement strength logger into a **session** grouping N movements. spec.md §4
requires that 2+ movements can be tagged into a **superset** performed _alternating_, and — a hard
constraint — the model must carry **arbitrary N-movement adult PPL pairings** (Ray's DB Bench + Overhead
Press, Dips + Lateral Raises), because v2's PPL logging **reuses** it. "Do not build a kids-only shortcut
that later blocks PPL supersets." `sessions` and `entries.session_id` already exist; supersets do not.

## Decisions

1. **A `supersets` table, not a denormalized group key.** A bare `entries.superset_id` group key would
   duplicate the `label`/`note` across every member (drift), and the offline replay graph + a stable,
   soft-deletable identity need a row with its own `public_id`/`client_id`. spec §4 names `superset` as an
   entity. So: a table with `session_id` (FK), `label`, `note`, `client_id` (+ partial-UNIQUE, the
   `sessions` idiom — a superset has no natural key), and the shared `timestamps`.

2. **Order lives on two axes, and only two.** _Within a superset_: an explicit `entries.superset_order`,
   unique per superset via `uq_entries_superset_order` (the `entry_sets.uq_entry_sets_entry_idx`
   ordinal-within-parent idiom) — deterministic and stable under v1.5 LWW re-inserts where `id` order
   isn't. _Session-level_ (block order): **insertion order** (`entries.created_at`/`id`) — a superset
   block sits at its earliest member's `id`. **No `supersets.position` column:** the spec doesn't model
   one, the arbitrary-N _arity_ requirement doesn't need it, and it would be a second session-scoped
   ordinal we already decline for standalone movements. If v1.5 edits ever require reordering independent
   of insertion, a nullable `entries.session_order` is a clean additive backfill from `id` — not a
   re-model.

3. **Arity is uncapped.** No CHECK limits a superset to 2 members; `db:verify` proves a 2- **and** a
   3-movement superset round-trip identically. That is what makes v2's PPL reuse real rather than a
   kids-only special case.

4. **Same-session membership + "≥2 members" are writer invariants, not schema constraints.** A composite
   FK could force `entry.session_id == superset.session_id`, but the schema **already** handles the
   identical cross-parent case (`entry.profile_id` vs `session.profile_id`) via the writer, with no
   composite FK — so adding the schema's first one only for supersets would be an inconsistent one-off.
   The writer (`logStrengthSession`, V1-8-2/8-3) sets `entry.session_id = superset.session_id` and only
   groups within a session; `db:verify` asserts a produced graph is self-consistent. "≥2 members" isn't
   cheaply DDL-expressible (a deferred trigger) — also a writer invariant, tested with the write path.
   (The one property that _is_ a cheap single-table CHECK — a member must be a movement — **is** enforced:
   `entries_superset_movement_check`.)

5. **The log-superset is an event; the prescription-superset is a definition.** spec's def/event split
   means the v2 `prescription.superset_label` (the planned grouping) is separate from this logged
   `superset` (what happened). Nothing is owed on `supersets` now; v2 links them **prescription-side** (a
   future `prescription_id`/`block_id` is a clean nullable add).

## Consequences

- V1-8-1 migration `0005`: the `supersets` table + `entries.superset_id`/`superset_order` +
  `idx_entries_superset` + `uq_entries_superset_order` + two hand-added CHECKs (`entries_superset_order_check`
  pairing, `entries_superset_movement_check`). Expand-only; no app code (DB-only, per the V1-6b-1 precedent).
- Session entries write `kind=NULL` (+ `movement_id`/`movement_name`), and the read set-fetch dispatches on
  `movement_id`, so V1-8 **decouples from** V1-1d (the `kind` drop) rather than feeding it.
- v2 adds `block_id`/`prescription_id`/progression additively; per-movement progression state is orthogonal
  to superset. No foreseeable re-model.
