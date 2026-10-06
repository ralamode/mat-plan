- **2026-10-06** — **The spec skill now carries the ways this repo has actually been wrong, and a
  handoff test.** `write-spec` gains a **derivation traps** table — eight failure classes, each drawn
  from a defect that happened here, each with the check that catches it: a stale docblock cited as
  code, a rule quoted without the section that scopes it, a plausible mechanism never run, a value
  proposed for a column whose FK rejects it, a composed value treated as one column, an index name read
  instead of its definition, a gate that cannot fail, and a log claiming a fix that never landed. The
  signature is always the same, and `docs/lessons.md` already records the phrasing — _"even though the
  parent obviously has one"_, _"against an index that plainly exists"_. Also adds the **handoff test**:
  a session with only the spec and its links must be able to execute the first chunk without asking a
  question, which is what "all-encompassing" means — closed over its dependencies, not longer. Net
  shorter than before (183 → 169 lines).
