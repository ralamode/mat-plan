- **2026-11-06** — **WP-1's plan, re-panelled against a boundary that changed under it — and collapsed
  back to one PR** (`WP-1`, [plan](../plans/wp-1-shard-actions.md), plan only, no implementation).
  Drafted and panelled 2026-10-23, before `AUTH-1` 1b-bis/1c/1d and the `enterMutation` collapse
  (#323). **The central finding survives:** `write-path.md` owns `apps/web/lib/dal/` as a directory
  prefix and every new action needs a DAL function, so the action-adding steps serialize on that guide
  whatever happens to `actions.ts` — splitting it was never what unlocked parallelism.
  **Roughly half the proposed work had already shipped incidentally** and is cut rather than redone:
  the unified `enterMutation`, its session-before-limiter order assertion, the unauth matrix, a
  rate-limit matrix the plan never anticipated, the wrong-household suite, `serverActionModules()`,
  and `ALLOWLIST` already pinned empty.
  🔴 **A first pass split the remainder in two, and all five lenses rejected the seam.** The
  generalized cross-check had been put in the second PR — but `PROF-1` a-r registers
  `renameAthleteAction` while that function lives in `app/p/profile-actions.ts`, so the registry would
  carry 8 keys against `actions.ts`'s 7 exports and `actions.test.ts:1679`'s `toEqual` goes red. a-r
  needed **both** PRs, which is the opposite of the split's stated purpose; the security lens added
  that PROF-1's module could land in the gap covered by a source-text guard only. One PR, ~160 lines.
  **The registry becomes one discriminated union** rather than three lists: `{ refusal, scope }` or
  `{ excluded: { reason, provenBy } }`. So "a household-addressed action may never be excluded" stops
  being prose with nothing enforcing it and becomes a **type** error, the cross-check is plain
  equality with no second list to subtract, and `OUTSIDE_THE_MATRIX`, `server-action-lists.ts` and
  `guideOwns()` are cut entirely.
  ⚠️ **The plan's own corrections were most of the panel's findings, and two were mine.** It claimed
  the October probe "named the wrong `it`s" — wrong: that name belongs to this plan's own new test,
  and the existing one predates the plan by a day (#300, `git log -S`). It claimed `ID-1`'s six
  keep-open items were "answered in the review-response log" when the log held no such table — the
  precise failure that obligation exists to prevent, in the first plan written after the rule merged
  (#340). Both retracted in place; the six are now answered, including the correction that these
  matrices do **not** evidence item 2, because the household suite mocks the DAL.
  🔴 **The `mutation-entry.ts` move was going to widen a pinned regex to an alternation, which this
  repo's own invariant forbids** (`write-path.md:161`: _"one matching either passes on either and
  proves neither"_). It would also have opened a shadow — a local `mutation-entry.ts` shim satisfying
  `'./mutation-entry'` while the order assertion inspects only the canonical file. And "both depths"
  was already wrong: the spec puts V1-22's edit actions at a third. Resolved with one pinned alias,
  `@/app/p/mutation-entry`. The move also breaks `pages-need-a-session.test.ts:380` with ENOENT, which
  neither the October plan nor the first refresh listed.
  **Five places still pinned `app/gate/actions.ts` after the refresh "fixed" two** — a test-plan probe
  told the reader to add an export to a file 1d deleted, and an acceptance assertion required an
  intersection to equal it. Found independently by four lenses.
  ✅ **The guide obligations are CI-enforced as of [#341](https://github.com/ralamode/mat-plan/pull/341):**
  `guides:check` had been reading 3 of `write-path.md`'s 13 `owns:` entries, `mutation-entry.ts` and
  `mutating-actions.ts` among the ten unguarded. Found by this panel and fixed before implementation.
