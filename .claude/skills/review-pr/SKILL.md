---
name: review-pr
description: Review a mat-plan pull request (or the current branch, or a whole area as a baseline audit) against the repo's own quality bar — correctness, code reuse/DRY and shared constants, a11y and 360px layout, CI health, AGENTS.md architecture and server/schema rules, docs that must ride with the change (status, feature guide, lessons, plan), test coverage, security on a public repo, and web performance. Produces P0/P1/P2 findings, each verified and cited to file:line and the rule it breaks, and can post them as a PR comment. Use whenever the user asks to "review PR <n>", "review this branch", "check this PR", "audit <area>", or comments "@claude review" on a PR.
---

# Review a PR

**Review as a Staff level reviewer who misses nothing.** Read every changed line, follow each change
into the code it touches, and verify each finding before reporting it.

**The review only runs when someone asks for it.** A person invokes it locally, or comments
`@claude review` on the PR. Nothing triggers it automatically. The bar it applies is
[AGENTS.md](../../../AGENTS.md) + [docs/definition-of-done.md](../../../docs/definition-of-done.md).
This skill is the rubric and the procedure, not a second copy of the rules.

## 0. Scope the target

| Asked for                 | Diff                                          | Context to load                                                    |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `review PR <n>`           | `gh pr diff <n>`                              | `gh pr view <n> --json title,body,files,labels,headRefName`        |
| `review this branch`      | `git diff $(git merge-base origin/main HEAD)` | the linked plan, the backlog row                                   |
| `audit <area>` (baseline) | none: review the files in the area            | its feature guide, [docs/tech-debt.md](../../../docs/tech-debt.md) |

For a PR, put it in a worktree so the scripts run against its code:
`git fetch origin pull/<n>/head:pr-<n> && git worktree add .claude/worktrees/pr-<n> pr-<n>`.
Remove the worktree when you're done.

**Size the effort.** Under ~150 changed lines, do a single pass. Larger PRs or a baseline audit:
fan out to the named agents in [`.claude/agents/`](../../agents/) in one message:
`correctness-reviewer` (dimensions 1, 4, 6), `simplicity-reviewer` (2, 3, 7, 8, 10),
`ux-reviewer` (5, for any `.tsx`), and `security-reviewer` (9, when anything is reachable
unauthenticated, or secrets or workflows change). The prompt only names the PR, the worktree and
the base, e.g. _"Review PR #171, worktree `<path>`, diff `git diff <base>...HEAD`."_ The agents
carry the rubric's reporting contract, so the verify step (4) still applies to what they return.

## 1. Check the change matches its description

Before the rubric, read the PR title, description and linked plan or backlog row, then the diff, and
compare the two. A PR that does something other than what it says gets reviewed against the wrong
intent, so settle this first.

- **Claimed but missing:** each change, test, doc update or gate the description claims is in the
  diff. A claimed test that doesn't exist is P0.
- **Present but unclaimed:** every change in the diff is described. An unmentioned file, behaviour
  change or scope creep beyond the backlog row is a finding (P1, or P0 if it touches data, auth, CI
  or a migration).
- **Right scope:** one concern per PR (AGENTS.md → "Git & branch workflow"). The title's type and
  scope match what changed.

## 2. Run the mechanical checks first

Their results are evidence, and they keep the review from re-deriving what a script already knows.

```bash
gh pr checks <n>                                        # CI health: which jobs ran, failed, were skipped
bash .claude/skills/hold-the-bar/check.sh origin/main   # in the PR worktree: suppressions, skipped/thinned tests, stubs
pnpm guides:check                                        # owned file touched without its guide
```

A red CI job is automatically a P0 finding. Use `debug-ci-failure` to find the cause. Don't re-run
`pnpm verify` unless CI didn't run.

## 3. The rubric

Check each dimension that applies. **Every finding needs `path:line`, the rule it breaks (an
AGENTS.md section, the DoD, lessons.md or a feature-guide invariant), and a concrete fix.** A finding
with no rule citation is taste. Mark it P2, or drop it.

1. **Correctness and data integrity.** Logic errors, edge cases, timezone/local-date (`localDayIso`),
   idempotency (client UUIDv7 + `onConflictDoNothing` with the partial-index predicate repeated),
   soft-delete filtering through live parents, and the **LLM-never-authors-loads** rule.
2. **Reuse / DRY.** Does the PR re-type a literal, enum, schema or helper that already exists?
   Check `packages/shared/src/*` (as-const + zod enums, `<verb><Noun>Schema` schemas),
   `apps/web/lib/constants.ts`, `apps/web/components/ui/*`, `lib/dal/*` and the writers in
   `packages/db/src/writers/`. The second occurrence of a meaningful literal is a finding (AGENTS.md →
   "Constants, enums & shared values"). Tests must use the same const as the app.
