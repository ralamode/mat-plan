- **2026-10-06** — **A real 2-mile run can be logged, and history stops reading as `30 in` (V1-30b-ii).**
  The stored-value ceiling was one shared number — `> 2000` on the set schema — which refused a real
  `3219 m` run and a `2400 sec` hold while letting a 2-mile run typed into **Inches** straight through.
  A set schema cannot judge a magnitude: `3219` is a real distance in metres and an absurd one in
  inches, and **only the unit tells them apart**. So the cap is now `MAX_QUANTITY_BY_UNIT` /
  `quantityCeiling` in `packages/shared/src/units.ts`, enforced once in the **session** refine, where
  the unit is known — in its own loop, because the mode refine above it `continue`s on mass units.
  Two details are load-bearing: `typeof set.weight === 'number'`, because the session refine still runs
  after a set's format check failed and then sees the raw string, which would stack "too high" onto
  "Enter a plain number" — **two messages for one fault**; and a unit with **no** declared cap being
  **refused** rather than read as "no cap", since `n > undefined` is false. ⚠️ Mutation testing showed
  that second branch is unreachable by construction and that the test claiming to prove it **passed for
  the wrong reason** (`count` is not a loggable unit, so the schema refuses it long before the ceiling
  runs). The comment now says so, and names the completeness test as the guard that actually holds —
  deleting one unit's cap kills two tests. Separately, history spells the five **length** codes with
  correct singulars (`20 metres`, `1 foot`, `30 inches`, `75 centimetres`) while `lb`, `kg`, `sec` and
  `min` stay codes, because that is how a lifter reads them. The CSV keeps its own spellings — those
  are contract bytes a downstream workflow diffs, and they are deliberately different.
