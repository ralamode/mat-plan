- **2026-10-06** — **Work spanning several PRs gets an engineering spec before any of them gets a plan**
  (`.claude/skills/write-spec`). The lifecycle had an ADR for the model and a per-PR plan for each
  slice, and nothing between them saying what the whole thing builds or how anyone would know it works,
  so each plan re-decided a little of it. A spec lands at `docs/specs/<id>-<slug>.md` with acceptance
  criteria a test can fail, the data contract that lets a backend and frontend track split, and the
  chunk order with the constraint that fixes it. **The trigger is shared agreement, not size:** if
  several PRs share acceptance criteria, a contract, or an order that cannot move, they need one; if
  you cannot name what they have to agree on, they do not. Deliberately narrow — spec-driven
  development's recorded failure modes are markdown madness, diminishing returns on a mature codebase,
  and context blindness, and only the third has bitten here, so the skill's first section is a hard
  precondition to read the owning feature guides and existing plans before drafting.
