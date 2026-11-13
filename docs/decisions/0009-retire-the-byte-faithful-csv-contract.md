# ADR 0009 — Retire the byte-faithful CSV contract; keep an export

**Status:** Accepted · **Date:** 2026-11-13 · **Scope:** now ·
**Relates:** [csv-export-contract.md](../csv-export-contract.md) (demoted by this ADR),
[ADR 0005](./0005-programming-model.md) and [ADR 0007](./0007-scheduling-model.md) (several of whose
costs exist only to protect CSV bytes), [privacy notice](../privacy/notice.md) → "Getting your data out"

## Context

Since V1-13 the export has been held to a **byte-faithful** contract: four legacy CSV layouts, read by
Claude skills in an external workflow repository, where _"an export that looks plausible but differs
by a column, a separator, or a trailing newline silently breaks that workflow"_
([csv-export-contract.md](../csv-export-contract.md)). AGENTS.md → "What this is" names it as one of
the app's purposes.

**The maintainer confirmed on 2026-11-13 that the workflow is no longer in use.** Nothing reads those
bytes.

The contract was never only about the export file. It has been a constraint on designs far from it:

- **The workout cap.** V1-22 A4 caps a program at three workouts (`MAX_WORKOUTS`, a
  `workouts.slug CHECK IN ('strength_a','strength_b','strength_c')`) because the slug is written into
  the CSV's `session_type` column.
- **ADR 0007 decision 3's costs.** Two of its five named costs exist only for the export: the slug
  grammar (a comma in `session_type` throws the whole export) and the export's `DAY_ROLES` gate. A
  third (the extra soft-delete level) also edits the contract's `session_type` section. Together they
  are part of why the full `workouts` arc was priced at six PRs and deferred.
- **V1-22 chunk 3** (planned, not built): a backfill whose acceptance is that it _changes no bytes_.
- **ASSIGN-READ's READ-2b**: "the cells that can move", pinned for a contract another pillar owns.
- **Non-standard quoting**: the export is "Not RFC-4180" and throws on a comma rather than quoting it.

## Decision

1. **The byte-faithful contract is retired.** No design is constrained by preserving the legacy
   CSV layouts or bytes. A plan that cites "the export must not change" as a reason now needs a
   different reason.
2. **An export stays.** The [privacy notice](../privacy/notice.md) promises one: _"a zip of
   spreadsheet files, one per month"_. Getting your data out is a privacy commitment, not a
   workflow integration. The export's **format is ours to define**; it is documented and may change.
3. **What a change to the export owes:** (a) the export stays complete for what the notice says it
   contains, and the notice changes in the same PR if that changes (the AGENTS.md rule for
   `data-inventory.md` and the notice already says so); (b) the documentation describes the format
   that ships; (c) files open correctly in a common spreadsheet app, so standard RFC 4180 quoting is
   **allowed and preferred**: a comma in a field gets quoted, not refused.
4. **Nothing changes in code by this ADR.** The current export keeps working as-is. Its byte-level
   tests stay as regression tests of current behaviour until a PR has a reason to change them; that
   PR changes them without needing an exemption.
5. **`entries.prescribed_snapshot` stays.** It was introduced partly for the CSV's `prescribed`
   column, but its other job stands: a program edit must not rewrite what an athlete was asked to do
   on a past day (HIST-1, history views). Whether V1-22 chunk 3's backfill is still worth doing for
   rows logged before the snapshot existed is re-decided in its own plan, not here.

## Consequences

**Unblocked, to be re-planned in their own documents:**

| Document            | What changes                                                                           |
| ------------------- | -------------------------------------------------------------------------------------- |
| V1-22 A4            | The three-workout cap and the `strength_a/b/c` slug CHECK lose their reason            |
| ADR 0007 decision 3 | The full `workouts` arc loses its export-driven costs; re-price it                     |
| V1-22 chunk 3       | Re-justify (history views) or drop                                                     |
| ASSIGN-1 → READ-2b  | The pinned "cells that can move" work shrinks or goes                                  |
| The export itself   | May adopt RFC 4180 quoting, an athlete-named layout, new files (check-ins, activities) |

**Kept:** the export, the notice's promise, the snapshot, and the rule that a name never appears in
an export path (the notice tells families this; changing it is a notice change).

**Documentation updated in this PR:** AGENTS.md → "What this is"; the head of
`csv-export-contract.md`, which now describes the current format and is no longer a contract with
an external reader.

## Alternatives considered

- **Keep the contract "in case".** Rejected: it has a real cost (the workout cap, a deferred data
  model, a planned backfill) and no reader. If a workflow ever needs a fixed format again, a
  versioned export written for it is cheaper than constraining the data model.
- **Drop the export entirely.** Rejected: the privacy notice promises it, and data portability is a
  trust property for families.
