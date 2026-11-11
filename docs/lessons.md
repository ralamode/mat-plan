# Lessons log — recurring gotchas & their fixes

A terse, **scannable** record of failures that cost more than one attempt to diagnose, so the next
person (or agent) fixes them in one. Read this **before** debugging a CI / test / build failure —
grep for the symptom. Keep entries to 1–3 lines: **Symptom → Cause → Fix**. Newest on top within a
section. This is a debugging index, not prose — link out to a plan/ADR for depth.

## Database / migrations

- **A migration adding a table with a COMPOSITE foreign key aborts with `there is no unique constraint
matching given keys for referenced table "<parent>"`, even though the parent obviously has one.** →
  `drizzle-kit generate` emits statements in a fixed order — `CREATE TABLE` → `ADD CONSTRAINT … FOREIGN
KEY` → `CREATE INDEX` — so a parent whose composite key is declared as `uniqueIndex()` gets that index
  created **after** the child FK that references it, and the whole file is one transaction. →
  **Declare the parent's composite key as a `primaryKey()` (or `unique()`) constraint, not a
  `uniqueIndex()`** — drizzle inlines a constraint into `CREATE TABLE`, so the target exists before any
  FK. Reordering the SQL by hand also works but re-breaks on the next `generate`. (migration 0011)

