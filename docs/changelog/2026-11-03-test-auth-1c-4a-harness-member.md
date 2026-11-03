- **2026-11-03** — **The e2e harness supplies a household MEMBER, not just a principal** (`AUTH-1`
  1c-4a, PR 1 of the [1c-4 plan](../plans/auth-1c-4-resolve-scope-from-session.md)). A no-op for
  production behaviour today, and the thing that stops `1c-4` breaking every gated spec: from that
  chunk the household scope is derived from the principal, and the harnesses' bypass id has no
  `household_members` row. **It lands first, green before and after, so the seam is reviewable on its
  own** — the argument 1c-1 and 1c-3a already won.
  🔴 **It reuses the committed `household-claim-2026-10-25` correction rather than a new writer, and
  the plan's first draft got this wrong.** That draft specified a new locality-gated script and
  called it _"idempotent via the existing partial unique"_. `insertHouseholdMember` refutes that in
  capitals — _"a collision here is an OPERATOR ERROR, not a replay"_ — so the second harness run
  would have been a `23505`. The correction is idempotent **by read-then-branch**, is dry-run by
  default, prints the target host, and is literally the writer `verify.ts` names when it asserts _"the
  seed writes NO household_members row"_. A second writer would have made that sentence's second
  clause false while keeping its first one true.
  🔴 **The guard reads the string the runner CONNECTS with.** The draft specified
  `isLocalDbHost(DATABASE_URL)`, but every `packages/db` script resolves
  `DATABASE_URL_UNPOOLED ?? DATABASE_URL` — so a local `DATABASE_URL` beside a production unpooled
  string would have **passed the guard and written to production**, and that is the environment the
  claim-correction runbook itself creates. Both now read one exported `correctionTargetUrl()`, which
  is the rule `db-environment.ts` states in its own header: _"A guard that inspects a different
  representation than the consumer is not a guard."_ The refusal is **narrow** — only the committed
  fixture principal, only against a non-local target; a real production claim is untouched.
  ⚠️ **NOT folded into `migrateAndSeed`, and that is load-bearing.** It has three callers and the
  third is `dev-local.ts` — `pnpm dev`, against the **persistent** cluster. The first `pnpm dev`
  would have succeeded and the **second** would have died on the correction's refusal, after the
  change shipped. `runbooks.md` gains the step a local dev session actually needs: link your own dev
  Clerk id, not the fixture.
  📌 **A vacuity hole closed on the way past.** vitest's `include` was `packages/*/src/**`, so a test
  under `packages/db/scripts/` ran **nowhere** — it would have shipped green without executing, the
  exact failure the neighbouring comment describes for `packages/**`. Widened to cover `scripts/`,
  and **proved**: the suite is 71 files without the glob and 72 with it.
  Guards, each proved RED: the correction command appears in **no workflow but `ci.yml`**
  (`migrate.yml` seeds production); `ci.yml`'s two literals **equal the committed constants**, since
  a workflow sits outside every `appSources()` sweep and that is how the bypass id came to drift;
  and `dev-local.ts` does not call the linker. Plus nine unit cases on the predicate, including the
  `?%68ost=` evasion from 1c-3a and the localhost-beside-production case.
  Also: the correction's own error message cited **README rule 3** for a claim rule 3 does not make
  (it is about `public_id` vs internal ids). Corrected to the rule that applies — a real Clerk id may
  never be committed to a public repo — and to note that the harness passes committed _fixtures_.
  🔴 **Reviewed, and the guard that is the whole point of this PR had no test that failed if it was
  deleted.** `target-url.test.ts` drove `fixtureBindIsAllowed` in isolation; nothing proved it was
  **wired into** the correction. Removing the `throw` from `registry.ts` left `pnpm verify` green.
  `db:verify` now carries branch **(6f)** asserting the composition, and the correction's branch count
  goes five → six. Proved RED: _"Missing expected rejection: AUTH-1 1c-4a: the fixture principal is
  refused against a non-local target."_
  ⚠️ **And the stated reason for excluding `pnpm dev` was false — in six places.** It said the second
  `pnpm dev` _"would die before `next dev` ever started"_. It would not: a second identical bind
  returns `already claimed by this Clerk account — no change` and exits 0, which `verify.ts` asserts
  by name (_"a re-run is an idempotent no-op, not a duplicate-key crash"_). The same docblock argued
  four lines earlier that the correction was **chosen because** it is idempotent. The decision stands
  on two true reasons instead: binding a committed fixture principal into a developer's long-lived
  sandbox is wrong on its own, and `dev-local.ts` injects no bypass principal, so the row is dead
  weight a real dev id can never use.
  📌 **Two more guards that could not fail.** The caller allowlist matched a **call**
  (`/linkFixtureMember\s*\(/`), which an aliased import walks straight through — the sibling guard
  records that exact evasion as probe-proven, and this file used the hardened bare-symbol form four
  lines below. And the prose assertion matched `/dev-local/`, which the module docblock has satisfied
  since long before this chunk, so deleting the entire rationale kept it green. Both anchored, both
  probed.
  Also: `ci.yml` cited a guard file that does not exist; the CI-literal assertion proved a correct
  copy **exists** rather than that a divergent second one does not (now counts, then matches, which
  is what the sibling was hardened to); `screenshot-ephemeral.ts`'s _"no scope-derivation pass to
  order against"_ was falsified by this diff and the ordering is now load-bearing (`--state
no-household` soft-deletes the household the link step needs); _"the full id is printed, and only
  locally"_ stopped being true when CI started running it into a public log; and the README rule
  citation was wrong **twice** — it is rule 9 (this repo is public), not 3 and not 6.
  The runbook's `pnpm dev` step now leads with the **dry run**, because `fixtureBindIsAllowed` does
  **not** cover a real dev id — the printed `target:` host is the only control there.
