- **2026-10-06** — **A milestone gets an engineering spec before its PRs get plans**
  (`.claude/skills/spec-milestone`). The lifecycle had an ADR for the model and a per-PR plan for each
  slice, and nothing in between saying what a whole milestone builds or how anyone would know it works.
  The new skill writes `docs/milestones/<name>-spec.md`: acceptance criteria in EARS form so each one
  is checkable by a test, the data contract that lets a backend and frontend track split, and the chunk
  order with the constraint that fixes it. Deliberately narrow — spec-driven development's recorded
  failure modes are markdown madness, diminishing returns on a mature codebase, and context blindness,
  and only the third has actually bitten here. So the skill's first section is a hard precondition to
  read the owning feature guides and existing plans before drafting, and it adopts no `constitution.md`
  (that is AGENTS.md), no separate `tasks.md`, and no tooling.
