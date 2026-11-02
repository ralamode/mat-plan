- **2026-11-01** — **The claims `AUTH-1` 1c-3b falsified, and the eighth copy of the gate check.** A
  follow-up to [#323](https://github.com/ralamode/mat-plan/pull/323), from an architecture pass on its
  own fix commit. Every item is a committed statement about a control that the merged chunk made
  untrue — the same defect class 1c-3b spent a round fixing, in files it never touched.
  🔴 **Two modules documented themselves as dark while running live.** `lib/rate-limit.ts` said _"one
  seam, deliberately applied to one endpoint"_, _"the six mutating Server Actions are deliberately NOT
  limited yet"_, _"mutation limits land with Clerk at v1.5"_, and **Ships DARK** twice;
  `lib/dal/session.ts` said _"Nothing imports this module yet"_ while six call sites import it. Not
  cosmetic: `rate-limit.ts`'s docblock is what a future author reads before adding a limiter, and it
  told them the mutation path was unprotected — an unprotected surface and a protected one looking
  identical in the docs is the exact argument `mutation-entry.test.ts` makes for its own existence.
  Both now say what is live and what is still owed (the zip export, at `1c-4`), and **keep the reason
  the wait was right**: until a principal the caller could not choose existed, a mutation limit keyed
  on `formData.get('profileId')` would have constrained only the household.
  ⚠️ **The rationale list in `proxy.ts` now carries NO COUNT.** The number was wrong three times
  running — four claimed when zero were done, then five when it was seven, and that correction also
  swapped a true file name (`SIGN_IN_COPY`) for a false one (`GATE_COPY`). A list can be checked
  against the tree; a count invites being kept current by arithmetic.
  🔴 **The eighth copy of the gate check is gone.** `export/route.ts` hand-rolled `hasGateAccess()`'s
  exact body — `isValidGateCookie(cookies().get(GATE_COOKIE_NAME), env.…)` — since V1-13b, and
  `gate.ts`'s own docblock acknowledged it. 1c-3b added a second conjunct beside that copy without
  removing it, which is precisely what that chunk's argument is against; it was also the only reason
  the file read `process.env` at all. The handler guard **narrows with it**: the
  `isValidGateCookie|hasGateAccess` alternation existed only for that copy, so it now names the one
  helper, and a reintroduced raw cookie read fails CI. Proved RED.
  ⚠️ **One loop arm was described as fixed and is not.** 1c-3b's deletion closed the landing arm; the
  access-code arm survives **one form submit later**, because `submitGate`'s own `/` → `APP_HOME_PATH`
  substitution reproduces the hop. `proxy.ts` and `gate/actions.ts` now say so, and the sign-in
  escape-hatch note records what closing it would cost — reading the caller's gate cookie there
  retires the "reads no cookie" argument that justifies widening `isPublicPath` to a whole subtree.
  Also: `.github/SECURITY.md` recorded the `/api` matcher hole as both closed (top of file) and open
  (the `/api/sync` paragraph), and 1c-3b cited that file as its witness for "closed"; three copies of
  _"the gate is still the only boundary"_; `app/page.tsx`'s _"the one page served without the access
  gate"_ when there are four, which is how the `/sign-in` mix-up started; `gate.ts` dating its own
  replacement to v1.5 rather than `1d`; `tech-debt.md` contradicting itself eleven lines apart; and two
  vacuity gaps in `mutation-entry.test.ts` — a "no breadcrumb" assertion that any early refusal
  satisfied, and an unpinned severity. _(architecture lens on #323, 2026-11-01.)_
  🔴 **Three review rounds on this PR, and the sweep was short every time — worst in the files that
  brief the next session.** `.claude/agents/security-reviewer.md` and `.claude/skills/review-pr/SKILL.md`
  handed the stale claim to a reviewer **as fact**, citing a `tech-debt.md` entry that no longer
  exists; one of the review agents on this PR reported being briefed with it.
  `.claude/skills/review-pr/reporting-contract.md`, which every reviewer agent reads **first**, carried
  a second copy of the auth state that reached them before the corrected one. And
  `.claude/skills/add-server-action/SKILL.md` — aimed at the **author**, not the reviewer — still said
  _"no auth until Clerk (v1.5)"_, _"actions are deliberately unlimited"_ and _"nothing to test yet"_,
  which would walk someone straight into the CI failure the new guard produces.
  `docs/plans/ai-1-nl-logging.md`'s S8 is the one that was not history: an unbuilt endpoint whose
  security argument rested on the false premise.
  ⚠️ **No counts anywhere now.** [write-path.md](../features/write-path.md) carries **the one list**
  and everything else cites it. Two attempts at a count were both wrong, and `proxy.ts`'s own
  _"wrong three times running"_ was itself a count nobody can check against the tree — two lines above
  the rule banning them. A list can be checked; a count can only be re-derived.
  Also from the two lenses: `session.ts` quoted, as current, a sentence this very commit deleted from
  `rate-limit.ts`; the export handler's comment claimed it had read `process.env` when it imported the
  validated `@/lib/env` facade, a rule that would have sent a future author "fixing" six compliant
  files; `tenancy-is-not-cached.test.ts` said the export handler _"is dynamic only because it calls
  `cookies()`"_, which this commit made false by moving that read into `hasGateAccess()` — so
  `force-dynamic` is now the **only** in-file signal, and the route's docblock says so instead of
  calling it "the second reason"; `tech-debt.md`'s heading still read _"Mutating Server Actions are not
  rate-limited"_ above a body saying they are; `gate.ts`'s _"every Server Action"_ is refuted by its own
  new enumeration (the gate action is allowlisted by name); and the narrowed Route-Handler guard will
  trap `/api/sync` into re-duplicating the predicate, which is now **recorded in the guard itself** with
  the right way to widen it. _(security + correctness lenses, 2026-11-01.)_
