- **2026-11-13** — **ADR 0009: the byte-faithful CSV contract is retired; the export stays**
  ([ADR](../decisions/0009-retire-the-byte-faithful-csv-contract.md)). The external workflow that read
  the four legacy CSV layouts is no longer in use, so nothing reads those bytes. The contract had been
  constraining designs far from the export: the three-workout cap in V1-22 A4 (the slug lands in
  `session_type`), two of ADR 0007 decision 3's five costs, V1-22 chunk 3's "changes no bytes"
  backfill, and ASSIGN-READ's pinned cells. The export itself stays, because the privacy notice
  promises families one; its format is now ours to define and may adopt standard RFC 4180 quoting.
  No code changes here: the current export keeps working and its tests stay as regression tests
  until a PR has a reason to change them. `prescribed_snapshot` stays for history views. AGENTS.md's
  "What this is" and the head of `csv-export-contract.md` are updated to match.