- **`ON CONFLICT (a, b) DO UPDATE` fails with `there is no unique or exclusion constraint matching the
ON CONFLICT specification`, against an index that plainly exists.** → The index is **partial**
  (`WHERE deleted_at IS NULL`, this repo's soft-delete idiom). A partial index only arbitrates when the
  statement repeats its predicate. → Add the predicate: `ON CONFLICT (a, b) WHERE deleted_at IS NULL`,
  or drizzle's `onConflictDoUpdate({ target: [...], targetWhere: isNull(t.deletedAt) })`.
  ⚠️ **`onConflictDoNothing` reads `where`, NOT `targetWhere`** — the other half of the same lesson,
  and the form above is the one that does **not** work there. Verified in `drizzle-orm@0.45.3`'s
  source: `onConflictDoNothing` builds its clause from `config.where` and **silently drops**
  `targetWhere`, so the predicate vanishes, the partial index cannot be inferred, and you get the same
  `42P10` message with no sign of why. → `onConflictDoNothing({ target: [...], where: isNull(t.deletedAt) })`.
  The predicate must also render as a **literal**, never a bound `$1`. (found TEN-2a, 2026-10-09;
  TEN-2b is the first consumer)

- **`ON CONFLICT (slug) WHERE household_id IS NULL DO NOTHING` reports success while inserting
  NOTHING, and no error is raised anywhere.** → Postgres infers **every** arbiter the clause could
  match, not just the partial one you named: a **non-partial** `UNIQUE (slug)` has an _empty_
  predicate, which is trivially implied by `WHERE household_id IS NULL`, so a collision with the
  non-partial constraint is absorbed by the same `DO NOTHING`. The row you meant to add is simply
  absent — `db:seed` is green, seed-twice idempotency is green, and nothing reports it. → While a
  broad constraint and a narrow partial index coexist on one column (an expand→contract window),
  **detect the shadowing case explicitly and refuse**; do not rely on the arbiter to tell you. The
  one place this can be observed is a committed assertion that the row IS there.
  (found TEN-2b, 2026-10-10; `packages/db/src/seed.ts` → the shadow guard, and `db:verify` →
  _"TEN-2b SHADOW GUARD"_ which asserts the silent baseline, not just the refusal)

- **A `db:verify` assertion about resolution ORDER can be un-failable, and the mutation that proves
  it passes.** → TEN-2b's resolver is global-first; the state that distinguishes global-first from
  household-first is _a global row and a household row sharing a slug_, which is exactly what the
  still-live non-partial `UNIQUE (slug)` forbids. Measured: both orders returned the same id by the
  same path and burned the same identity-sequence values, so an assertion outside a transaction that
  drops the constraint would have passed **under the very mutation it named**. → Assert such an order
  inside a rolled-back `ALTER TABLE … DROP CONSTRAINT` transaction and label it for what it is ("the
  resolver under the next PR's schema"). Related: **"no insert was attempted" cannot be asserted on a
  row count** — an absorbed `ON CONFLICT` leaves the count unchanged too; assert on
  `<table>_id_seq.last_value`, because an absorbed insert **burns** an identity value and a `SELECT`
  does not. (found TEN-2b's panel, 2026-10-10)

- ⚠️ **Correction to [TEN-2a's plan](./plans/ten-2a-household-movements.md), kept here because plans
  are immutable once merged.** Its §"The index behaviour, measured" lists
  `on conflict (slug) do nothing => OK (infers the non-partial)` **underneath the
  `after ALTER TABLE … DROP CONSTRAINT` heading**. Post-drop it is **`42P10`** (re-measured at
  TEN-2b): with the non-partial constraint gone, a bare target cannot infer a partial index. Harmless
  to 2a's conclusion — it _strengthens_ the refusal to drop the constraint early — but a future author
  citing 2a as the spec could read it as "the drop is safe for already-deployed code", which is the
  one mistake that breaks every free-text movement write in production.

- **`drizzle-kit generate` hangs or dies with `Interactive prompts require a TTY terminal` when a
  migration both ADDS and DROPS columns on one table.** → Drizzle asks whether the drop+add is a
  _rename_, and the prompt needs a TTY an agent/CI shell doesn't have. → **Generate in two passes** —
  first the additive schema (no prompt), then the removals (no prompt) — then concatenate the two `.sql`
  files into one, delete the second file + its snapshot, drop its `_journal.json` entry, and promote the
  SECOND snapshot to the first's filename (it is the true final state). ⚠️ **Then FIX ITS `prevId`** —
  promoting the snapshot keeps the second's `prevId`, and overwriting its `id` with the first's makes
  `prevId === id`, a self-referential link. `generate` reports `No schema changes` even so, because it
  only walks the chain when appending, so the break stays latent until the NEXT migration fails with
  `are pointing to a parent snapshot … which is a collision`. Set `prevId` to the id of the snapshot
  BEFORE it. (migration 0011 shipped this bug in #139; found while generating 0012, repaired in #147.)
  → **Now CI-enforced**: the forward-only guard checks the whole chain on every PR, so this cannot
  recur. If you hit the collision error, the guard's output names the file and the expected id.

- **`pnpm typecheck` is green while `packages/**` is broken.** → It was `pnpm --filter web exec tsc
--noEmit`, and `apps/web/tsconfig.json` was the repo's ONLY tsconfig, with an `include` relative to
  `apps/web`. `packages/db/scripts/` — `verify.ts`, `migrate.ts`, `seed.ts`, `corrections/` — is
  reachable from no app import, so it was typechecked by **nothing**, and `tsx` strips types without
  checking them: a stale column reference surfaced only as a runtime crash in `db:verify`. →
  **Fixed in DX-7**: `packages/db/tsconfig.json` exists and `pnpm typecheck` runs both projects
  (`pnpm --filter web typecheck && pnpm --filter @mat-plan/db typecheck`), so this is a compile error
  now. It found 12 real ones on the first run. ⚠️ **Still true for `packages/shared` and
  `packages/engine`**: they have no tsconfig and are checked only _transitively_ through the app's
  imports, so a file nothing imports is checked by nothing. Linting still stops at `apps/web`
  entirely. Keep running `pnpm verify` before believing a package-level refactor is done.

- **A `-- squawk-ignore <rule>` comment has NO effect and Squawk still fails the build.** → The ignore
  must be the line **immediately above** the statement. Any other comment between them silently voids it
  — there is no warning, the rule just still fires, and the natural instinct (write the justification
  first, then the ignore) is exactly the broken order. Verified: ignore + one comment + statement = rule
  fires; comment + ignore + statement = suppressed. → **Put the reasoning above, the `squawk-ignore`
  last, touching the statement.** (migration 0010)
  → **The subtle way to trip it: `--> statement-breakpoint` is itself a `--` comment.** On its own line
  between the ignore and the statement it voids the ignore and the rule fires again. Keep it a TRAILING
  token on the preceding statement's line (the `0009`/`0012` style). Found by _running_
  `squawk-cli@2.66.0` against a candidate file — the only way to tell a suppressed rule from a rule
  that never fired. (V1-22 chunk 1 panel)

- **`drizzle-kit generate` emits `ADD COLUMN … NOT NULL` with no default, which FAILS on a populated
  table.** → Drizzle writes the column as the schema declares it and does not know the table has rows.
  Postgres rejects it: an existing row would have no value. → This repo **hand-edits generated SQL**
  (all 10 prior migrations do), so split it: `ADD COLUMN` nullable → `UPDATE` backfill → `SET NOT NULL`.
  Check every generated migration for this before committing — the generator is a starting point, not an
  artifact. (migration 0010)

- **`cannot insert multiple commands into a prepared statement` when a migration runs.** → Two
  statements share one chunk because only the last carries `--> statement-breakpoint`. Easy to hit with
  the `SET lock_timeout` / `SET statement_timeout` pair. → **Every** statement needs its own
  `--> statement-breakpoint`, including each `SET`. (migration 0010)

## GitHub / PRs

- **A skip label was added, the job was re-run, and the label was ignored.** → A re-run **replays the
  original event payload**, so `github.event.pull_request.labels` is frozen at the moment the run was
  triggered. PR #67: `ci-skip-e2e` added at 08:16:17Z, re-run attempt 3 at 08:16:41Z still ran the
  smoke; the next push skipped it. Every label check in `ci.yml` reads the payload. → **After adding a
  label, push** (an empty commit is fine). Found by DX-5(b)'s panel before its own label shipped
  ([plan](./plans/dx-5b-local-gates-in-ci.md)).

- **A stacked PR reports `MERGED` and its code is nowhere on `main`.** → GitHub merges a PR into
  whatever its **base** is, and a stacked PR's base is the parent's branch. Merge the parent first and
  the child's merge lands on a branch nothing will ever ship — `gh pr view <n> --json baseRefName` says
  `db/<parent>`, not `main`, while the UI says merged either way. GitHub retargets an open PR only when
  its base branch is **deleted**, so delete-on-merge is a race, not a guarantee (TEN-2a #273 squashed at
  `14:21:03`; TEN-2b #274 merged into #273's branch at `14:21:09`, six seconds later). → **Retarget the
  child before merging the parent** (`gh pr edit <n> --base main`), and after merging any stack verify
  the **content** on `main` — `git ls-tree origin/main <path>` or a `git grep origin/main` for a symbol
  the child added — never the `MERGED` label. ⚠️ **Recovery is a cherry-pick, not a merge:** `main`'s
  copy of the parent is a **squash**, a different commit than the branch's, so merging `main` into the
  orphaned branch re-applies the parent's change and conflicts on every file it touched (nine, here).
  `git checkout -b <new> origin/main && git cherry-pick <child-squash>` carries the child's diff alone —
  zero conflicts, here. (TEN-2b, relanded as #275, 2026-10-11)

- **A Mermaid diagram in a PR description fails with `Lexical error on line 2. Unrecognized text`,
  pointing at the first node label.** → **Backticks inside a node label.** Mermaid reads `` ` `` as its
  markdown-string delimiter, so the natural instinct of code-formatting a column or file name —
  ``L["`load` — ONE text column"]`` — breaks the lexer before the diagram parses. The error names the
  line but not the character, so it reads like a syntax problem with the arrow or the quotes. → **Never
  put backticks in a Mermaid label**; write the identifier bare (`L["load — ONE text column"]`). Note
  GitHub renders the failure as a pink "Unable to render rich display" box with the raw source below it,
  which is easy to miss if you post a PR and don't look at it. `<br/>`, `·`, `+`, `/` and parentheses
  inside a quoted label are all fine — backticks are the trap. (docs/gap3-csv-samples, PR #121)

- **A red "Build Failed" on Vercel for a branch that contains no app — `The specified Root Directory
"apps/web" does not exist`.** → Vercel builds **every pushed branch** by default, and the
  `screenshots` branch is a true orphan holding only `README.md` + `pr-<n>/*.png`. So every screenshot
  upload and every prune posted a failed preview deployment that means nothing — and looks, at a
  glance, exactly like a real build break on your PR. **Check the deployment's Source branch/commit
  before debugging: if it says `screenshots`, it is not your PR.** → The first fix (#100) appended
  `[skip ci]` to every commit on that branch, on the belief that Vercel honours it. **It does not** —
  Vercel skips only via `git.deploymentEnabled` or the Ignored Build Step, and the failures and
  emails continued for two months behind a lessons entry saying they were fixed. The real fix
  (fix/dx-skip-vercel-screenshots-branch): `apps/web/vercel.json` with
  `{"git":{"deploymentEnabled":false}}` **on the `screenshots` branch itself** —
  `VERCEL_OPT_OUT` in `apps/web/scripts/publish-screenshots.ts`, which seeds it on a new branch and
  heals a branch missing it before every upload. Vercel reads config from the Root Directory of the
  _pushed commit_, so an opt-out on `main` never sees these pushes, and the Ignored Build Step can't
  help either — it runs inside the Root Directory, after the check that fails. `[skip ci]` stays, but
  only because it keeps GitHub Actions off the branch. **General rule: a "fixed" CI/deploy lesson
  needs evidence from the NEXT real event (the next push's deployment status), not the fix's own
  PR.**

- **Writing the skip-CI marker literally in a COMMIT MESSAGE skips that commit's own CI.** → GitHub
  substring-matches the **head commit message**, anywhere in it — body included, backticks and
  all. So a commit message that merely _describes_ adding the marker can suppress its own checks, and a
  **squash-merge** carries that body onto `main`, where it can skip `migrate.yml` — a schema change
  deploying without its migration. → **Spell it out in prose** ("the standard skip-CI marker") in any
  commit message that talks _about_ it; keep the literal form in code/config only. **Not** a diagnosed
  incident here — this is a documented mechanism and a cheap precaution. Note the tell is a PR with
  **zero** Actions runs (checks never appear) rather than a failing one, which is easy to confuse with
  a transient Actions queue delay; distinguish them with
  `gh api "repos/<o>/<r>/actions/runs?head_sha=<sha>" --jq .total_count` on the OLD sha — a delay
  eventually produces a run for that sha, a skip never does.
  (chore/skip-vercel-on-screenshots-branch)

- **Screenshots never actually reached any PR for months — `gh` has no image-upload path, and the
  obvious workarounds all fail on a PRIVATE repo.** → Verified in a real logged-in browser by reading
  `img.naturalWidth` (the only proof that pixels loaded, rather than that markdown looked right):
  `github.com/<o>/<r>/raw/<branch>/<path>` **renders**; `raw.githubusercontent.com/...` is **broken**
  (needs an `Authorization` header a browser never sends); base64 `data:` URIs are **stripped**
  server-side, leaving an `<img>` with an empty `src` — and a comment caps at 65,536 chars, so one
  176KB screenshot (~235KB base64) is 3.6x over regardless. GitHub does **not** camo-proxy these, so
  the rendered HTML keeps the original `src` and everything _looks_ correct until you view it.
  **On a PUBLIC repo all forms work**, which is exactly why the trap is invisible. There is also no
  official upload API (`repos/:o/:r/assets` → 404; the web UI's endpoint needs a session cookie + CSRF,
  422 for a PAT). → Use `pnpm --filter web screenshots:publish`. (chore/screenshot-publishing)

- **`GH_TOKEN` in the local env shadows the keyring credential and silently loses scopes.** → `gh run
view`, `gh pr checks` and the Actions API all returned `403 Resource not accessible by personal
access token`, which reads like a permissions problem with the repo. The cause was a fine-grained PAT
  in `GH_TOKEN` taking precedence over a keyring token that HAS `repo`+`workflow`. → `env -u GH_TOKEN
-u GITHUB_TOKEN gh ...` restores the good credential; check `gh auth status` for BOTH entries when a
  403 appears. (V1-14a)

## E2E / Playwright

- **The browser cache was there, and the step it protected still reached the network on every
  run.** → `Install Chromium` ran `playwright install --with-deps chromium`. The `--with-deps` half
  shells out to `apt-get`, which is **not** what `~/.cache/ms-playwright` caches — so a cache hit
  saved the CDN download and left the Ubuntu-mirror call in place, on every job. It failed four runs
  in a row on `Temporary failure resolving 'archive.ubuntu.com'` — a class of runner flakiness
  refiled across years (actions/runner-images #675, #7048 and #10785 each closed once the mirror
  recovered; #14823 is open), not one outage. → **Drop
  `--with-deps`:** the runner image preinstalls Google Chrome, Edge and ChromeDriver, so all 21 of
  Chromium's shared libraries — and the Latin text stack, and `xvfb` — are already there; the same
  log shows apt adding only Japanese, Chinese, Thai, Cyrillic and unifont font packages this app
  never renders. ⚠️ **Read the WHOLE apt block before claiming a no-op:** a first pass through this
  log was truncated at 25 lines and concluded "installs nothing", which the `9 newly installed`
  line four rows further down contradicts. The general rule: **a cache in front of a step proves nothing about
  the step — read what the cached path actually contains**, and if a step has two halves with
  different failure modes, the uncacheable half is the one that decides your reliability.

- **A strict-mode violation inside a `try { … } catch {}` cleanup is invisible, and `count()` is the
  thing that lures you into one.** → `athletes.spec.ts`'s `afterEach` archived fixtures with
  `if (await control.count()) await control.click()`. Correct until `PROF-1 a-1d` made **two athletes
  under one name** a real fixture: `count()` is then `2` and truthy, `click()` throws Playwright's
  strict-mode violation, and the `catch` swallows it — so the cleanup archived **neither**, on every
  run and every retry, while reporting nothing. **Symptom:** fixtures accumulating in a seeded
  database with a green suite. **Fix:** a cleanup that cannot report its own failure must be correct
  by construction — loop over `.first()`, never assume one match.
- **Re-querying a locator straight after a Server Action click gives you a DETACHING element, and
  `click()` then retries it for the whole action timeout.** → the first fix for the above looped and
  waited on the Undo button, which is _already_ visible from the previous archive, so the wait was
  satisfied instantly and the next pass clicked a row mid-removal. Three passes × a 30s action
  timeout exhausted the hook. **Fix:** wait on the thing that actually changes —
  `await expect(locator).toHaveCount(remaining - 1, { timeout: … })` is both the "the action landed"
  signal and the loop's termination condition. ⚠️ And a hook doing real work needs its own budget:
  `test.setTimeout()` **inside** the hook, or cleanup fails a test that passed.
- **To test an UNHYDRATED page, block the chunks — never `javaScriptEnabled: false`.** → A
  JS-disabled context cannot be driven at all, and it fails by **lying rather than erroring**:
  `page.url()` answered `/p/new` while `locator.count()` returned `0` and `innerText()` a
  32-character body, because both go through Playwright's injected script, which such a context
  cannot execute either. You cannot tell "the page rendered nothing" from "the harness cannot see the
  page", and an assertion written against it reads as a product bug. **Instead:**
  `await page.route('**/_next/static/chunks/**', (r) => r.abort())` — the harness keeps working, the
  page stays SSR-only, and the submit is a native POST. That swap turned a dead end into a
  measurement in one run. ⚠️ **And the measurement was worth having:** `/p/new`'s unhydrated POST is
  refused by Next (`Invalid Server Actions request`), which **withdrew the justification for a fix
  that had already shipped in that PR** — it restored form state for a render that cannot happen.
  [tech-debt.md](./tech-debt.md) has it. **The general shape: a cheap probe that could falsify your
  own fix is worth running BEFORE you defend the fix in a docblock, not after.**
- **`screenshot:ephemeral` REUSES `.next`, so a capture taken after a UI edit can silently show the
  OLD screen.** → `apps/web/scripts/screenshot-ephemeral.ts:942` only runs `next build` when
  `.next/BUILD_ID` is **absent**; `--build` forces it. The symptom is the worst kind: the script
  succeeds, writes three PNGs, and they are **byte-identical to the previous run** — so the edit looks
  like it did nothing, and the obvious next move is to go and "fix" code that was already correct.
  Deleting `.screenshots/` does not help; it is `.next` that is stale. **Fix:** pass `--build` on any
  capture taken after the first one in a session (`pnpm --filter web screenshot:ephemeral <route>
--build`). Found on a UI change that was later parked (#303): the first capture showed the new
  control, the second — taken after restyling it — showed the UNSTYLED version, which read as "my
  change did not apply" and sent me to re-edit code that was already correct. _(2026-10-22.)_

- **A Playwright `addInitScript` silently does nothing from one line onward, and the symptom is a
  later assertion reading `null` ("the theme never applied at all").** → The script runs at
  **document-start**, where `document.documentElement` can still be null, so
  `new MutationObserver(...).observe(document.documentElement, …)` **throws** — and everything after
  it in the same init script never runs, with no error surfaced to the test. Anything registered
  _before_ the throw (a `document.addEventListener`) keeps working, which makes it look like the
  script ran fine. → **Observe `document` with `{ subtree: true }` and filter on
  `r.target === document.documentElement`**, or wrap each step in its own try/catch. (UI-4)

- **`locator.check()` times out on a radio/checkbox that is plainly on screen.** → The input is
  `sr-only`, so Playwright's actionability check hit-tests its 1px centre point, finds the label text
  over it, and waits forever for the "element intercepts pointer events" condition to clear. → **Click
  the `<label>`** (`page.locator('label').filter({ has: radio }).click()`) — which is what a thumb
  does and what the browser treats as activating the control. Same trap `e2e/a11y.spec.ts` already
  records for the BW/band chips. (UI-4)

- **An "assert zero `securitypolicyviolation` events" test fails on a page with no inline-script
  problem at all: `script-src eval` from `_next/static/chunks/*`.** → **zod v4 probes for JIT support
  with `try { Function(""); return true } catch { return false }`.** Under this app's production CSP
  (no `unsafe-eval`) that raises a violation _report_ on every page load; zod catches the exception
  and falls back to its non-JIT parsers, so nothing is broken. → Assert on the violations that mean
  something — a missing nonce reports **`blockedURI: 'inline'`** — and print the full list in the
  failure message. `zod.config({ jitless: true })` would silence the report, if the noise ever
  matters. (UI-4)

- **`screenshot:ephemeral` reuses `.next`, so you can screenshot your UI change and get a picture of
  `main`.** → The script only builds when `.next/BUILD_ID` is absent (or `--build` is passed), so with a
  warm build the capture silently shows the PREVIOUS UI. Nothing errors — the shot just looks subtly
  wrong, and the failure mode is attaching it to a PR as evidence for a change it does not contain. The
  tell: the new control you added isn't in the image. → **Always pass `--build` when capturing a change
  you just made**; the reuse is only safe for re-shooting an unchanged screen. (GAP-1 P1-1c)

- **`getByLabel('Movement')` is a strict-mode violation waiting to happen — it is substring +
  case-insensitive.** → A bare `'Movement'` also matched `aria-label="Select movement 1 for a superset"`
  and `"Movement 1 set 1 reps"`. Same root cause as the `getByLabel`/`getByText` entry under Vitest/RTL
  below, but it bites in Playwright too, including in **screenshot interaction hooks**, where the failure
  surfaces as a capture that never happens rather than a red test. → `{ exact: true }`, or scope to the
  region. (GAP-1 P1-1c)

- **An assertion on a form's own label is a FALSE POSITIVE — it goes green while nothing was
  written.** → `getByText('Rice bucket', { exact: true })` matched the check-in `<label>` inside the
  form, not only the logged-entry list. The write assertion "passed", the run then failed one line
  later on a different string, and the diagnosis went to the wrong place entirely. → **Scope
  post-write assertions to the entries region** (`getByRole('region', { name: 'Logged entries' })`),
  never the whole page, whenever the form and the list share vocabulary. (V1-5)
- **A post-submit `toBeVisible()` raced an in-flight Server Action** — the failure snapshot showed
  `button "Logging…" [disabled]` with the entries list not yet revalidated. → **Synchronize on the
  submit button returning from its pending label** (`await expect(submit).toBeEnabled({ timeout:
15_000 })`) before asserting on the list. Note this is a real **sync point**, not padding a timeout
  to hide a race — the V0-11 lesson below still stands. The cold path is already warmed in
  `global.setup`; this action is genuinely heavier (several catalog reads + a multi-row insert + a
  full RSC revalidation) than the single-row bodyweight write the default 5s was tuned for. (V1-5)
- **Read `error-context.md` in the Playwright artifact FIRST** (`gh run download <run-id>`) — the
  page snapshot names the true state in one look (a disabled "Logging…" button, which element was
  `readonly`), instead of inferring it from the assertion text. (V1-5)
- **A Playwright RETRY reuses the same ephemeral DB, so "already logged" UI breaks the rerun.** →
  Attempt 1 logged the row; the retry found the control `readonly`/`aria-disabled` **by design** and
  timed out in `fill()`, looking like a fresh bug rather than leftover state. → Make writing steps
  **retry-safe**: check `isEditable()` and, when the state is already there, skip the write and
  assert the end state. (V1-5)
- **Today's render is now WEEKDAY-DEPENDENT, so CI sees a different page on a Monday than on a
  Thursday.** → V1-10 slice 2 renders the "Today's program" card only when the local weekday maps to a
  `day_role` (Mon/Wed/Fri). Nothing in the current suite collides with it — every step locates by
  ROLE + ACCESSIBLE NAME (`getByRole('region', { name: 'Check-ins' })`), which is immune to a new
  sibling section appearing above the strength form. → Keep it that way: **never locate an e2e element
  by position, nth-match, or section ORDER on Today**, or the suite will pass Tue/Thu and fail Mon/Wed/Fri
  — a failure that reproduces only two days in three and looks like flake. If a test ever needs the card
  present or absent deterministically, pin the browser zone (`timezoneId`) so the local weekday is
  chosen, the same lever `screenshot --tz` uses. (V1-10)

- **`notFound()` route returns HTTP 200, not 404, so `expect(res.status()).toBe(404)` fails.** → The
  app is `force-dynamic` (nonce CSP), so Next **streams the 200 header before the RSC throws
  `notFound()`** — the not-found UI renders but the status is already 200. → Assert the rendered
  not-found **content** (`getByText(/this page could not be found/i)`), not the HTTP status. (V1-3)

- **UNRESOLVED: a form submit is silently lost (the "check-ins flake").** Full dossier —
  timeline, evidence, killed hypotheses, and the next experiment — in
  **[docs/bugs/e2e-lost-form-submit.md](./bugs/e2e-lost-form-submit.md)**. Short version: the click
  produces **no server request, no row, no error**; server timings are 1–26ms, so it is NOT a
  performance problem. Killed: the Sentry wrapper, per-action cold start, worker contention, the setup
  timeout, and click-before-hydration. **Do not pad timeouts or add warm-ups** — both were tried and one
  made it worse. First seen 2026-07-24; 12+ CI occurrences. (V1-14a → ongoing)

- **Playwright's default TEST timeout (30s) applies to `global.setup` too — and a warm-up step can blow
  it.** → `global.setup` did gate login + a cold bodyweight write with a 30s _assertion_ timeout inside
  a 30s _test_ timeout. Zero headroom: on a slow runner the setup itself times out, the warming silently
  never happens, and the cold cost lands in the coverage test — the exact thing the setup exists to
  prevent. Adding a second warm-up made it fail outright. → **`setup.setTimeout()` explicitly whenever
  the setup does real work**, well above the sum of its own assertion timeouts. (V1-14a)

- **Attribute a flake before "fixing" it — stash your branch and re-run without your changes.** → This
  surfaced during V1-14a (which wraps every action in Sentry), so the wrapper was the obvious suspect.
  Running the same spec with and without the branch's changes, 3 runs each, gave identical results and
  killed that theory in minutes. Also: read the numbers carefully — "1 failed, 4 passed" is one TEST of
  five, not one RUN in five. Misreading that turned into an overstated claim in a PR description. (V1-14a)

- **Test "flaky" (fails attempt 1, passes on retry) after a form submit.** → The _first_ Server Action
  after a cold `next start` pays JIT + first-DB-connection cost, exceeding the assertion timeout; the
  warm retry passes, masking the race. → **Warm the cold path once in `global.setup`** (submit one
  throwaway record) so the coverage test runs warm under the **default** timeout. Do NOT pad the
  timeout or lean on `retries` to hide it — a `flaky` annotation is a bug. (V0-11)
- **`strict mode violation: getByLabel(...) resolved to N elements`.** → `getByLabel`/`getByText` are
  **substring + case-insensitive** by default; "Weight" also matches "Log bodyweight" and "Set 1
  weight". → Add `{ exact: true }`, or scope by section: `getByRole('region', { name }).getBy…`. (V0-11)
- **`webServer` never starts: "Invalid project directory … /apps/web/-p".** → `pnpm --filter web start
-- -p 3100` forwards `-- -p 3100` literally to `next start`, which reads `-p` as a directory. → Use
  `pnpm --filter web exec next start -p <port>` (or the `PORT` env). (V0-11)
- **Can't run the e2e locally at all.** → No Docker on the dev machine; the app needs a **TCP**
  Postgres (PGlite is in-process only, used just for `db:verify`). → CI is the first real e2e run;
  front-load robustness. **Fix realized for the screenshot flow (`chore/screenshot-ephemeral-db`):**
  `pnpm --filter web screenshot:ephemeral` boots a throwaway **`embedded-postgres`** (real Postgres
  binary on an ephemeral TCP port, no Docker/creds), migrates+seeds it via the `packages/db` scripts,
  and runs `next start` against it — so a data-dependent capture never touches live Neon. The same
  approach is the future path for local e2e. See [docs/plans/v0-11-ci-postgres-playwright.md] and the
  `no-docker-local-e2e` memory. **RESOLVED — `pnpm e2e:local`** (`apps/web/scripts/e2e-local.ts`)
  applies exactly that approach to the smoke: ephemeral `embedded-postgres` → migrate + seed via the
  `packages/db` scripts → `playwright test` with `DATABASE_URL`/`ACCESS_GATE_PASSWORD`/`E2E_PORT`
  injected → cluster deleted on exit. ~35s cold on this machine. Plain `pnpm --filter web e2e`
  provisions no DB and still inherits `.env.local`, so it is the CI-only form.
- **Screenshot capture wrote real rows into the live kids' log.** → The old `screenshot` script boots
  a prod server that reads `apps/web/.env.local` → live Neon, so capturing an "already-logged"
  check-in **mutated prod**. → Default the flow to a throwaway embedded Postgres
  (`screenshot:ephemeral`); targeting a non-local DB now requires an explicit `--use-live-db` /
  `SCREENSHOT_ALLOW_LIVE_DB=1` opt-in, so "point at prod" is a deliberate exception, not the default.
  (chore/screenshot-ephemeral-db)
- **Next 16 env precedence — does `.env.local` override an injected `process.env`?** → NO. `@next/env`
  `processEnv` only applies a parsed `.env*` key when it is **undefined in the initial `process.env`
  snapshot** (`typeof l[t]==="undefined"`), so a value **already in `process.env` WINS**. → To point a
  `next start` at a different DB, inject `DATABASE_URL` into the server's environment — no
  `.env.screenshot`/temp-cwd trick needed. (chore/screenshot-ephemeral-db)

## embedded-postgres

- **A PERSISTENT `embedded-postgres` re-run fails if you re-`initialise()` / re-`createDatabase()`.**
  → For a throwaway DB the dir is always empty so both calls are fine; for a persistent dir (the
  `pnpm dev` local sandbox) the cluster already exists — `initialise()` repopulates and
  `createDatabase()` errors "already exists". → Detect a live cluster by the **`PG_VERSION` marker** in
  the data dir and, when present, skip both — just `start()`. Also: the superuser **password is baked
  into the cluster at initdb time**, so it MUST stay constant across runs (a changed password can't
  reconnect to an existing `.local-db` — `pnpm db:local:reset` to start over). Shared
  `startEmbeddedPostgres` helper (`apps/web/scripts/embedded-pg.ts`) does the detection for both the
  screenshot and dev flows. (chore/local-dev-db)
- **The Next env-precedence trick works for `next dev`, not just `next start`.** → Same `@next/env`
  `processEnv` path (a value already in `process.env` WINS over `.env.local`), so injecting
  `DATABASE_URL` into the `next dev` child env overrides `.env.local` — the basis for `pnpm dev`
  pointing the dev server at the local embedded DB while leaving `.env.local` (and its
  `ACCESS_GATE_PASSWORD`) otherwise intact. (chore/local-dev-db)

## React / forms

- **A controlled radio is still wiped by React 19's form reset, and "make it controlled" is the
  WRONG fix — `defaultChecked` is the right one.** → `PROF-1 a-1u`'s add form has a `kind` radio group
  and a name field. A name-only refusal cleared the radio, so a parent who chose "Adult" and left the
  name blank lost the choice they had just made — then earned a second refusal about the kind if they
  did not notice. The repo already knew the family (`write-path.md` → Traps records that controlling a
  `<select>` is not enough), but the obvious generalisation is wrong in a specific way: React keeps a
  controlled **text** input's `value` attribute in sync, so a text field survives, and it freezes a
  controlled **radio**'s `defaultChecked` at mount, so `form.reset()` returns it to unchecked whatever
  `checked` renders. → **Hold the value in state and render it as `defaultChecked`, keeping
  `onChange`.** Probed three ways: `checked` → wiped; `defaultChecked` → survives; `checked` plus a
  `useEffect` re-assert → survives but pokes the DOM after commit and paints a frame of unchecked
  radios. ⚠️ **The first fix shipped was the effect, and the e2e test stayed red through the
  intermediate `checked`-only attempt** — which is what found the bug at all; a unit test asserting
  `toHaveProperty('onchange')` had passed, because that property exists on every DOM input. If a test
  for "this field survives a refusal" cannot be made to fail by deleting the fix, it is not testing
  the fix. (`PROF-1 a-1u`)

- **`aria-disabled` and `readOnly` do NOT stop a control from being submitted** — only real
  `disabled` (or omitting the `name`) does. A V1-5 check-in field rendered "already logged" as a
  still-`checked` checkbox with `aria-disabled` (chosen for keyboard/SR reachability); it kept
  submitting `"1"` on every later form submit, inserting a **duplicate row each time** (surfaced once
  V1-6a's accumulate flow made repeated submits normal). → For a display-only "already done" field,
  **drop its `name`** (`name={isLogged ? undefined : …}`) so it renders but doesn't submit — keeps it
  focusable + announced, unlike real `disabled`. A one-submit e2e won't catch this; test a **re-submit**. (V1-6a)

- **A rotated idempotency key on a form that stays on screen makes a second submit a second ROW.**
  The bodyweight form rotated its `clientId` after every ok result (the `add-server-action` skill said
  to), and `logBodyweight` dedupes only on `client_id` — so "did I already weigh in?" → tap again →
  a duplicate. → Keep the key stable for as long as the form can resubmit the same record (a resubmit is
  then an `ON CONFLICT DO NOTHING` no-op), and stop rendering a create form over an existing record.
  Rotate only on append-style forms that genuinely create a new row each time (`checkin-form.tsx`).
  (V1-24 PR 1a)

- **A value→value change in server props is not evidence that THIS user saved.** The bodyweight
  announcer fired on any change of the saved value, so a refused amend that revalidated in another
  device's value was announced as "saved" and pulled focus out of the still-open editor. → Announce
  and move focus from the action's own `ok` result (`useOnActionSuccess`), not from a diff of props.
  (V1-24 PR 1b)

- **An unkeyed client island survives a `?d=` day change.** Same-route searchParam navigation keeps
  client state, so the amend editor kept day A's typed value while its hidden `entryId`/`seenValue`
  re-rendered to day B's row, and Save amended B. → Key every stateful island on what it edits
  (`key={`amend-${entryId}`}`), as the create form is keyed on the day. (V1-24 PR 1b)

## Vitest / RTL (component tests)

- **A whole feature shipped INERT with every gate green — an action parsed a field and then forgot to
  forward it.** → GAP-1 P0-1 validated `dayRole` and omitted it from the `logStrengthSession({…})`
  call, so `sessions.day_role` was never written from the app. Three gates missed it independently:
  the DAL arg is **optional** (`dayRole?: string`) so `tsc` was clean; `db:verify` drives the WRITER
  directly, bypassing the action; and the happy-path assertion used **`expect.objectContaining`,
  which is blind to a key that is simply ABSENT** (it only checks the keys you list). → For any
  field threaded action → DAL, assert the **value** — `expect(vi.mocked(dep).mock.calls[0][0])
.toMatchObject({ field: 'x' })` — and prove the test fails with the line removed. **An optional
  parameter is a silent-drop hazard**: prefer asserting each threaded field explicitly over trusting
  a spread. (GAP-1 P0-1 → fix/gap1-p01-forward-day-role)

- **Test "passes" but the run exits non-zero: `ReferenceError: window is not defined` (unhandled,
  after the tests).** → An RTL component test didn't **unmount** — clearing `document.body.innerHTML`
  isn't enough; React/`next/link` scheduler work stays pending and flushes _after_ jsdom is torn down.
  → `import { cleanup } from '@testing-library/react'; afterEach(cleanup)`. RTL's auto-cleanup only
  registers when vitest `globals` is on (ours is off — we import test APIs), so wire it explicitly.
  Also declare the DOM per-file: `// @vitest-environment jsdom` (the suite default is `node`). (V1-3)

## CI / secrets

- **`pnpm verify` is green, `guides:check` is green, and CI's `quality` still fails — because
  `status:check` is NOT in `verify`.** → `package.json:27` lists eleven commands and `status:check`
  is not one of them (`:30` defines it separately). It runs **locally only if you type it** and on
  every PR. So the first time a branch exercises it can be in CI. **And its rule is not the obvious
  one:** the changelog fragment's FILENAME must match the **branch slug**, not the change. On
  `feat/auth-logout-button` a fragment named `2026-10-22-feat-picker-lock-this-device.md` fails with
  _"Found, but not a valid entry for this branch"_ — a fragment existed, it was just named after what
  shipped instead of after the branch. Easy to hit when a panel changes the design mid-branch and the
  commit stops matching the branch name. **Fix:** run `pnpm status:check "$(git merge-base origin/main
HEAD)"` before opening a PR — the bare form takes a different path and may pass where CI will not,
  because CI passes `BASE_SHA`. _(2026-10-22.)_

- **A control the code wires can still be OFF in production, and the docs will not notice.** →
  `lib/rate-limit.ts` fails **open** when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are unset (correct for
  local dev and CI). Production had **no Upstash database at all** until OPS-1's runbook (2026-10-09),
  while `service-setup.md` called Upstash optional and `tech-debt.md` said "the gate IS now rate
  limited". The same no-op that keeps CI green hid it. → For any fail-open control, check the
  **deployed scope**, not the code: Vercel → Environment Variables, filtered by Production.
  `service-setup.md` now marks Upstash required in every deployed scope.

- **Deleting Vercel deployments in bulk: there is no bulk delete in the dashboard, and the API
  rate-limits deletes** (about 200, then `429 rate_limited "now-rm" … try again in 10 m`). → Use
  `pnpm preview:purge`, which waits out the 429 and resumes. **Prove a purge by URL, not by count:**
  GitHub keeps its own deployment records, so `deployments?environment=Preview` never drops. A
  recorded `environment_url` must answer **404**; behind Vercel Authentication a live deployment
  answers **302**, which looks like "protected" and is not "deleted". (OPS-1, 2026-10-09)

- **A runbook block pasted into zsh fails in two silent-looking ways.** → `read -s VAR` pasted together
  with the lines after it reads **nothing**, so `VAR` is empty and a later script fails with "Set
  DATABASE_URL_UNPOOLED". And without `setopt interactive_comments`, zsh passes a trailing
  `# comment` to the command as **arguments** (`sed: #: No such file or directory`, `tsx script.ts '#'
'→'`). → Runbook blocks carry no trailing comments and say "one line at a time". (OPS-1, 2026-10-09)

- **Before closing OR fixing a red dependency major, check the ecosystem's peer ranges — it takes one
  command and it settles the question.** → `npm view eslint-plugin-react peerDependencies` showed
  `eslint: "... || ^9.7"` on its LATEST version, proving ESLint 10 was unfixable on our side rather than
  a config problem worth debugging. The same check on `eslint-config-next` showed the plugin arrives
  transitively, so it couldn't be swapped independently either. Two commands turned "this CI failure
  needs investigation" into "no version combination passes today; close it." (V1-14a follow-up)

- **A Dependabot MAJOR can be an ecosystem-readiness problem, not a code problem — pin the toolchain,
  don't chase npm.** → Dependabot proposed `typescript` 5.9 → **7.0** (the Go rewrite) two days after
  publication. `@typescript-eslint/typescript-estree@8` cannot parse it —
  `TypeError: Cannot read properties of undefined (reading 'Cjs')` — so `quality`, `e2e` **and** the
  Vercel build all failed with nothing fixable on our side, and Dependabot would have re-proposed it
  weekly, burning a full CI run each time for a guaranteed red. → **`ignore` semver-major for
  compiler/parser-coupled deps** (`typescript`) until the tooling that parses them catches up, with a
  comment naming the condition to remove it. Conversely, **GitHub Action majors are safe to group** —
  they're almost always runner-image/Node bumps, not semantics. (V1-14a follow-up)

- **A known-flaky e2e makes routine dependency bumps look broken.** → Three green Dependabot PRs
  (`checkout`, `cache`, `commitlint`) showed red purely from the check-ins flake. That is the failure
  mode that trains a reviewer to ignore red checks — the cost of an unfixed flake is not the flake, it
  is the signal it destroys elsewhere. → When triaging a red bump, check WHICH job failed before
  assuming the bump caused it. (V1-14a follow-up)

- **gitleaks red on a CI placeholder** (e.g. `ci-e2e-placeholder-1234`). → A high-entropy dummy value
  trips the generic-api-key rule. → Allowlist the **specific** string in `.gitleaks.toml` (tight regex,
  not a path exclusion, so real secrets in those files are still caught). Low-entropy placeholders
  (`ci-build-placeholder`) slip through by luck — don't rely on that. (V0-11)

## Next.js 16

- **The access gate was bypassable by any request that carried a prefetch header.** → The proxy
  matcher's `missing: [prefetch headers]` decides whether the proxy RUNS AT ALL, and the header is
  client-controlled. A local probe saw a 400 from Next and called it safe; a Vercel preview served the
  full page. → No `missing:`/`has:` condition on a matcher that guards access, and re-check the gate in
  every action and page (`lib/dal/gate.ts`). Probe the deployed edge, not just `next start`. (SEC-1)

- **`middleware.ts` silently ignored.** → Next 16 renamed it to **`proxy.ts`** (function `proxy`,
  `export const config = { matcher }`). → Read `node_modules/next/dist/docs/` before writing
  version-sensitive code (per `apps/web/AGENTS.md`). (V0-4)

## Screenshots / visual verification

- **A screenshot showed the OLD UI and I believed it.** → `screenshot:ephemeral` **reuses `.next`
  when present** (its own docblock says so); without `--build` it serves a stale production build, so
  a capture taken right after an edit can show the code from two edits ago. It cost two wrong
  conclusions in one session: first that a fix had worked, then that a later one had broken it. →
  **Pass `--build` whenever the capture is evidence for a change you just made.** Reuse is for
  iterating on a state's fixtures, not for verifying code.
- **A prop reached the component and rendered nothing, with typecheck and 1385 tests green.** → A
  batched edit added `programNote` to `StrengthSection`'s signature AND its type but the third
  replacement — the render line — silently did not match, and nothing asserted it had. **An unused
  destructured prop is legal TypeScript**, so `tsc` was clean; no test covered the new line; and the
  stale build above hid it. Same family as the GAP-1 P0-1 inert field below. → **Assert each edit
  landed, individually**, and for a new rendered element grep the file afterwards for the render
  itself, not just the prop name — `grep -c programNote` returning 3 (signature, type, render) is the
  check that would have caught it at 2.

- **Three screenshots reported `✓` and all three showed a 404.** → `screenshot:ephemeral` takes
  `--state`, and the route as a POSITIONAL. An unrecognised flag was not rejected: the parser treats
  anything it does not know as positional, so `--only sheet-open` became the route `sheet-open`,
  which 404s — and the capture of Next's not-found page was reported as a success for mobile, tablet
  and desktop. A published 404 is a false claim in a PR, so this is an accuracy problem, not a
  convenience one. → **The script now rejects an unknown flag** (`KNOWN_FLAGS`, and a bare `--` is
  pnpm's separator, not a flag). The general rule it belongs to: _a capture harness must fail, not
  capture, when it cannot tell what it was asked for_ — and **look at the image** before publishing
  one, which is what actually caught this.

## Guards that pass while guarding nothing

- **A focus assertion passes when focus was ALREADY there — so a "we move focus on failure" test must
  move it away first.** → `PROF-1 a-1d` added a focus return for a failed Restore and a test asserting
  the callout ends up focused. It passed with the fix **deleted**: the earlier add-submit had already
  focused the callout, and jsdom does not move focus on a click, so the test re-asserted a state the
  previous effect set. **Fix:** focus something else (the name field) immediately before the action,
  assert that it took, and only then assert focus came back. **The general shape:** any assertion
  about a state transition has to establish the _starting_ state, or it measures the end state twice.
- **Reversing a sort proves the assertion READS the sort; it never proves the sort is needed.** →
  `PROF-1 a-1d` added `orderBy(asc(id))` to a duplicate-name lookup so that, among two live cousins
  both called Ada, a third is always warned about the same one. The assertion was "probed" by flipping
  the clause to `desc` and watching it go red — which only shows the test is sensitive to the ORDER
  it is given. A reviewer asked the right question: what happens if the clause is **deleted**? It
  stays green, because a seq scan over rows inserted back to back returns them in insertion order
  anyway. ⚠️ **An UPDATE between them does not reliably rescue it either** — MVCC moves the tuple in
  a toy two-row table (probed: `SET name = name` flips `1,2` to `2,1`), but did not flip the real
  fixture, whose table carries several indexes. → **The discriminating mutation for a sort is
  DELETION, not reversal.** If deleting it leaves the suite green, the clause may still be worth
  keeping — determinism as a contract rather than as a property of today's heap — but say that, and
  do not claim a test pins it. ⚠️ This was the **third** proof-that-cannot-fail in one chunk, after
  a `toHaveProperty('onchange')` assertion true of every DOM input and a jsdom "no submit fired"
  assertion that jsdom can never falsify. The shared shape: the mutation chosen was the one the test
  was already looking at. (`PROF-1 a-1d`)

- **`db:mutations` MUTATES the shared working tree, so running it concurrently with anything else in
  the same worktree produces a screenful of failures that mean nothing.** → The runner `git apply`s
  each patch, runs `db:verify`, and reverts in a `finally`. Two things ran it at once in one worktree —
  `pnpm verify` in the session and a review subagent that had been _told_ to run it — and the gate
  reported **16 of 25 patches "does not apply"**, pointing at `export-month.ts`, a file neither had
  edited. `git status` was clean and `git diff` against `HEAD` was empty, because by then both had
  finished reverting. A re-run on a quiet tree: **25/25 RED**. The same race hits `vitest`, which sees
  a half-patched source and fails on a tautological predicate. → **Never ask a review subagent to run
  `db:mutations`** (a review is read-only; the runner is not), and do not start `pnpm verify` while one
  might be. ⚠️ **The failure mode is believable**, which is the danger: "patch does not apply" is
  exactly what a real context shift looks like, so the instinct is to regenerate 16 patches. Check for
  a concurrent runner BEFORE regenerating anything. (`PROF-1 a-1w`)

- **A mutation patch's `.expect` silently stops describing its patch when an assertion is inserted
  ABOVE the one it names — and the gate says so rather than passing.** → `PROF-1 a-1w`'s patch `22`
  (the athlete cap never binds) pinned _"the 26th athlete is refused as FULL, not as refused"_. A
  later review added an archived-slot assertion **earlier in the same block**, so with the patch
  applied that one failed first and the runner reported `RED, but on the WRONG assertion` — naming
  both the expected and the actual message. ⚠️ **The tempting fix is the wrong one:** truncating the
  `.expect` to a prefix that matches whatever fails first makes the pin meaningless, which is the
  vacuity `scripts/mutations/` exists to catch, pointed at itself. → Re-pin to the assertion that
  **now** fails first, and only after reading whether it still proves what the patch is for (here it
  proves more: the cap exists AND archived rows hold their slot). And **re-run `pnpm db:mutations`
  after every edit to `verify.ts`**, not only after editing a patch — the gate's inputs are both
  files, and `pnpm verify` runs it, so an unrelated-looking assertion insert is enough to redirect a
  pin. (`PROF-1 a-1w`)

- **🔴 Drizzle STRIPS the table qualifier from a `Column` interpolated into a `sql` chunk in a
  single-table SELECT list — so a correlated subquery silently stops correlating.** → `PROF-1 b`
  needed "does this profile have any live entries?" and wrote it inline:
  `` sql`EXISTS (SELECT 1 FROM ${entries} WHERE ${entries.profileId} = ${profiles.id} AND …)` ``.
  `.toSQL()` renders that as `EXISTS (SELECT 1 FROM "entries" WHERE "profile_id" = "id" AND
"deleted_at" IS NULL)` — **unqualified**, so `"id"` binds to `entries.id`. The predicate became
  _"does any live entry have `profile_id` equal to its own id"_, which in production (entry ids in
  the thousands, profile ids single-digit) is almost always FALSE, and on a small fixture can be
  TRUE for everyone. The feature it gated — an export control that states a reason when there is
  nothing to export — would have been wrong for every athlete, and the published privacy notice had
  already been written to promise it.
  ⚠️ **Nothing available caught it.** The column's TYPE is right (it really is a boolean), so
  typecheck is clean; `db:verify` had no assertion on the VALUE; and the inline form had already been
  hand-copied to a second call site, which is how a subtle defect doubles before anyone looks.
  → **Use `exists()` with a nested `select`**, which keeps qualifiers
  (`"entries"."profile_id" = "profiles"."id"`), define it **once** in `packages/db`, and assert the
  **value** with two rows in different states — here one profile with a live entry and one whose only
  entry is soft-deleted, plus a mutation patch that breaks the correlation. **Generally: when a `sql`
  template references a column from a table other than the query's FROM, dump `.toSQL()` before
  believing it.** (`feat/prof-1b-archive-athlete`)

- **A timestamp assertion that compares two `now()` calls passes by luck.** → The same chunk proved
  `COALESCE(archived_at, now())` keeps the FIRST archive date by archiving, immediately re-archiving,
  and comparing the two `Date`s. Run with the `COALESCE` removed it was **green in 2 of 3 runs**: the
  replay lands ~0.3ms later and JS `Date` carries milliseconds, so two distinct `now()` values inside
  one millisecond compare equal. Only a run that happened to cross a millisecond boundary went red —
  and a mutation patch written against it would have been flaky, which is worse than absent.
  → **Pin the stored value to a fixed, impossible-to-reproduce one first** (`UPDATE … SET archived_at
= '2026-01-01T00:00:00Z'`), then replay and assert it is unchanged. A `now()` can never equal a date
  in the past, so the assertion is sensitive on every run. (`feat/prof-1b-archive-athlete`)

- **`CREATE EXTENSION` in a migration turns `db:verify` red on every PR afterwards.** → Every
  migration is replayed on **PGlite**, which ships no contrib extensions: `CREATE EXTENSION IF NOT
EXISTS pg_stat_statements` raises _"extension … is not available"_ and `pg_available_extensions`
  has no row for it (probed on `@electric-sql/pglite@0.5.13`). The `IF NOT EXISTS` does **not** help —
  it guards against already-installed, not against unavailable. → A Postgres extension the app does
  not read is an **operator action against prod**, not schema: there is nothing for a migration to
  keep in sync, and the runbook is the right artifact
  ([runbooks.md](./runbooks.md) → "Enable `pg_stat_statements` on prod"). ⚠️ **And do not rescue a red
  `db:verify` by wrapping the statement in a conditional** — that makes the extension silently absent
  in production too, turning a loud failure into a quiet one. (`docs/obs-cookie-and-pg-stat-statements`)

- **`guides:check` reported OK while enforcing 3 of `write-path.md`'s 13 `owns:` entries.** → The
  frontmatter parser ended the `owns:` list at the first line that was not a `- item`, and a `#`
  comment is such a line (`check-feature-guides.mjs`, the `else if (line.trim() !== '')` branch).
  `write-path.md` carries four explanatory comments inside `owns:`, so **ten paths — including
  `mutation-entry.ts`, `mutating-actions.ts`, `packages/db/src/writers/`, `scope.ts` and `seed.ts` —
  were covered by neither rot check**, and the guard printed "OK" on every PR that touched them.
  The two other guides have no in-block comments and parsed fully, which is why nothing ever looked
  wrong. ⚠️ **The documented syntax was broken too:** `docs/features/README.md`'s Format section shows
  `- packages/db/src/writers/ # a trailing slash owns everything beneath`, and the parser took the
  comment as part of the path, so rot check #1 would have failed on the comment text had anyone
  written it that way.
  → **Two lessons, and the second is the general one.** Specifically: skip whole-line comments inside
  a list block rather than treating them as its end, and strip a trailing ` # …` from each item.
  Generally: **this guard was the only one of ten with no self-test**, which is exactly why the bug
  survived — the fix ships `check-feature-guides.test.sh`, whose comment cases were probed RED against
  the old parser (case 3 exited **0**, silently owning nothing). A guard without a self-test is a
  claim, not a check. (`fix/dx-guides-owns-parser`)

- **A negative fixture covered by TWO conjuncts proves neither.** → `db:verify`'s soft-deleted-owner
  block (`PROF-1 b-s`) built the state it names — one account holding a dead `owner` row in household
  X beside a live `member` row in Y — by putting the dead row in a household that was **itself**
  soft-deleted. `membershipHousehold` carries `household_members.deleted_at IS NULL` **and**
  `households.deleted_at IS NULL`, so each conjunct excluded the row on its own: mutation patches
  `07` and `09` both left the block **green**, and the assertion the PR headlined as _"the case the
  whole design rests on"_ could not fail for a conjunct regression. → When writing a fixture whose
  point is that **one** predicate excludes a row, make every **other** predicate's answer _include_
  it, then prove that by applying each neighbouring mutation patch and watching where it reddens.
  ⚠️ **Fail-fast hides this**: patch `07` reddens at an earlier assertion, so the later block is
  never reached and "14/14 RED" says nothing about it — a block that no patch can reach needs its own
  patch (here `15`, which attacks the role's source). (`feat/prof-1b-s-owner-scope`)

- **A guard regex that fires on sixteen wrong files and zero right ones.** → `scope.test.ts`'s
  "no defaulted `scope` parameter" guard uses `/\bscope\s*[?=][^=]/`. Copied to `role`, that pattern
  matched JSX `role="status"` across sixteen `apps/web` files and matched the actual target,
  `role: HouseholdRole = HOUSEHOLD_ROLE.owner`, in **none** of them — the `:` after `role` never
  satisfies `[?=]`. A guard noisy everywhere except on its target is how a guard gets relaxed into
  uselessness. → Copying a guard to a new field means **re-deriving the pattern for that field's
  syntax**, not reusing the sibling's, and then **probing it red** against the exact line it exists
  to catch. The fixed form keys on the parameter shape: `/\brole\s*(?:\?\s*:|:[^,;)=]*=[^=])/`.
  (`feat/prof-1b-s-owner-scope`)

- **A SQL fragment that compares two bind parameters is not a database check.** →
  `isOwnerOf(scope)` was documented in five places as _"the database-side half"_ /
  _"`household_members.role = 'owner'`, as SQL"_ / _"the half that survives a forgery"_. Its body is
  `` sql`${scope.role} = ${HOUSEHOLD_ROLE.owner}` ``, which emits `$1 = $2` with params
  `['member', 'owner']` — **no table and no column**; the database never re-checks membership, and a
  forgery that _writes_ `role: 'owner'` passes it. Four independent review lenses flagged it; one
  probe settled it: `new PgDialect().sqlToQuery(frag)`. → **Before describing a `sql` fragment by
  what it checks, dump what it emits.** The property that survived is real but narrower — a lost
  narrowing fails closed as a row count — and the prose now says that instead.
  (`feat/prof-1b-s-owner-scope`)

## Docs / claims that go stale

- **A committed comment or doc says "until `<chunk>`" and that chunk has now shipped, so the file
  states the opposite of the truth.** Fourth occurrence: 1c-3a → #320, 1c-3b → #323 and #324, 1c-4 →
  #330. Each time it was found by review, not by the author. → `git grep -l '<chunk>'` finds only the
  claims that NAME the chunk. The expensive ones **describe the behaviour** instead: `SECURITY.md`
  called a removed throw an "enforced control", `schema.ts` said a second household "takes the app
  down", `plan.md` told a future chunk the same thing, and a Mermaid **node** and **edge** carried the
  old outcomes where no prose did. → Sweep in two passes, and record both in the PR: (1) `git grep -l`
  on the chunk id; (2) grep the **behaviour** — the removed error message, the old predicate, the
  phrase the old mechanism was described by (`grep -rn "throws on a second"`) — because a claim that
  never names the chunk is invisible to pass 1. Then **state the list, never a count**: a list can be
  checked against the tree, a count can only be re-derived. Dated history (`docs/changelog/*`, merged
  `docs/plans/*`) is NOT rewritten.

## Git / commits

- **A commit message described a correction the file did not carry — because the edit asserted, failed,
  and the commit ran anyway.** → A scripted edit anchored on an exact string; `prettier` had since
  padded that string (a markdown table cell) so the anchor missed and the script raised. The commit
  command was on the **next line**, not chained with `&&`, so the shell ran it regardless: the message
  claimed a zod default message had been corrected while the document still carried the wrong claim.
  This is the same shape as `PROF-1 b-s`'s review log recording two fixes that lived only inside a
  mutation patch — **the record and the tree disagreeing, with every gate green**, since nothing
  checks prose against prose. → **Verify the edit landed, then commit** — `grep` for the new text AND
  for the absence of the old, as two separate assertions, before `git commit`. An `assert` inside a
  script only protects the script; it does not protect the commit that follows it on the next line.
  ⚠️ Chaining with `&&` is not sufficient either when a formatter runs between the edit and the check:
  re-read the file, do not trust the exit code. (`docs/prof-1a-1-plan-refresh`)
  ⚠️ **And the inverse costs a full cycle:** a scripted edit runs _no_ formatter, while
  `pnpm verify` opens with `prettier --check .` over the whole tree — so a python- or `sed`-written
  file fails the very first gate, after which nothing else runs. The pre-commit hook would have
  formatted it, but `verify` comes first in the order of work. → End every scripted edit with
  `npx prettier --write <the files it touched>`; it is cheaper than discovering it at the top of a
  40-second gate twice. (`PROF-1 a-1w`)

- **Generating a mutation patch swallowed the real source fix and then reverted it.** → The recipe
  for a new `scripts/mutations/*.patch` is: edit the source, `git diff > the.patch`, then
  `git checkout -- <file>` to put the source back. If that file **also holds uncommitted real edits**,
  `git diff` captures BOTH — so the patch silently bundles the fix — and `git checkout --` then throws
  the fix away. Observed on `PROF-1 b-s`: a corrected docblock and a `HouseholdRow['id']` type landed
  **only inside patch `15`**, the review-response log recorded both as shipped, every gate stayed green
  (the patch applies; `db:verify` still reddens), and `main` kept the false claim in the one module the
  corrected documents all call _"the ONLY authority"_. A second-pass reviewer found it by diffing the
  commits against the log, not by running anything. → **Commit the real edits BEFORE generating a
  patch**, so `git diff` has nothing else to pick up and `git checkout --` restores from an index that
  already holds them. Then check the patch contains only its one intended hunk: `grep '^+'` it.
  (`fix/prof-1b-s-source-edits`)

- **`Unknown skill: <name>` for a skill that is on `main`.** → Project skills load from the
  `.claude/` of the directory the session was **launched** in. A session started inside a linked
  worktree loads that worktree's skills; one launched in the **main checkout** loads whatever branch
  the main checkout has checked out. Another session had switched the main checkout to a feature branch
  cut before the skill merged, so for sessions launched there it did not exist. → Keep the main
  checkout on `main` (guarded, best-effort, by `.claude/hooks/guard-main-checkout.mjs`; the
  `SessionStart` briefing warns when it isn't). To use a skill meanwhile, read its `SKILL.md` from your
  up-to-date worktree and follow it. (chore/dx-guards)
- **Squash merge landed an _intermediate_ commit — the last pushes are missing from `main`.** → A PR
  merged while newer commits were still landing (or merged at the SHA the page was showing) squashes a
  stale head, silently dropping later commits. → After any squash merge, `git pull --ff-only origin
main` in the main checkout (it stays on `main`; see `ship-pr` step 8), then spot-check `main` has
  your final work (`git show HEAD:<file> | grep <distinctive line>`). If missing, cherry-pick the dropped commits forward on a follow-up branch. (V0-11 → #24)
- **Commit rejected: "subject must not be sentence-case / start-case".** → commitlint wants a
  **lowercase** subject start. → `feat(x): add …`, not `feat(x): Add …` / `feat(x): CI …`.
- **Commit rejected: `type must be one of [build, chore, ci, docs, feat, fix, perf, refactor, revert,
style, test]` — on a `db/…` branch.** → ⚠️ **`db` is a valid BRANCH type and NOT a valid commit
  type.** AGENTS.md → "Git & branch workflow" lists `type ∈ feat|fix|chore|docs|refactor|perf|test|db`
  for **branch names**; commitlint's `type-enum` is the Conventional Commits set, which has no `db`.
  So every migration PR starts on a branch whose name invites a commit subject the hook then refuses.
  → A dark migration is **`feat(<chunk>)`** — the precedent is `feat(auth-1b): household_members,
migration 0019, and the claim correction — all dark` (#308). Keep the `db/` branch name; it is only
  the commit type that differs. (PROF-1 a-0)

## tsx / scripts

- **`tsx` script fails: "Top-level await is currently not supported with the cjs output format".** →
  The package has no `"type": "module"` (e.g. `apps/web`), so tsx transforms `.ts` to CJS. → Wrap the
  body in an `async function main() { … }` + `main().catch(…)`, or make the package/file ESM
  (`.mts` / `"type": "module"` — `packages/db` does the latter). (V0-11 screenshot script)
- **A plain `tsx` script doesn't see `.env.local`.** → Only Next auto-loads `.env.local`; a standalone
  tsx run doesn't. → Pass env explicitly (`ACCESS_GATE_PASSWORD=$(…) pnpm --filter web screenshot`).

## pnpm / build

- **`node_modules` appears in a CI step that never ran `pnpm install`.** → pnpm 11 defaults
  `verify-deps-before-run` to `install`: the first `pnpm run <script>` in a fresh checkout silently
  installs (no `--frozen-lockfile`, lifecycle scripts) before running the script. A plan claimed the
  guard scripts "run with no `node_modules`" because its probe checked for `node_modules` **before**
  the script, not after. → Set `pnpm_config_verify_deps_before_run: 'false'` (the env var outranks
  `pnpm-workspace.yaml`) on any job that runs `pnpm` before its explicit install; `quality` does, and
  asserts nothing was installed ([DX-5(b)](./plans/dx-5b-local-gates-in-ci.md)). Probe both ways: look
  for the side effect **after**.

- **A dependency bump makes `next build` fail type-check in files it never touched, with**
  `Type 'drizzle-orm/sql/sql'.SQL<unknown> is not assignable to type 'drizzle-orm/sql/sql'.SQL<unknown>`
  **/ `Types have separate declarations of a private property 'shouldInlineParams'`.** → **Two copies of
  the SAME `drizzle-orm` version**, differing only in the `pg` peer they resolved against. Dependabot
  bumped `pg` in `packages/db` but left `apps/web`'s **optional `pg` peer** pinned to the old version —
  `apps/web` declares `drizzle-orm` but not `pg`, so its peer was resolved incidentally. TS treats the two
  as nominally distinct because of the private field. Read the **full `.pnpm/` paths** in the error: they
  differ only in `_pg@8.22.0` vs `_pg@8.23.0`. That is the whole diagnosis. → **`pnpm update pg --recursive`**,
  then commit the lockfile (−38/+3 lines; repoints the peer and prunes the orphaned entries).
  **What does NOT work:** `pnpm dedupe` (won't re-resolve an already-pinned peer, zero churn);
  `pnpm.overrides` (same, zero churn); hand-editing the peer refs (leaves duplicate snapshot keys and
  fails `--frozen-lockfile`); `@dependabot recreate` (its lockfile updater is minimal by design, so it
  reproduces the identical commit). **What DOES also work — and is the cheaper path when a dep PR
  conflicts:** resolve the `package.json` conflicts, then take main's lockfile and **regenerate** it
  with `pnpm install`. That re-resolves the whole peer key at once, so no segment can stay stale
  (#112 bumped two peer-key packages and never split, purely because the conflict forced this). Deleting the lockfile _does_ fix it but silently widens the PR to
  dozens of unreviewed packages — never do that on a dependency PR. Also note `pnpm install
--frozen-lockfile` is a **no-op against stale `node_modules`**: verify with `rm -rf node_modules
*/node_modules */*/node_modules` first, or you will 'confirm' a fix that isn't there. (PR #111)

- **Native/esbuild build script blocked on install.** → pnpm 11 blocks unlisted build scripts. → Add
  the package to `allowBuilds` in `pnpm-workspace.yaml`.

---

**Appending:** when a failure takes more than one attempt to diagnose, add an entry here in the same PR
as the fix (see AGENTS.md → "Start here"). Keep it terse; the value is fast recall.
