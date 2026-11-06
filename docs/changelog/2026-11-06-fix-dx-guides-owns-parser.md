- **2026-11-06** — **`guides:check` was enforcing 3 of `write-path.md`'s 13 owned paths, and reporting
  OK** (`fix/dx-guides-owns-parser`). The frontmatter parser ended the `owns:` list at the first line
  that was not a `- item`, and a `#` comment is such a line. `write-path.md` carries four explanatory
  comments inside `owns:`, so the list was truncated at the third entry.
  🔴 **Ten paths were covered by neither rot check** — `mutation-entry.ts`, `mutating-actions.ts`,
  `packages/db/src/writers/`, `client.ts`, `scope.ts`, three `queries/`, `seed.ts` and
  `weekly-adherence.ts`. Touching any of them without updating the guide passed, and a stale entry
  pointing at a moved file would not have gone red either. **The guard printed "OK" throughout**,
  which is the worst failure mode a guard has: the rule was not wrong, it was not being applied, and
  it said nothing. The two other guides have no in-block comments and parsed fully (7/7 and 16/16),
  which is why nothing ever looked wrong.
  ⚠️ **The documented syntax was broken too.** `docs/features/README.md`'s Format section shows
  `- packages/db/src/writers/ # a trailing slash owns everything beneath`; the parser took the comment
  as part of the path, so rot check #1 would have failed on the comment text had anyone used it. Both
  forms now work: a whole-line comment is skipped without ending the block, and a trailing ` # …` is
  stripped from the item.
  **This was the only one of the guard self-tests' nine scripts with no self-test, which is why the
  bug survived.** `check-feature-guides.test.sh` ships with it — seven cases over a throwaway repo,
  wired into `guards:test` (now ten) and so into CI's `quality`. 🔴 **The comment cases were probed
  RED against the old parser:** case 3 ("an entry after a `#` comment is still owned") exited **0**,
  silently owning nothing, and case 5 failed for the _wrong_ reason, rot check #1 tripping on the
  comment text. The four baseline cases pass against both parsers, so the harness is not globally
  broken. ⚠️ Its first draft committed the fixture guide **on the branch**, which put it in the diff
  and made rot check #2 see the guide as touched — every case passed, including the baseline. Fixed by
  committing the fixture on `main`; the trap is recorded in the file's own comment.
  ✅ **No follow-up migration of the guides is owed:** all 13 of `write-path.md`'s entries exist today,
  so the newly-enforced rot check #1 is green on landing. What changes going forward is that a PR
  touching the other ten now owes the guide edit it always should have.