3. **Architecture rules** (AGENTS.md → "Architecture rules", "The don't list", "Server
   conventions"). Watch for: `'use client'` where RSC works, a `db` import or `process.env` read
   outside `lib/dal`, `sql.raw`/interpolated SQL, `dangerouslySetInnerHTML`, a raw row returned
   instead of a DTO, a non-async export from a `'use server'` file, a Server Action missing
   `withServerActionInstrumentation` or `revalidatePath`.
4. **Schema / migration** (if `packages/db` changed). Follow the `db-migration` skill's checklist:
   generated SQL committed, timeouts and statement-breakpoints, `squawk-ignore` directly above its
   statement, expand→contract, a `db:verify` proof for new constraints, seeds idempotent.
5. **A11y and responsive** (any `.tsx` change). Semantic element per job (button/a/label/ul, heading
   order), ≥44px targets (`MIN_TAP_TARGET_PX`, `Button`'s `min-h-11`), numeric `inputmode`,
   focus-visible, and **the width math at 360px** for any new row. Automated coverage is only axe
   A/AA + tap targets + 360px overflow on `/`, Today and the routine editor (`e2e/a11y.spec.ts`).
   Keyboard and focus are unchecked by anything, so the reviewer is the only check.
6. **Tests.** New logic has a colocated test. Actions have boundary tests (bad body → zod-reject,
   unknown profile → no write, wrong owner / stale id → typed error, replay → success with one
   effect). Threaded values are asserted with `toMatchObject` (lessons.md → Vitest). Schema changes
   have a `db:verify` proof. There's **no coverage tool**, so judge by reading: is each new branch
   exercised? Don't claim a percentage.
7. **Docs that ride with the change.** `docs/status.md` changelog/row, the feature guide (the gate
   only checks that it was touched, not that it's right; read the diff against its invariants),
   `docs/plan.md` row, the plan's review-response log, lessons.md if a failure took several attempts,
   `docs/architecture.md` + a Mermaid diagram for a pivotal flow or model change.
8. **Process obligations.** Is a plan owed (CI/migration/auth/subsystem/multi-file logic)? Did UI
   get a UX panel log and three-width screenshots? Is the title a lowercase Conventional Commit? Does
   the description claim a gate that isn't in `.github/workflows/`?
9. **Security** (the repo is **public**). No secret or real personal data in code, fixtures or
   screenshots. Ownership is **existence-only** today (no Clerk until v1.5), so anything that widens
   what an unauthenticated caller can reach is at least P1. `/api/*` sits outside the gate matcher
   (tech-debt.md). New workflow steps must not expose secrets to fork PRs.
10. **Performance / CWV.** Nothing measures the budget (LCP < 2.5s, INP < 200ms, CLS < 0.1), so look
    for the causes: client JS where RSC works, unbounded queries on a hot path (`profile_id, date`),
    layout shift from late content, images without `next/image`.

**Don't re-flag accepted debt.** Check [docs/tech-debt.md](../../../docs/tech-debt.md) first. A known
item is a finding only if this PR makes it worse.

## 4. Severity

| Level  | Means                                                                                                         | Examples                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **P0** | Must fix before merge: wrong data, security exposure, a red or bypassed gate, or a hard AGENTS.md rule broken | double-write on retry; `db` outside the DAL; an edited applied migration; red CI  |
| **P1** | Should fix in this PR, since it's cheap now and expensive later                                               | duplicated constant; missing boundary test; status.md not updated; 360px overflow |
| **P2** | Follow-up or nit; file it rather than block                                                                   | naming, a clearer comment, a test that could be tighter                           |

## 5. Verify before reporting

For every P0 and P1, re-open the cited code and try to **disprove** the finding. Is it handled
elsewhere? Is it accepted debt? Does the test already cover it? Drop what doesn't survive. A short,
correct list beats a long, noisy one, and a false P0 costs the author an afternoon.

- **When reviewers disagree on a fact, run it instead of re-reading.** On #171, two lenses gave
  different answers to "which units does the server accept". A 10-line throwaway vitest probe
  against the shared schema settled it in one run, and turned up a P0. Put the probe in the
  scratchpad and copy it in only to run it; never commit it.
- **Severity is about the risk today.** A defect that only fires on data that doesn't exist yet
  (a catalog value nobody has seeded) is P2 with a note saying what would make it live.
- **Report what the diff exposed, even if it predates the diff**, under its own heading ("found
  outside the diff"), with the PR that introduced it (`git log -S`). Don't charge it to this PR.

## 6. Report

Locally, print the report. If asked to post it, or when triggered by an `@claude review` comment,
post it with `gh pr comment <n> --body-file <scratchpad>/review.md`:

```markdown
## Review — <title> (#<n>)

**Verdict:** <ready to merge | fix P0s first | needs rework> · P0 <x> · P1 <y> · P2 <z>
**Matches description:** <yes | gaps: …>
**Checks:** CI <green/red: job> · hold-the-bar <clean/findings> · guides <ok/fail>

### P0 — must fix before merge

1. **<one-line claim>** — `path:line`
   <evidence: what happens, with the input that triggers it>
   **Rule:** <AGENTS.md § / DoD box / lessons entry> · **Fix:** <concrete change>

### P1 — should fix in this PR

### P2 — follow-ups

### Found outside the diff (pre-existing; introduced by #<m>)

<details><summary>What was checked</summary>dimensions reviewed · dimensions N/A and why</details>
```

Keep findings in severity order. No praise section. If there are no findings, say so in one line
and list what was checked.

## 7. Fix mode (on request)

"Fix the P0s" means: check out the PR branch, fix each P0 as its own commit (`fix(<scope>): …`),
re-run `pnpm verify`, and reply on the PR with what each commit addressed. P1s only when asked. For
a **baseline audit**, P0s become backlog rows or a single `fix/` PR, one concern each (use
`start-task`).

## Red flags

- Starting the rubric before checking that the diff matches the description.
- A finding without `path:line` or without a rule, especially at P0.
- Flagging something listed in `docs/tech-debt.md` as new.
- Claiming coverage numbers, CWV measurements or a CI gate that doesn't exist.
- A review longer than the diff for a small PR. Tighten it.
- Posting to the PR when the user only asked to see the review.
