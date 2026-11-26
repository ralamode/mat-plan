- **2026-11-26** — **The old strength writer and its schemas are deleted** (`LEGACY-1` C2b,
  [plan](../plans/legacy-1-retire-strength-path.md)): the legacy session writer and set edit, their
  movement resolver, the frozen-snapshot helper, the weekly adherence read, and the shared session
  and set schemas with their orphans go, after nothing called them. The "LLM never authors loads"
  evals now parse both live row writes, the ✓ (`rowWriteSchema`) and Change (`rowAmendSchema`);
  `numericSetSchema` keeps only `reps` (its `weight` field and `NUMBER_TOO_HIGH_MESSAGE` went with
  it); and the movement-name and note tests moved beside their rules in `packages/shared`. `V1-36` and `LEGACY-1` close; a tech-debt entry lists the columns
  nothing writes any more. Nothing changes for a person.
