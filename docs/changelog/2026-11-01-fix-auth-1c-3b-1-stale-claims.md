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
