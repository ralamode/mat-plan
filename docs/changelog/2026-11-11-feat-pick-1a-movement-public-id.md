- **2026-11-11** — **PICK-1 PR 2: the server accepts a movement's public id, and that id — never the
  client's label — decides which row an entry references**
  ([plan](../plans/pick-1-movement-picker.md)). CRUD-1 step 6b, the server half; no screen sends an
  id until PR 4, so there is no visible change. Movement resolution moved wholly into
  `packages/db/src/writers/movement-catalog.ts`, which is what makes the cross-household refusal
  **provable** rather than asserted — `db:verify` runs the same function the DAL does, over two
  households. Ids resolve before any typed name is created, so a body refused for a bad id commits
  nothing, not even a typed sibling in the same submission; and the seam is re-checked **inside** the
  transaction, where the rollback protects it. An unknown id and another household's id are
  byte-identical refusals that interpolate neither id nor name. The typed-name rules now apply only
  to a name a person typed: an id-resolved movement is never refused for a label the catalog supplied
  and the household cannot fix until `MOV-1`. Two deliberate changes — an emoji- or digit-only typed
  name is now refused, and "Enter a movement." became "Choose a movement." Three new mutation patches
  (`36`–`38`) prove the three new proofs can fail, and `32`–`35` finally got the README rows the
  directory's own procedure requires. A five-lens review across two passes found no defect in the
  code and fifteen in the record around it — including, in this PR's own first draft, a blank
  movement name earning two error messages and the availability predicate hand-composed at both
  sides of its own seam; all fixed, with the panel's verdicts in the plan's review-response log.
