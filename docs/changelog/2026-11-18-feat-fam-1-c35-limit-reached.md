- **2026-11-18** — **Programs get generous limits**
  ([guide](../features/program-contract.md), invariant 30; FAM-1 contract change C35). One family
  may make up to 500 of its own exercises, 50 workouts in a program, and 30 workouts on one day of
  a program's week. No family should come near these; they stop a bug or a runaway script from
  filling the database. A write past a limit is refused for that reason and no other. This PR
  adds the rule and the preview page's stand-in for it; the real saves, and what the screens say
  when a limit is reached, follow.
