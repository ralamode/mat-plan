# Tech-debt backlog

Known, **accepted** shortcuts and rough edges — deliberate trade-offs we chose to ship, recorded so
they're paid down on purpose rather than rediscovered. This is not a bug list (those get fixed) and
not the feature backlog ([plan.md](./plan.md)); it's the "we know, and here's the plan" ledger.

Each entry: **what & why it's debt → impact → proposed fix → severity**. Newest on top. When you pay
one down, delete it (git keeps the history) and reference this file in the PR.

Related: [lessons.md](./lessons.md) (failures → fixes, so a known trap costs one attempt),
[definition-of-done.md](./definition-of-done.md). Security-specific debt also appears in
[.github/SECURITY.md](../.github/SECURITY.md); cross-link rather than duplicate.

---

## Open

### The program-tables guard reads imports with regexes, so an unusual spelling slips past (added 2026-11-18, #552 closed)

- **What & why it's debt:** `apps/web/test/program-tables-stay-dark.test.ts` (and its 7b actions,
  HELPERS and erasure pins) finds lane P's imports by matching specifier text. #552 tried to harden
  it, and its security review found that each fix met another spelling: a comment inside an import, a
  backtick specifier, `require (` with a space, a `../node_modules` path, or an `@/` alias walking out
  of `apps/web`.
- **Impact:** an import written that way into a page or the day DAL would not be refused by the
  guard. Code written in good faith uses the plain forms, which the guard catches.
- **The fix:** a parser-based check, ESLint `no-restricted-imports` with path patterns per directory
  (or the TypeScript import graph), so every specifier form, comment and alias resolves in one place.
  Then the regex guard's directory rules move into it.
- **Severity:** low. Maintainer, 2026-11-18: "Close; lint check as tech debt".

### The day page's loading skeleton keeps a switcher row a one-athlete household never shows (added 2026-11-17, FAM-1 12c)

- **What & why it's debt:** `apps/web/app/p/[profileId]/loading.tsx` reserves the athlete
  switcher's 44px row below `lg`, but `AthleteSwitcher` renders nothing when the household has no
  other athlete (`apps/web/components/day/athlete-switcher.tsx`). A Suspense fallback has no data, so
  it cannot know the count; 12c chose to reserve the row for the common case, a household of several.
- **Impact:** in a one-athlete household, on a phone or tablet, the content below the header moves
  up by one row when the page replaces the skeleton. This is a layout shift on that path only. Nothing
  has measured it against the CLS budget.
- **The fix:** keep a row of that height in the real header too, for example the athlete's name as
  static text when there is no one to switch to, so the skeleton and the page agree. Alternatively,
  have the fallback read the household's athlete count from a value it can see without the DAL.
- **Severity:** low. Maintainer, 2026-11-17: "Add to tech-debt".

### Two shell-wrapper walks (added 2026-11-17, DX-18 1b)

- **What & why it's debt:** `.claude/hooks/guard-process-kill.mjs` imports `lex()` from
  `.claude/hooks/guard-main-checkout.mjs` but walks the wrappers (`sudo`, `env`, `timeout`, `xargs`,
  `bash -c`, `find -exec`, …) with its own copy of the loop in the sibling's `analyzeSegment`. The
  sibling's walk is fused with git-specific state (the directory, `GIT_*` env, `-C`), so lifting it
  is a refactor of a 962-line guard with 221 cases; DX-18 D2 chose a second, smaller walk instead.
- **Impact:** a wrapper added to one walk (a new `pnpm` form, `parallel`) is missed by the other, so
  one guard sees through it and the other does not.
- **The fix:** one exported walk in a shared module (`.claude/hooks/shell-walk.mjs`) that yields each
  segment's command words after unwrapping, with a callback for the per-guard state; both hooks
  call it, and `hooks.test.sh`'s wrapper cases run against both.
- **Severity:** low. Both guards are best-effort and say so; each wrapper has a case in
  `hooks.test.sh`.

### The seed's ramp-target expansion reads every household's kid profiles (found 2026-11-16, by lane A outside its diff) — ✅ CLOSED 2026-11-18

- **Closed by `OPS-2` PR 1:** the expansion and `CALISTHENICS_RAMP_SCHEDULE` are deleted (plan D4, the maintainer's Q6), so no seed writes `ramp_targets`; `verify/seed.ts`'s Proof A counts the table after a production seed.

- **What & why it's debt:** `packages/db/src/seed.ts` expands `CALISTHENICS_RAMP_SCHEDULE` into
  `ramp_targets` rows for every profile with `kind = 'kid'`, with no household predicate and no
  `deleted_at IS NULL`. The seed runs on every push to `main`. The schedule ships empty
  (`packages/shared/src/ramp-schedule.ts`), so it writes nothing today.
- **Impact:** none while the schedule is empty. The day it is filled, the next deploy writes ramp
  targets for the kids of every household in the database, archived athletes included: one
  schedule written to every household's kids, by a path with no scope.
- **Fix:** the ramp card and its read leave the app at FAM-1 step 12f (plan D21). Remove the
  expansion from the seed in the same change, or scope it to the seeded household and to live
  profiles if the ramp is kept. Either way before the first outside family is invited.
- **Severity:** low today, high the moment the schedule has a row. Owner: lane A (`seed.ts` is its
  file), with step 12f.

### A day-taken insert can throw when the day is cleared in the same instant (found 2026-11-16, V1-24 3b-life panel) — ✅ CLOSED 2026-11-17

- **Closed:** `writeCheckinEntries` and `insertBodyweightEntry` re-run the insert once, for exactly
  the items no outcome explains, before they throw. `db:verify` stages the race on PGlite with a
  statement-level `AFTER INSERT` trigger that hides the holder inside the skipped insert
  (`verify/single-values.ts` → `verifyDayTakenRace`); mutations 420 and 421 remove each retry.
  Since 2026-11-19 `verifyRetryLandsOnTakenDay` also stages a third phone holding the day again
  before the retry (a `BEFORE INSERT` statement trigger), so a retry must answer `day_taken`;
  mutations 422 and 423.
  A second miss still throws: for a check-in, a reused `public_id`; for a weigh-in, a replay of a
  hidden one, a `client_id` already used by another metric or profile, or an evening-only day.

- **What & why it's debt:** `writeCheckinEntries` (a practice) and `insertBodyweightEntry` (a
  weigh-in) are skipped by their day index when another live row holds the day, then re-read to say
  why. If that other row is cleared between the skipped insert and the re-read, nothing holds the day
  or the id, and the writer throws (`neither inserted nor held`), so the person sees `error.tsx`.
- **Impact:** low. It takes a second phone's ✓ within milliseconds of a clear on the same athlete's
  same day, in a one-household app; a reload logs normally. Bodyweight has had it since #442, practice
  since its clear (3b-life-a).
- **Fix:** re-run the insert once for exactly those items before throwing. Provable on PGlite only
  with a statement-level `AFTER INSERT` trigger that hides the holder inside the insert (the
  correctness lens's stage), which costs more than the race; build it if it is ever seen.
- **Severity:** low. **Accepted** _(V1-24 3b-life plan, 2026-11-16)_.

### A failed query's params reach Vercel's runtime logs (found 2026-11-16, #447 privacy review)

- ✅ **CLOSED 2026-11-17 (`V1-9b` B1-2):** every DAL write now rethrows through
  `apps/web/lib/dal/quiet-db-errors.ts`. The row stays because code comments cite it by name.

- **What & why it's debt:** drizzle wraps a failed statement in a `DrizzleQueryError` whose message
  is `Failed query: …\nparams: …`. `apps/web/lib/sentry-scrub.ts` strips it before Sentry, but Next
  writes the error with `console.error` to Vercel's runtime logs (24 hours), so the row's values (a
  weigh-in, a note, how a session felt) land there. Any DB failure does this; a migration's deploy
  window makes it predictable (FAM-1's `0024` fails every log insert until applied).
- **Impact:** medium on privacy, low on likelihood today: FAM-1 merges migrations when nobody is
  logging, and the inventory (§8, Vercel row) and runbook say so.
- **Fix:** strip `params` (and a 23514's `detail`, the CHECK-violation row) from errors before Next
  logs them, at the one place they are thrown up to `error.tsx`; with a test.
- **Severity:** medium (closed).
- **Gate (added at FAM-1 4b):** fixed before the step that makes save-workout reachable (6a's writer
  behind a screen). 0025 adds `prescriptions.notes` (up to `FREE_TEXT_NOTE_MAX` characters an adult types per exercise, which
  can hold health detail about a child), so the first failed save would put that text in the log.
- **Partly fixed (FAM-1 7a-i, 12b):** a program write's error (create, rename, save a workout), and
  since 12b a day row write's (log, un-tick, re-tick), is rethrown by
  `apps/web/lib/dal/quiet-db-errors.ts` (shared since 12b, moved out of `lib/dal/program/`) with only
  the operation, the error's type, the SQLSTATE and the stack's frame lines, so the gate above is
  met. **Closed by `V1-9b` B1-2:** every write in `lib/dal/entries.ts` and `lib/dal/profiles.ts`
  (fourteen functions, fifteen calls: `logStrengthSession`'s movement find-or-create has its own,
  `logStrengthSession.resolveMovements`), pinned by `lib/dal/writes-quiet-errors.test.ts`. The scope
  read (`household.ts`), whose parameter is the Clerk user id, rethrows a `DbWriteError` too
  (`household.test.ts`). The other reads stay unwrapped; their parameters are ids and a day.

### `drizzle-kit check` is not run anywhere, though AGENTS.md listed it as a CI gate (found 2026-11-16, #428 review) — ✅ CLOSED 2026-11-19

> ✅ **Closed (2026-11-19):** `pnpm --filter @mat-plan/db db:check` runs first in `ci.yml`'s DB step
> and in `pnpm verify` (`db:check`). Checked on drizzle-kit as pinned: a snapshot given its
> neighbour's `prevId` makes it exit 1 ("… are pointing to a parent snapshot … which is a
> collision"), and a clean tree exits 0. ⚠️ It passes a snapshot whose `prevId` is its own `id` (#139).
> Since 2026-11-19 `snapshots:check` catches that on every event and in `pnpm verify`
> ([plan](./plans/dx-snapshot-chain-script.md)); before, only the PR-only forward-only guard did. The entry
> is kept for its history (its Fix line's `check` script is named `db:check`).

- **What & why it's debt:** `packages/db/package.json` defines a `check` script (`drizzle-kit
check`), and AGENTS.md → "Database / migration PR rules" named it first among the CI gates since
  the bootstrap commit. No workflow and no `pnpm verify` step runs it. It is the check that reports a
  snapshot chain two migrations both claim as parent, so the forward-only guard's inline chain check
  in `ci.yml` is the only backstop for that collision. AGENTS.md no longer claims it (this entry's
  PR); the gate table above did not list it either.
- **Impact:** low today. Two FAM-1 lanes now share the migration queue, which is when parent
  collisions happen, and the inline chain check and the journal-order check (#428) catch the cases
  seen so far.
- **Fix:** wire `pnpm --filter @mat-plan/db check` into `ci.yml`'s DB step beside the drift guard,
  or delete the script and say the inline check is the gate. One PR either way.
- **Severity:** low.

### The preview database can skip a migration main later merges (found 2026-11-16, #428 review)

- **What & why it's debt:** `.github/workflows/migrate-preview.yml` documents refreshing the
  preview database from a branch by running `packages/db/scripts/migrate.ts` locally against the
  preview direct string. That records the branch migration's journal `when` as the preview's newest
  `created_at`. drizzle applies a migration only when its `when` is later than that, so a migration
  from main with an older `when` that merges afterwards is skipped on preview with no error. A branch
  migration later regenerated (the journal-order recipe in #428) has a new `when` and hash, so it
  applies a second time on preview after it merges.
- **Impact:** the preview database is seed-only (OPS-1), so no person's data is affected; a preview
  can run on a schema that disagrees with main's until it is reset.
- **Fix:** say in the workflow comment and the OPS-1 runbook section that a preview refreshed from a
  branch is reset from main afterwards, or stop recommending the branch refresh.
- **Severity:** low.

### The old log forms are unmounted, not deleted, and older days have no in-app fix (added 2026-11-15)

- **What & why it's debt:** V1-24 3b-page took the Check-ins form, the Strength section (form,
  program card, receipts), the "Logged entries" list and the "Calisthenics today" card off the day
  page, and left their components in the tree: `checkin-form.tsx`, `strength-section.tsx`,
  `strength-form*.ts(x)`, `strength-session-receipt.tsx`, `program-reference.tsx`,
  `movement-line.tsx`, `todayRows` / `calisthenicsTotals` in `lib/entries/activity-totals.ts`, and
  the reads only those used: `getProgramDay` (`lib/dal/programming.ts`), `resolveDayRole`,
  `checkinFieldsForKeys`, `readsHouseholdProgram`, and `DayNav`'s unused `dayRoleLabel` prop. About a
  dozen `screenshot-ephemeral.ts` states (`strength-*`, `form-*`, `calisthenics`, `program-collapsed`,
  `status-badges`) now target surfaces that are not on the page. Their Server Actions stay, tested;
  `editStrengthSetAction` has no day bound, which is harmless while nothing posts to it. FAM-1 12f deletes them, once 12d and 13b have rebuilt what the
  new page needs (the PICK-1 PR 3 precedent for an unmounted component).
- **Impact:** dead code that still type-checks and still costs review attention; PICK-1 PR 4, which
  mounts into the strength form, waits for FAM-1 13b's surface instead.
- **And:** days before yesterday are read-only, and the page states no way to fix a wrong value
  there; the route is a correction (`db:correct`). Acceptable while one household uses the app.
- **Fix:** FAM-1 12f deletes each file and the actions nothing calls. Revisit the older-day recovery path before FAM-1
  slice 3 opens the new page to the household, or before a second household. **Expiry: FAM-1 12f.**
- **Severity:** low.

### Muted text on `--accent` is 4.34:1 — sub-AA in the light palette, wherever a muted line sits on an accent ground (added 2026-11-13)

- **What & why it's debt:** `--muted-foreground` is oklch L 0.556 and `--accent` is L 0.97, which
  measures **4.34:1** — under WCAG AA's 4.5 for small text. (Dark clears it at 5.83; `--muted` is the
  same value as `--accent`, so it is the same pair.) `UI-5`'s axe run at 1280 found it the first time
  it ran, on the nav rail's current row. **It is not confined to the rail:** `NAV_ROW_CLASS` fills on
  `hover:bg-accent`, so the archived-count line on `/p`'s settings row (`app/p/page.tsx`) has the
  same pair in its hover state today.
- **Why nothing in CI says so:** axe measures the rendered state only. A hover or focus ground it
  never enters is invisible to it, though WCAG 1.4.3 covers every state.
- **What `UI-5` did instead:** removed the pair from the two places it would have shipped it — the
  rail's open row is outlined rather than filled, and its kind line un-mutes on hover
  (`group-hover:text-foreground`). Both are local; the token is untouched.
- **The fix, when someone takes it:** nudge `--muted-foreground` to **oklch(0.545)**, which measures
  **4.54** on accent and 4.96 on background. An L shift of 0.011 is not perceptible, and it clears
  the pair everywhere at once. ⚠️ It is a **design-token change**, so it belongs to
  [`UI-3`](./plan.md) (the reskin), not to a layout PR — which is why `UI-5` did not take it.

### The day resolver's proof seeds the week, prescriptions and assignments by direct insert (added 2026-11-16, FAM-1 step 12a-i; reworded at 12a-ii)

- **What & why it's debt:** `packages/db/scripts/verify/day-plan.ts`'s seeder writes the week
  (`block_day_workouts`), prescriptions with their quantities, and assignments with their seven
  weekday rows by direct `INSERT`. Programs and workouts go through `insertProgramBlockOwnedBy` and
  `insertWorkoutOwnedBy`; entries through the real row writer. **The reason is not that lane P's
  writers are missing** (`saveWorkout` and `saveWeek` are merged): the seeder writes ids that run
  OPPOSITE to `idx`, so an order taken from ids goes red, and `saveWorkout` cannot insert a reversed
  draft, since `supersetsAreWellFormed` refuses a reversed group.
- **What keeps it honest (12a-ii):** every replay first saves each seeded workout through
  `saveWorkout` unchanged and requires the resolved day not to move (the calibration step), so a
  difference between the seeder's rows and the writer's fails there. The replays then make their
  edits with the real writers.
- **Impact:** a rule a writer enforces that the calibration does not exercise (the week's slot key,
  a put-on's weekday rows) can still differ from what the seeder writes.
- **The fix:** none planned. `seedProgramFixtures(db, scope)` takes no `world`, so it cannot seed
  12a's several worlds; the earlier "fold it in at 6c" fix is struck.
- **Severity:** low. Test-only, one file.

### Two reads of a logged row's live sets and quantities (added 2026-11-16, FAM-1 step 11b)

- **What & why it's debt:** `packages/db/src/queries/day/stored-row-values.ts` (`readRowValues`, the
  row writer's replay and re-tick answer) and the app DAL's day read
  (`apps/web/lib/dal/entries.ts`, the live `entry_sets` and then their quantities) are the same two
  queries with the same load-bearing parent filter. 11b wrote the first in `packages/db` because the
  writer cannot import the app DAL; folding the DAL onto it changes a lane-S file, so it was left.
- **Impact:** a change to the parent filter made in one copy (the set-liveness rule) leaves the other
  reading by the old rule. The writer's copy is guarded by mutation 172; the DAL's is not.
- **The fix:** the DAL calls `readRowValues` (or a sibling that also returns the set ids and
  statuses it needs) and keeps only its mapping to DTOs. 12a's day resolver reads through the shared
  one (`queries/day/day-plan.ts`).
- **Severity:** low. Two copies of two queries, with a named owner and a mutation on one side.

### The a11y checks have two copies (added 2026-11-15, FAM-1 step 0b)

- **What & why it's debt:** `apps/web/e2e/a11y-checks.ts` exports `expectNoAxeViolations` and
  `expectTapTargets` for `program-preview-a11y.spec.ts`, and `a11y.spec.ts` still holds its own
  private copies of both, with `targetOf` and `describe`. They were lifted while another open PR
  was rewriting `a11y.spec.ts`, so that file was left alone rather than edited under it.
- **Impact:** a change to the tap-target rule (the selector, the 44px bar, the label rule) made in
  one copy leaves the other scanning by the old rule, and both stay green.
- **The fix:** the next PR that edits `a11y.spec.ts` deletes its four private functions and imports
  the two from `./a11y-checks`. Its long comments, which hold the reasoning for each rule, move to
  that module with them. Mechanical, no behaviour change.
- **Severity:** low. Two copies of about 60 lines, in tests, with a named owner for the fix.

### The nav rail unmounts during a switch between athletes (added 2026-11-13)

- **What & why it's debt:** clicking an athlete in `UI-5`'s rail changes the `[profileId]` segment,
  so Next renders `app/p/[profileId]/loading.tsx` for it — `<AppShell busy>` with no athletes. The
  **frame** is held (that is what the `busy` placeholder is for, and it is what stops the column
  jumping), but the rail's **content** — the thing the user just clicked — blinks out and back for
  the length of the round trip. Layout-stable, so not a CLS regression; it is the eye's anchor
  disappearing.
- **Why it is not fixed in `UI-5`:** the cure is structural. A Next **layout** wraps `loading.js`
  and would hold the rail across the switch for free, but `UI-5`'s plan rejected a layout seam for
  recorded reasons (a layout cannot read the pathname, cannot pass data to children, and uncached
  data in one blocks navigation). The other option — a route group giving `/p` its own boundary and
  dropping the day-subtree fallback — trades the skeleton away on a slow connection.
- **Where it belongs:** `PICK-1` PR 4 adds the third grid track and is the next PR to touch this
  seam; the plan's § For PR 4 is the place to settle it.

### The archived-match → Restore path has no end-to-end test, because Playwright hangs on `/p/new` after an archive (added 2026-11-10)

- **What & why it's debt:** `PROF-1 a-1d` added a duplicate warning that offers **Restore** when the
  match is archived. Every tier below the browser covers it — `db:verify` proves the archived twin
  matches, reports `archived: true`, carries the stored spelling and loses to a live match; mutation
  patch `27` proves that arm is load-bearing; the unit suite proves the Restore button renders. ⚠️ **Those unit tests did not exist when this
  entry was first written** — the claim was false for a day, and a review lens caught it; they were
  written rather than the claim weakened. **What nothing proves is the click**: that Restore posts `restoreAthleteAction` and navigates to the athlete.
- **The observation, recorded so the next attempt does not repeat it:** after `archiveAthleteNamed`,
  loading `/p/new` leaves the kind radios **resolvable but never actionable**. `page.url()` and
  `locator.count()` answer normally; every call that evaluates page JS (`check`, `innerHTML`,
  `evaluateAll`) hangs until the test times out — reproduced at a 30s budget and again at 90s.
  Navigating via `/p` between the archive and the add screen did not clear it.
- **What is ruled out is the rendering; the cause itself is unexplained.** The same state under jsdom
  (an archived duplicate, `archived: true`) renders the Restore button in ~1s with no render loop, so
  the form is not looping. ⚠️ An earlier version of this line asserted the defect was "the
  interaction between the archive action's revalidation and a subsequent navigation under
  Playwright". That was a **guess stated as a finding** — nothing here measured it. The suspicion is
  worth keeping as a starting point (see the fix below), not as a conclusion.
- **Why it is filed rather than skipped:** a `test.skip` would sit in the suite looking like coverage.
  The e2e file carries a docblock naming exactly what is and is not proven instead.
- **The fix, when taken:** instrument what the page is doing in that window (a `pageerror`/`console`
  listener attached BEFORE the `goto`, or a trace) rather than guessing; suspect a pending RSC
  revalidation that never settles `networkidle`. If it proves environmental, drive Restore from a
  fresh context instead of continuing the archived session.

### A refusal on the add or rename form, submitted before hydration, re-renders a blank form (narrowed 2026-11-19; added 2026-11-10)

- **What was here, and what changed.** The entry recorded that an unhydrated submit of `/p/new`
  never reached its Server Action, cause unknown. **Cause found and fixed 2026-11-19**
  ([plan](./plans/td-form-before-hydration.md)): `Referrer-Policy: no-referrer` made browsers send
  the native POST with `Origin: null`, which Next's Server Action check refused. It is now
  `same-origin`, and `e2e/form-before-hydration.spec.ts` submits the add form with the chunks
  blocked. Four routes behave differently now: `/p/new`, `/p/[id]/edit`, `/p/[id]/routine` and
  `/settings`. The day page's log forms wrap their action in a client closure, so they always waited
  for hydration and are unchanged.
- **What is left:** a REFUSAL on add or rename, submitted unhydrated, re-renders the island fresh.
  The typed name is gone (the add's `name` starts `''`; the rename's seeds from the stored name), so
  the duplicate callout cannot match its folded name, and the form shows no message. Nothing is
  written. This is the state the reverted a-1d fix handled (`typed`/`chosenKind` on the envelope),
  reverted only because the POST never arrived; that reason is gone.
- **Smaller, harmless, recorded:**
  - a late-hydrating rename success runs `router.back()` to the pre-submit edit page;
  - an unhydrated archive on `/settings` gets no Undo or announcement (Restore still works);
  - an unhydrated add's `RedirectType.replace` is a plain redirect, so Back reopens `/p/new`, and
    the duplicate check is the backstop;
  - an unhydrated routine Save re-posts the server-rendered order (a no-op);
  - an unhydrated submit after the Clerk session token expires is refused and lands on `/sign-in`
    with nothing written, since clerk-js is what refreshes the token.
- **The fix, when taken:** restore the a-1d envelope seed (`typed`, `chosenKind`) for the add and
  the rename, each with an unhydrated e2e of its refusal. `profile-actions.ts` is owned by
  `write-path.md`.
- **Severity:** low (a refusal path, a slow phone, nothing written).

### The contrast helper composites translucent colour in the wrong space, so a "measured" border ratio is not the one a browser draws (added 2026-11-09)

- **What & why it's debt:** `apps/web/app/design/tokens/contrast.ts`'s `over()` blends alpha **in
  linear light** — its own docblock says so, and `luminance()` takes linear sRGB. Browsers composite a
  translucent border in **gamma-encoded** sRGB (and `color-mix(in oklch, …)` in OKLCH). For an opaque
  token the two agree; for a translucent one they do not, and the error is not in a safe direction:
  for a 28% foreground mix the helper reports ≈1.36 light / ≈6.03 dark where a browser draws ≈1.93 /
  ≈2.35 — i.e. it would **pass** a dark border that fails SC 1.4.11.
- **Why it surfaced:** `PROF-1 a-1`'s plan proposed a dashed add-tile border "at a measured ≥3:1
  foreground mix". The measurement would have been taken with this helper. a-1 side-steps it by using
  an **opaque** token, which makes the model moot — so this is recorded, not fixed, and nothing today
  depends on the translucent answer except the pinned hairline figure below.
- **Also affected:** `token-sets.test.ts`'s "hairlines miss SC 1.4.11 — 1.26:1 light, **2.69:1 dark**"
  pins a dark figure computed this way. The assertion (`< 3`) is still correct; the number in its name
  is not. ⚠️ Verify the arithmetic before editing it — the claim here is structural (read the two
  docblocks), the specific ratios are a reviewer's calculation.
- **The fix, when taken:** composite in gamma-encoded sRGB (or match whatever `color-mix` space the
  token uses), and re-derive the pinned figures.

### The day page has no static title, so every navigation onto it announces "mat-plan" (added 2026-11-09)

- **What & why it's debt:** `app/p/[profileId]/page.tsx` exports no `metadata`, so `document.title`
  stays the root layout's `APP_NAME`. Next's App Router announcer speaks the title **when it changes**
  — so a client navigation onto an athlete's day page announces _"mat-plan"_, and focus is left on
  `<body>`.
- **What it already costs:** `PROF-1 a-r`'s rename confirmation. `rename-form.tsx` reasons that the
  day page's `<h1>` (the new name) is the confirmation a screen-reader user gets on return; they do
  not hear it. `a-1`'s add has the same shape — a server redirect onto the same page.
- **The fix:** a static `metadata.title` such as "Today" — ⚠️ **never the athlete's name** (D8: a name
  in a title leaks into browser history, tab lists and screen shares). One line, but it is a day-page
  edit and belongs to whichever chunk next touches that file deliberately.

### An athlete with no logged months exports an empty zip, indistinguishable from a failed download (added 2026-11-08)

- **What & why it's debt:** `apps/web/lib/dal/export.ts` builds one entry per month that has rows; an
  athlete with none yields `buildZip([])`, which is a valid but **EOCD-only** archive — iOS Files
  opens it and shows nothing, and the person cannot tell that from a download that failed. Nothing
  says "there is nothing to export yet".
- **Why it surfaces now:** pre-existing since `V1-13b`, but `PROF-1 b` puts a **per-row export
  control** in Household settings beside the Archived list — exactly the athletes most likely to have
  no history (a typo'd row, a test profile someone archived rather than deleted). The control makes a
  dormant edge case reachable in one tap.
- **Found by:** the UX trust lens on `PROF-1 b`'s plan (2026-11-08), reading `export.ts` rather than
  the plan. Recorded there as `bB17`, deferred out of `b` deliberately: it is not `b`'s defect and
  fixing it means deciding what the export route should _do_ (a 204, a one-row CSV with headers, or a
  disabled control with a reason), which is a product call rather than a bug fix.
- **The fix, when taken:** decide the empty case once in the export route, and state it in
  [notice.md](./privacy/notice.md)'s "Getting your data out" section so the published promise matches.
  The cheapest honest version is to render the control **disabled with a reason** when the athlete has
  no months, which the settings page already knows.

### 🔴 PRIORITY — nothing measures how much JavaScript ships, and the CWV budget cannot be measured at all (added 2026-11-06)

_(maintainer, 2026-11-06: **priority item**, may be picked up in its own thread.)_

- **What & why it's debt:** AGENTS.md commits to a Core Web Vitals budget — **LCP < 2.5s · INP < 200ms
  · CLS < 0.1, p75 mobile** — and `review-pr`'s rubric dimension 11 already admits "nothing measures
  the budget". Two separate reasons it is unmeasured, and only one is fixable now:
  - **The budget is a RUM budget.** p75-over-real-users cannot be produced in CI, and **INP cannot be
    produced in a lab at all** — it needs real interaction. RUM is blocked behind
    `OBS-1`'s `connect-src` decision ([plan.md](./plan.md)), and at three households p75 of anything is
    noise anyway.
  - **Lab timings in CI measure CI.** LCP on a shared runner swings substantially between identical
    commits. A gate on it produces alerts you learn to ignore, which is worse than no gate.
- **What IS deterministic: bytes.** `next build` already prints **First Load JS per route**, and CI
  runs `pnpm build` (`ci.yml:362`) and **discards the output**. Nothing in the repo tracks bundle size
  — verified 2026-11-06: no `@next/bundle-analyzer`, no `size-limit`, no Lighthouse, no size
  assertion anywhere in `.github/workflows` or either `package.json`.
- **Impact — the three regressions this codebase actually produces, none of which anything catches:**
  1. **`'use client'` creep** — the mechanism by which an RSC-first app gets slow. ⚠️ **Live example,
     same day this was filed:** `components/layout/site-footer.tsx` became a client component
     (`usePathname()`) in `AUTH-1` 1d PR 0. Correct, necessary, reviewed — and the bundle cost was
     invisible to every gate.
  2. **A barrel file defeating tree shaking** — `export * from './x'`. A real risk as
     `packages/shared` grows; nothing flags it.
  3. **A heavy dependency on a hot route** — Recharts is planned for charts (AGENTS.md → Design), and
     the `/p/[profileId]` day page is the hottest route in the app.
     ⚠️ **Tree shaking and per-route code splitting are already ON** (App Router default + ESM; the
     minimal `next.config.ts` adds nothing that defeats them), so this is not a bundler setting anyone
     forgot. It is the absence of a _measurement_, and all three regressions above are habits rather than
     config.
- **Proposed fix** (sketch; it owes its own plan + panel, and the panel should push on the tolerance):
  1. Capture `next build`'s per-route **First Load JS** in CI — parse the build output, or
     `.next/app-build-manifest.json` plus chunk sizes if the printed table proves unstable to parse.
  2. Commit a baseline (`perf/bundle-baseline.json`), one entry per route.
  3. A guard fails the PR when a route grows beyond a tolerance, printing **route, before, after,
     delta**. The number is the deliverable — "this PR adds 48KB to the day page" is actionable in a
     way "LCP regressed" never is.
  4. Baseline updates are a **deliberate committed diff**, so growth is approved rather than drifted
     into — the `ALLOWLIST`-pinned-empty idiom (`pages-need-a-session.test.ts:321`).
  5. ⚠️ **It needs a self-test and a RED probe before it is trusted** — see
     [lessons.md](./lessons.md) → "Guards that pass while guarding nothing", where a CI gate silently
     enforced 3 of 13 paths for two releases because it had no self-test. A size guard that parses
     build output is exactly the shape that goes quietly vacuous when the output format changes.
- **Severity:** **medium now, high later.** Nothing is slow today and there is no evidence of a
  regression — the cost is that the budget AGENTS.md commits to is unfalsifiable, so the first real
  regression will be found by a person on a gym floor rather than by a gate. It gets worse with every
  client component and every chart. **Not a Beta 0 blocker** (not in `beta-1.md`'s exit criteria).
- **Deliberately NOT in scope:** Lighthouse CI, a canary deploy (meaningless at three households), and
  post-deploy CWV assertions — that last is `OBS-2`'s synthetic-monitoring job ([plan.md](./plan.md)),
  which answers "is the deploy broken", not "did the baseline move".

### Two runtime auth proofs went with the gate, and the harness cannot replace them (found 2026-11-05, AUTH-1 1d)

- **What & why:** the e2e harness arms a principal in the **process environment**
  (`E2E_SESSION_BYPASS_USER_ID`, snapshotted at module scope in `lib/env.ts`), so **no browser context
  in the suite can be unauthenticated.** While the gate existed that did not matter: the proxy bounced
  a cookie-less request, and three specs used that bounce as their witness. `1d` deletes it, and with
  it:
  - `e2e/landing.spec.ts`'s unauthenticated-action proof loses **variant 1** — the as-is replay, whose
    only protection was "the internal fetch meets the proxy without a cookie". After `1d` that fetch
    is bypass-authenticated, the Save action genuinely runs, and the spec's own tail assertion would
    redden. Variant 2 (spoofed `x-action-forwarded`) survives on its own premise.
  - `landing.spec.ts`'s "the app itself is still gated" is **deleted, not repointed**: the equivalent
    claim is "`/p` redirects to `/sign-in`", which this harness cannot establish.
  - `e2e/export-csv.spec.ts`'s "a request without the access cookie gets nothing" is **deleted**, and
    it is the one case that was caught by observation rather than reasoning: it went RED in
    `e2e:local`, because the export now correctly returns **200 with a real zip** to the
    bypass-authenticated request. Rewriting it to accept 200 would have inverted its own subject.
- **Impact:** production is **still protected** — the in-action `requireSession()` and the per-page
  `requireSession()` are unit-proved, and `app/pages-need-a-session.test.ts` asserts the call per route.
  What is lost is the **runtime** proof that an unauthenticated request does no work. 🔴 **Do not cite
  "no unauthenticated request reaches the DB" as a property this SUITE demonstrates any more** — it
  was cited that way in `docs/plans/ai-1-nl-logging.md`'s spend argument, and both halves of that
  evidence vanished in one diff.
- **Fix:** a **second, un-bypassed Playwright `webServer`** — one project whose server boots without
  the bypass variable, carrying only the specs that need a genuine stranger. ⚠️ Deliberately NOT done
  in `1d`: three review lenses independently found that a second server also proves the
  _dark-deployment_ branch rather than the one under test (the harness has no Clerk keys either), and
  it would break `test/bypass-is-contained.test.ts`'s pin on the exact set of sources naming the
  bypass variable — Playwright's `webServer.env` can only SET a key, so the config must name it.
  Design it against both constraints or not at all.
- **Interim:** `proxy.test.ts` pins the matcher's SHAPE (`has`/`missing` absent on the compiled entry),
  which catches the SEC-1 mutation at the config layer. It does **not** catch the exclusion being
  re-introduced at another layer — an early `return` in `proxy()` keyed on a header.

### The `mp_gate` tombstone is removable on 2027-02-04 (added 2026-11-05, AUTH-1 1d)

- **What & why:** `apps/web/proxy.ts` → `withRetiredCookies` appends a `Max-Age=0` `Set-Cookie` for
  `mp_gate` whenever a request still carries one, so a browser holding the retired gate cookie is
  cleared rather than left to expire.
  ⚠️ **The date is a convenience, NOT an expiry calculation, and an earlier draft of this row got that
  wrong.** It claimed no holder could remain past "the cookie's three-month-ish practical session
  horizon". There is no such horizon: the gate set `maxAge: COOKIE_MAX_AGE` = **one year**, and a
  browser keeps a `Max-Age` cookie for its full lifetime whether or not the site is visited (Chrome
  caps at 400 days). The last deploy that could set one was 2026-11-05, so a holder can still be
  sending it on **2027-11-05**. Removing the tombstone on 2027-02-04 therefore leaves some browsers
  carrying a dead cookie — **which is harmless, and that is the actual justification**: nothing reads
  `mp_gate`, no code branches on it, and its value was only ever a hash of a deleted secret. Pick the
  earlier date to delete the code sooner, or 2027-11-06 to clear every holder first; do not repeat
  the expiry claim.
- **Impact:** trivial. One `if` and one header append on matched responses where the cookie is present;
  nothing for an ordinary visitor (`proxy.test.ts` has the negative case).
- **Fix:** on or after **2027-02-04**, delete `RETIRED_GATE_COOKIE`, `withRetiredCookies`, its call in
  `proxy()`, and the tombstone cases in `proxy.test.ts` (no count here — `proxy.ts` says why). ⚠️ Deleting the function but leaving
  `proxy()`'s return unwrapped is the whole change — do not also narrow `proxy()`'s return type back
  to `NextResponse`, which is wrong for an unrelated reason (`withClerk`'s auto-proxy branch).

### `@clerk/nextjs` version citations drift silently across the tree (found 2026-11-05, AUTH-1 1d PR 0)

- **What & why:** roughly twenty comments and docs name the installed Clerk version in **present
  tense** — "at the pinned `7.9.15`", "not exported from any public entry at `7.9.15`" — and a
  Dependabot bump changes the lockfile without touching one of them. After #332 (7.9.19 → 7.9.22) the
  tree cited **three different versions at once**, and `docs/privacy/data-inventory.md` disagreed with
  itself between lines 21 and 391. Nothing catches it: the strings are prose.
- **Impact:** low severity, real cost. These citations exist precisely because the claims were
  _verified by reading the vendor's source_, so a reader who greps the version to re-check a claim is
  sent to a version that is no longer installed — which quietly devalues the one practice that made
  those claims trustworthy. It also makes a genuine vendor-behaviour change hard to date.
- **Fix:** a sweep is its own chore PR, not a rider on a UI change. Two options, cheapest first:
  (a) stop naming the version where the claim is version-independent and say "verified against the
  installed `@clerk/nextjs`"; (b) for claims that really are version-specific, a small `skills:check`
  -style guard that greps `@clerk/nextjs@<x.y.z>` in `apps/web/**` and `docs/` (excluding
  `docs/changelog/` and `docs/plans/`, which are **dated history and are not rewritten**) and fails
  when it disagrees with `pnpm-lock.yaml`.
- **Deliberately not done here:** PR 0 renumbered only the files it already touches
  (`lib/clerk.ts`, `lib/clerk.test.ts`, `app/layout.tsx`, this file), each claim re-read against
  7.9.22 first. The rest are listed above rather than swept.

### Clerk's browser runtime is fetched from a CDN at a floating major, so nothing in CI sees it (found 2026-10-16, AUTH-1 1a)

- **What & why:** `@clerk/nextjs@7.9.22` is pinned in `pnpm-lock.yaml`, but the code that actually
  renders the sign-in screen is **not in the lockfile at all**. `@clerk/shared`'s
  `clerkJSScriptUrl` / `clerkUIScriptUrl` build
  `https://<frontend-api-host>/npm/@clerk/clerk-js@<v>/dist/clerk.browser.js` and
  `.../@clerk/ui@<v>/dist/ui.browser.js`, and with no explicit version prop `versionSelector` resolves
  `<v>` to the **major** — `@clerk/clerk-js@6` and `@clerk/ui@1`. So the DOM, CSS, heading levels,
  focus rings and control heights of `/sign-in` can change **in production, between two identical
  deploys**, with no lockfile change, no PR and no CI run.
- **Impact:** two distinct holes, and they are not the same one.
  - **Supply chain:** `pnpm audit:check` is a CI gate (`.github/workflows/ci.yml`), and this is the one
    third-party code path in the app it cannot see. Named in the AUTH-1 plan § Design 6b item 7.
  - **A11y:** AGENTS.md requires ≥44px tap targets, focus-visible and a working 360px layout. For this
    screen those are **ours to specify and nobody's to verify**: CI has no Clerk keys, so
    `e2e/a11y.spec.ts` measures the dark fallback; `screenshot:ephemeral` injects no Clerk keys either;
    and the `a11y` Playwright project sets `bypassCSP`, so even with keys it would not be measuring the
    production policy. Not one a11y property of Clerk's card is pinned by anything in this repo.

    ✅ **Measured once, against the DEVELOPMENT instance, 2026-11-04** (`AUTH-1` 1d PR 0 — the lit
    panel `runbooks.md` had owed since 1a). Dated observations, not guards, because clerk-js floats:
    the Google button is **44.0px** so `elements`' `min-h-11` does land; Clerk's `<h1>` is in the DOM
    but `display:none`, so the a11y tree holds exactly one; there is no horizontal overflow at 360px;
    `:focus-visible` applies a real 3px ring. Two defects were found and fixed in that PR — the card
    rendered a fixed `width: 400px` against the page's 352px column (**48px of overhang** at 1280px),
    and the chrome this app briefly removed is now left alone (see below).
    ⚠️ **One failure stands, and it is the vendor's:** Clerk's "Secured by Clerk" attribution link is
    **48×14px**, under this repo's 44px bar _and_ WCAG 2.2 SC 2.5.8 (24×24). `elements` exposes no key
    for it and hiding Clerk branding is a paid-plan feature, so it is un-met in one named place rather
    than silently un-met. `lib/clerk.ts`'s `SIGN_IN_APPEARANCE` now pins what we _do_ control.
    🔴 **This app does NOT restyle the card, and that is a decision** _(maintainer, 2026-11-05)_. A
    first pass stripped its shadow, fill and padding and matched its button to the app's own. It
    worked — and the thing that actually makes the card read as foreign is the **"Secured by Clerk"**
    mark, whose removal is a **paid-tier** feature. Styling around a mark that stays buys a
    half-integrated component that every CDN build can break, for no gain. The PAGE is sized to the
    card instead (`page.tsx`'s `max-w-[432px]` against its 400px), and `SIGN_IN_APPEARANCE` is pinned
    to an exact set of four a11y keys so a cosmetic one added later has to argue for itself.
    **Reconsider only if the branding is ever paid for.**
    **Re-verify on the next `@clerk/nextjs` bump** — these numbers are a dated reading of a CDN build.
- **Why it was accepted:** the plan specifies Clerk's **prebuilt** component, the alternative
  (`useSignIn` + `signIn.authenticateWithRedirect`, our own markup) is a real option at this version but
  a different design decision, and 1a ships dark so nothing renders yet. Pinning `clerkJSVersion`
  explicitly would narrow the drift, but the props that do it are `__internal_`-prefixed at this
  version, which is its own debt.
- **The mitigations that DID ship in 1a**, so this entry is not "we shrugged": `appearance.elements`
  uses **class-name strings** (never a `CSSObject`, which the nonce'd `style-src` would drop silently),
  `cssLayerName: 'clerk'` with `@layer clerk` declared first in `globals.css` so Tailwind's utilities
  win the cascade, `min-h-11` on the Google button, and `app/pages-need-a-session.test.ts` pinning the exact
  set of `'use server'` modules `@clerk/nextjs` ships so a bump that adds one turns CI red.
- **Proposed fix:** (a) a **full three-lens UX panel on the lit screen** against the development
  instance, with captures at 360/390/820/1280 and a keyboard pass, before 1d retires the gate — it is a
  box on [runbooks.md](./runbooks.md)'s AUTH-1 checklist; (b) treat every `@clerk/nextjs` bump as its
  own reviewed PR, per [SECURITY.md](../.github/SECURITY.md)'s `claude-code-action` rule; (c) revisit
  the headless `useSignIn` option if the vendor DOM fights the a11y bar.
- **Severity:** medium (high for the a11y half once sign-in is live). **Payoff trigger:** configuring
  the Clerk development instance — i.e. before chunk 1c.

### The `movements` catalog verdict is restated in ~12 places, and TEN-2 has to retract every one (found 2026-10-09, TEN-1 1d review)

- **What & why:** TEN-1 1d's finding — `movements` has no `household_id`, so free-text catalog rows
  cross households and a refused write still commits one — was written out at length in a dozen
  places. The 1d review already had to correct the same overstatement (the indexes "built
  `CONCURRENTLY`") in several of them at once.
- ✅ **Mostly paid off by TEN-2a (2026-10-09), in the shape proposed below.** The statement now lives
  in **two** homes — `docs/plan.md`'s `TEN-2` row and `docs/privacy/data-inventory.md` §4 — and
  everything else carries a **pointer** instead: `docs/architecture.md`, the three feature guides
  (`write-path.md` ×3, `strength-logging.md`, `programming.md`), `docs/status.md`, `docs/roadmap.md`,
  `apps/web/lib/dal/catalog.ts` (×2 — missed by the first sweep's grep, and one of them sits directly
  above `findOrCreateMovementId`), `apps/web/lib/dal/entries.ts`, `apps/web/lib/dal/scoped.test.ts`,
  `packages/db/src/writers/movement-catalog.ts`, `packages/db/src/writers/ownership.ts` and
  `packages/db/scripts/mutations/README.md`.
- 🔴 **"So TEN-2b and TEN-2c each edit two files, not twelve" did NOT hold — corrected at TEN-2b
  (2026-10-10).** TEN-2b edited roughly a dozen of them, and the reason is worth keeping: **a
  "pointer" that embeds the status clause is not a pointer.** Every one of the files above said
  _"nothing reads or writes it"_ or _"is dark"_ **and then** pointed at §4 — so when the column woke
  up, each sentence was independently false and had to be edited anyway. The shape that would have
  worked is a pointer carrying **no status at all** (_"see data-inventory.md §4"_, full stop). Charged
  to nobody; the lesson is for the next arc that tries this, and TEN-2c inherits the same cost.
- ✅ **Paid off at TEN-2c:** `docs/decisions/0006-household-addressing.md` carries a dated superseding
  note, and the present-tense "until TEN-2c" sites were swept — each replaced with a status-free
  pointer or the two-window statement, so `TEN-2c-1` and `TEN-2d` do not inherit the sweep.
  ⚠️ **The prediction above was wrong twice:** it said 2b and 2c would each edit two files; 2b edited
  a dozen and 2c about fifteen.
  `docs/milestones/beta-1.md` were paid off by TEN-2b instead of 2c**: `SECURITY.md`'s was an
  exception bullet under _"These rules are MANDATORY"_ telling the next agent an unscoped write to
  this table was permitted, which stopped being true in the PR that scoped it, and `beta-1.md`'s sat
  in the sentence recording the go/no-go. ⚠️ Two files must **never** be edited for this:
  `docs/plans/ten-1-household-scope.md` and `docs/changelog/2026-10-08-…`, both kept as-merged.
- **Lesson for the sweep itself:** a literal single-phrase `git grep` **cannot** police text Prettier
  reflows — the sentence wraps mid-phrase in three files. The gate that works is phrasing-tolerant:
  `git grep -nEi 'no (\*\*)?.?household_id.?( column)?|carries no .household_id.|column at all' -- . ':!docs/plans/' ':!docs/changelog'`
  then eyeball the residue (`README.md`, `docs/programs/daily-five-default.md` and
  `docs/specs/v1-22-…` are known false positives — they are about other columns).
- **Severity:** low (docs drift), and now three copies rather than twelve.

### The comment-stripping `code()` test helper has TWO copies left, outside `apps/web` (found 2026-10-09, TEN-1 1d review; narrowed 2026-10-22, AUTH-1 1b-bis, and 2026-11-19)

- **What & why:** the same "comments out, strings kept" `code(file)` helper was defined separately in
  **five** places. `AUTH-1` 1b-bis extracted it to **`apps/web/test/source-scan.ts`** and converted the
  three copies it touched — `apps/web/app/pages-need-a-session.test.ts`,
  `apps/web/app/tenancy-is-not-cached.test.ts` and `apps/web/lib/dal/scoped.test.ts`.
- **What is left, and why each is still standing:**
  - `apps/web/lib/household-synthetic-is-dark.test.ts` imports the shared helper since 2026-11-19, so
    every copy inside `apps/web` is gone.
  - `packages/shared/src/test-support/source-graph.ts` exports its own `code` (the same two
    regexes), lifted there from `quantity-text.test.ts` by #531 for the shared package's graph guards.
  - `packages/db/src/scope.test.ts` — ⚠️ **not a straight conversion**: it is in another package and
    cannot import `apps/web/test/`. `packages/shared` is private and already has `src/test-support/`,
    so that is the natural single home, but `packages/shared` publishes only `"."`, so the other two
    packages would need a relative import or a new subpath export. **Decide that when it is next
    touched**, not here.
  - `apps/web/app/design/tokens/token-sets.test.ts` carries the same block-comment regex inline, which
    is a near-miss rather than a copy.
- **Impact:** these are the structural guards. A fix to the stripping (a `//` inside a string, a
  template literal) lands in one copy and not the others, so two guards can disagree about what is
  code. **Narrowed from five to two, one per package outside `apps/web`, plus the app's shared one.**
- **Proposed fix:** make `packages/shared/src/test-support/source-graph.ts`'s `code` the one copy,
  with `apps/web/test/source-scan.ts` and `packages/db/src/scope.test.ts` importing it, once a subpath
  export (or a sanctioned relative import) for test support is agreed.
- **Severity:** low.

### `profiles.birthdate` holds nothing and has no owner (added 2026-10-07, PRIV-1)

- **What & why:** `profiles.birthdate` has **no writer, no reader, no UI and no seed value** anywhere
  outside the migration that created it. A personal-data column about a minor that collects nothing is
  pure liability: the app never asks for a date of birth, but the public schema says it could, and the
  privacy notice has to account for it ([data-inventory.md](./privacy/data-inventory.md) §2).
  Data minimisation says drop it.
- **Not the same as its two neighbours**, which is why this entry names only one column:
  `profiles.pin_hash` is **reserved and owned** — `PROF-1`, under
  [ADR 0006](./decisions/0006-household-addressing.md) — so dropping it would contradict an accepted
  decision. `profiles.avatar` has no writer **but does have a live read path** (it is in the profile
  DTO and rendered by `profile-tile.tsx`), so it is a watch item rather than debt: a column already
  being read acquires a writer quietly, and what it would then hold is a picture of a child. The
  inventory's re-review triggers cover that case.
- **Why it is debt and not a quick fix:** dropping a column is a **contract migration** under
  expand→contract, and `docs/spec.md` §2 deliberately reserved it. So this is a **product decision
  against the spec**, not just a migration — the spec changes first, or the column stays and the notice
  keeps explaining it.
- **Severity:** low. It holds nothing today; the cost is the explaining.

### Copies of "announce in a status region, then move focus" (added 2026-10-02, V1-24 3a-ii)

- **What & why:** `saved-announcer.tsx` (deleted at V1-24 3b-life-a), `bodyweight-amend.tsx`, `editable-set.tsx` and the
  `StrengthForm` island each render an `sr-only` `role="status"` line and move focus by id or ref in
  an effect. What TRIGGERS each is deliberately different (B5: an island announces its own save,
  never a value diff), but the presentational half is copied.
- **Impact:** low; each copy is tested. A fix to one (e.g. clearing on open) has to be made four times.
- **Proposed fix:** PR 2 (check-ins) extracts the shared amend primitive (parent Decision 16); give
  it a small `useAnnounceAndFocus` hook and move all four onto it.
  ✅ **Half of the destination exists as of `PROF-1` a-r (2026-11-07): `apps/web/components/ui/announcer.tsx`.**
  It owns the REGION — the `role="status"` element and the mounted-while-empty rule — and deliberately
  **not** the trigger: the four copies differ in _what_ announces, and that difference is load-bearing
  (a value→value change, such as paging to a logged day, must not announce). The transition half is
  already single-sourced for action results, in `use-on-action-success.ts`.
  ⚠️ **The count is still four.** a-r is the component's first consumer and converted none of them, so
  this entry stays open; what changed is that there is now somewhere to move them to. a-1 and PROF-1 b
  are the next consumers.
  ✅ **Down to three (V1-24 3b-bw, 2026-11-16).** `bodyweight-amend.tsx`'s own region is gone: the
  bodyweight row reports to `single-value-live.tsx`, which renders `Announcer` once (with a
  `messageKey`, so a repeated message re-announces) and owns a single-use focus claim.
  ✅ **Down to two (V1-24 3b-life-a, 2026-11-16).** The Life row reports to the same island, and
  `saved-announcer.tsx` is deleted (it had no other consumer), leaving `editable-set.tsx` and the
  `StrengthForm` island.
  ⚠️ **"Announce the same sentence again" now has two idioms**: `Announcer`'s `messageKey` (3b-bw) and
  `components/day/day-screen.tsx` appending U+00A0 (FAM-1 13). The day screen is lane C's; it moves onto
  `messageKey` when that lane next touches it.
  ✅ **The day screen moved (FAM-1 12c, 2026-11-17)**: each announcement is a new `messageKey`, and
  `day-screen.test.tsx` proves a repeat is a new node with the same text. ⚠️ **One copy is left:**
  `components/day/program-order-dialog.tsx` appends U+00A0 too (13d). Its region is `Sheet`'s `status`
  prop (`components/ui/sheet.tsx`), which has no key, so moving it means adding one there. Lane C's,
  at 15c, which wires that dialog.
- **Severity:** low.

### A stale rename tab silently overwrites a concurrent rename (found 2026-11-07, #350 review)

- **What & why:** `renameProfile` (`packages/db/src/writers/profile.ts`) has no `expected`/version
  conjunct, so two devices — or one edit tab left open while someone renames from another — resolve
  last-write-wins by server clock. ⚠️ **It compounds with the deliberate no-history decision**
  (`PROF-1` a-r, 2026-11-07): the overwritten name is not recoverable from the app.
- **Impact:** low today — two to five people in a household, and renaming is rare. It rises with
  `COACH-1` (a second household's adult) and with any flow that leaves the screen open.
- **Proposed fix:** carry the seeded name as a hidden `previousName`, add `eq(profiles.name,
previousName)` to the UPDATE's `WHERE`, and map 0 rows to a typed _"this name changed on another
  device"_ refusal — the `updateBodyweightEntryById` `seenValue` idiom, which already exists. One
  more `db:verify` case and one more mutation patch. ⚠️ **It has a real cost to decide, not to
  assume:** a replayed submit after a success would then refuse rather than no-op.
- **Severity:** low. Deliberately deferred rather than built under review pressure — AGENTS.md's LWW
  rule is scoped to `/api/sync`, so there is no standing convention this violates.

### An image under `apps/web/public/` auto-skips the e2e smoke (demonstrated 2026-10-01, #208)

> ✅ **Closed by DX-18 PR 2:** `changed-scopes.mjs` treats an image as inert only under `docs/` or
> `.github/`, so an image under `apps/web/` runs the smoke and the build
> (`changed-scopes.test.sh` → "an image under apps/web/ is app content"). The entry is kept for its
> history.

- **What & why:** `.github/workflows/ci.yml`'s e2e auto-skip treats any
  `\.(png|jpe?g|gif|svg|webp|ico)$` file as provably inert. That was right while images were only PR
  comment attachments. It stops being right the moment an image is **served content**.
- **Demonstrated, not theorized:** #208 added `apps/web/public/brand/mat-plan-mark.{svg,png}` and the
  job logged `e2e smoke skipped (docs/tooling-only change — 5 file(s), all inert); job still reports
success.` Harmless there — nothing referenced the files yet.
- **Impact:** medium, and **latent until OSS-2 §B**, which puts an image on the public landing page.
  After that, a PR that swaps only the hero PNG changes what every unauthenticated visitor sees and
  skips the smoke entirely.
- **Proposed fix:** exclude `apps/web/public/` from the inert allowlist (keep `.screenshots/` and
  `docs/` images inert). Scheduled in OSS-2 §B ([plan](./plans/oss-2-public-landing.md)).
- **Severity:** medium. **Payoff trigger:** OSS-2 §B, or any earlier PR that renders a `public/` asset.

### Test-time path overrides are ad-hoc, so gates quietly go vacuous (audit, 2026-09-24)

- **What & why:** there is **no consistent way to force a code path for a test**, so each one invents
  its own — and when a path cannot be reached, the test tends to **skip or pass vacuously rather than
  fail**. Three live instances, all found the same week:
  - **The scaffold a11y check self-skipped 4 days in 7.** It ran only when the seeded program had
    movements _today_ (Mon/Wed/Fri), so GAP-3 PR 4a shipped without it ever running. Worse, the skip
    conflated "not a programmed day" with "the button regressed" — a real regression on a Monday would
    have gone green. Fixed in #141 by **shifting the Playwright context timezone** to reach an adjacent
    programmed day, which works only because every unprogrammed day happens to be adjacent to a
    programmed one and a tz can move a date by exactly ±1. It is a workaround, and it is the _good_
    case, because at least it is deterministic.
  - **`expectTapTargets` skips invisible controls** (`a11y.spec.ts`), so anything behind a disclosure
    passes without being measured. A collapsed UI can be entirely broken and green.
  - **`INTERACTIVE` excludes `<a>`**, so any control built from `<Link>` is measured by nothing —
    which is exactly what V1-15's day arrows and week strip are.
- **Impact:** high, and **silent** — the failure mode is a green check that proves nothing, which is
  strictly worse than no check, because it is trusted. This is the same class as the five CI gates
  AGENTS.md claimed for months that did not exist.
- ✅ **One instance CLOSED 2026-09-29:** `packages/**` was covered by no test runner at all — `pnpm test`
  is `pnpm --filter web test`, so a test beside shared or db code shipped green **without executing**.
  `apps/web/vitest.config.ts` now includes `../../packages/*/src/**/*.test.ts`. Two lines, and it was
  safe precisely because there were zero such tests to break. The other instances below stand.
- **The audit:** walk every gate and ask **"can this go vacuous, and would anyone notice?"** Then give
  the app **one deliberate seam for test-time path selection** instead of per-test cleverness — a
  seeded fixture that covers every weekday, an explicit day override (V1-15's `?d=` is the first real
  one), and a rule that a gate **fails rather than skips** when its precondition is unmet.
- **Payoff trigger:** V1-15, which lands `?d=` — the first honest override and the natural moment to
  do the sweep. Any new `test.skip()` on a precondition should be treated as a finding until then.

### Several files have outgrown their shape; shared values are re-derived per call site (audit, 2026-09-24)

- ⚠️ **Re-measured 2026-11-07: `verify.ts` is now 7,213 lines, 26 commits in six weeks** — it more
  than doubled under this entry. **`DX-12` was planned and PANELLED against it and is DEFERRED, with
  the reasons in [its plan](./plans/dx-12-verify-suites.md)'s review-response log.** Read that before
  attempting the split: five lenses found that the `✓` output diff **cannot see a dropped assertion**
  (the script is fail-fast, so a deleted assert changes zero bytes), that mutation patch `02` patches
  `verify.ts` itself so "13/13 unchanged" is unachievable, that `B_SCOPE` is minted ~3,700 lines in
  and so cannot move to a bootstrap, and that **three** guards hard-code this path, not one. 🔴 It
  also found the split would **not** unlock parallel lanes — `docs/milestones/crud-1-fix-it-yourself.md`'s
  2026-10-23 gate run already concluded _"gate 1 fails for every pair, on the guide alone"_. The
  trigger below still stands; the next attempt starts from that log, not from scratch.
- **What & why:** growth has concentrated rather than spread, and the big files are where reuse gets
  missed. `packages/db/scripts/verify.ts` was **~3,000 lines** of sequential proofs with assertion
  helpers (`expectRejectedBy`, `columnsOf`, `assertCheckCoversConst`) that had to be _rediscovered_
  mid-edit; `apps/web/app/p/[profileId]/page.tsx` is ~390 lines doing profile resolve, day derivation,
  five reads and the whole render; `strength-form.tsx` is ~660. Concrete symptoms already paid for:
  - **A bidirectional reference-table parity loop was open-coded twice** before `assertRefTableMatches`
    was extracted (GAP-3 PR 3).
  - **`unitsOfDimension` and `UNIT_LABELS` sat unused** while a plan proposed hand-writing both
    (caught by a panel, GAP-3 PR 4a).
  - **`resolveDeclaredDay` was about to be duplicated** as a second near-identical day resolver in a
    different directory (caught by a panel, V1-15).
  - **"Untouched card" is computed in THREE places** from the same fields; PR 4a had to extend all
    three, and missing one silently deletes an athlete's logged set.
- **Impact:** medium, compounding. Nothing is broken; the cost is paid per change, as research time
  and as near-miss duplication that only a panel catches. The **feature guides** (#140) treat the
  symptom — they tell you the map — but the map is large because the files are.
- **The audit:** for each file over ~300 lines, ask what would split cleanly along a seam that already
  exists (the day-view vs the forms; the proof groups in `verify.ts`), and sweep `packages/shared` for
  exports with **zero callers** — each is either a missing reuse or a deletion.
- **Explicitly NOT a rewrite.** Split only where a change is already coming, so the move rides a PR
  that has to touch the file anyway. A refactor-for-its-own-sake PR at ~4h/wk is the wrong trade, and
  a big mechanical diff is the hardest kind to review.
- **Payoff trigger:** the next PR that touches one of the named files. V1-15 touches `page.tsx`.

### A labeled set can't be edited, and a duration isn't structurally queryable (GAP-1 P0-2)

- **What & why:** GAP-1 P0-2 made `entry_sets.weight_label` writable, so a set can finally record `BW`,
  `band`, `30in` or `30s` instead of the lie of `weight: 0`. Two knowingly-accepted consequences:
  - **A labeled set has no inline edit.** `isEditableSet` excludes it (an edited `weight_num` would be
    masked at the read seam, since `formatSetLine` prefers the label) and `updateStrengthSetById` refuses
    it in SQL. So a mistyped `BW` can only be fixed by deleting the entry — which needs **V1-9b**
    (delete/clear-day), not yet built. Mitigated by the chips: the common labels are one tap, not typed.
  - **A duration lives in `weight_label` as `30s`, not in `entry_sets.seconds`.** That column stays
    unwritten. It reproduces the CSV exactly (the contract puts duration in the `load` column), but the
    value is text, so nothing can sum time-under-tension.
- **Impact:** low. Labels are a minority of sets, and the chips make the common ones un-typoable.
- **Proposed fix:** V1-9b closes the edit gap. `seconds` gets written when something queries duration
  structurally — **V1-16 progress charts is the promotion trigger**; at that point a timed set writes
  both `seconds` and the label (the two columns are deliberately not mutually exclusive — see below).
- **Severity:** low (accepted; both have named triggers).

### `weight_num` and `weight_label` are deliberately NOT mutually exclusive (GAP-1 P0-2)

- **What & why:** no CHECK enforces "exactly one of". That is a decision, not an oversight. Several real
  loads carry a recoverable number inside a text form — `123 (50ft)`, `30 (2x 15 DB)`, `BW+8 (vest)`. A
  later slice should store **both** (`weight_num = 123` _and_ the label) so volume charts aren't blind to
  them, and the read seam already prefers the label while the edit guard already refuses any labeled set,
  so coexistence is pre-defended.
- **Impact:** none today — the writer emits exactly one. The cost is that a future reader must not assume
  exclusivity.
- **Proposed fix:** implement numeric-prefix extraction when V1-16 needs the volume. **Do not add a
  mutual-exclusion CHECK** — it would be a breaking migration and would foreclose the above.
- **Severity:** informational.

### `/api/sync` must land rate-limited (the mutating actions are since `AUTH-1` 1c-3b, the zip export since 2026-11-19)

- **What & why (V1-14a):** V1-14a rate-limits only the **access gate**. The **seven** mutating Server
  Actions in `app/p/[profileId]/actions.ts` — **and the zip export route, so a full training-history
  download is unthrottled too** (both counted by PRIV-1, 2026-10-07; this entry said "six" and omitted
  the export until then) — are deliberately unlimited, because there is nothing meaningful to
  key a limit on yet. Their only identifier is `profileId`, read from `formData.get('profileId')` —
  caller-supplied and unauthenticated. An attacker rotates a fresh UUID per request for a fresh bucket;
  worse, real ids are non-enumerable UUIDv7 (SECURITY.md's anti-IDOR design), so an attacker cannot land
  in a real bucket even by accident. Such a limit would constrain **only the household**, while adding a
  Redis round-trip to every tap on the gym floor (an INP cost against the ADR-0001 budget).
- 🔴 **Half paid at `AUTH-1` 1c-3b (2026-11-01).** The seven mutating Server Actions are now limited
  on the Clerk principal (`checkMutationLimit`, 120 / 5 min), placed after the session check and
  **before** the zod parse, so an unauthenticated flood costs zero Redis and zero DB work.
- ✅ **The export half paid 2026-11-19** (the FAM-1 export follow-up,
  [plan](./plans/fam-1-export-owner-only.md) PR A): `checkExportLimit`, 30 / 10 min on its own
  `mat-plan:export` key, checked after the route's session and profile checks. ⚠️ **This row used to
  say "deferred to `1c-4` PR 4".** No such PR existed: 1c-4 shipped without touching the route, and
  the export stayed unlimited until this follow-up.
- **Impact:** low today. Reaching these actions takes a Clerk session with a household membership,
  re-checked inside each action (the gate cookie this line also named went at `1d`). The app is a single household on an unlisted URL. Since
  2026-11-19 the export is limited too, so nothing is left on the surfaces this entry counts (the
  mutations and the export). Page reads and the how-to Route Handler were never in it. Annoying, not dangerous, and visible in the log.
- **Proposed fix:** ✅ **the mutations half shipped at `AUTH-1` 1c-3b**, keyed by Clerk user id through
  **`checkMutationLimit`** — a second instance of the same fail-open seam, with its own
  `mat-plan:mutate` prefix, not `checkRateLimit` itself — exactly as AGENTS.md's rate-limit line ("auth + mutations +
  `/api/sync`") presumes. ⏳ **What is left:** `/api/sync`, which should
  land limited from day one — the batch flush is the genuine amplification endpoint.
- **Severity:** low, and nothing on today's surfaces. What remains is `/api/sync`, which is not a
  surface yet; the seam and its contract already exist.

### Sentry ships without source maps, so stack frames are minified (V1-14a)

- **What & why:** `next.config.ts` sets `sourcemaps.disable: true` and `pnpm-workspace.yaml` sets
  `'@sentry/cli': false`. Uploading source maps requires `@sentry/cli`, whose postinstall pulls a ~20MB
  binary into **every** install including CI (which never uploads) — the same complaint already logged
  against `@embedded-postgres` below — and would make a production build depend on that binary plus an
  auth token.
- **Impact:** Sentry stack traces point at bundled/minified frames. Diagnosis is slower, not impossible;
  server frames retain function names reasonably well.
- **Proposed fix:** flip BOTH switches together and add `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/
  `SENTRY_PROJECT` — worth doing the first time a real incident is hard to read, not before.
- **Severity:** low (a legibility cost on a 3-user app).

### Local/CI parity gaps (measured 2026-09-24; e2e gap closed 2026-09-23)

- **What & why:** following the [CI gate audit](#) below, every check was actually run locally and timed.
  **`pnpm verify` now covers the fast set in ~25s** (`format:check` · `lint` · `typecheck` · `test` ·
  `db:verify` · `audit:check`), and **`pnpm e2e:local` now runs the Playwright smoke** (the gap that
  actually mattered — see below). Two gaps remain, both by choice:

  | Gap                                 | Cost to close | Notes                                                                                                                                                                                       |
  | ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **`next build` is not in `verify`** | Zero          | Deliberate: it is the slowest step and CI runs it. Run `pnpm build` manually when touching anything build-shaped. (`e2e:local` builds it as a side effect, so a smoke run covers this too.) |
  | **gitleaks / forward-only guard**   | n/a           | gitleaks is installable locally (and is, here); the forward-only guard is inherently a diff-against-base check and has no meaningful local form.                                            |

- **CLOSED — the Playwright smoke now runs locally (`pnpm e2e:local`).** `playwright.config.ts`'s
  `webServer` builds and starts the app but provisions **no database**; it inherits `DATABASE_URL`
  (→ `.env.local` → live Neon), which is why the smoke was CI-only. `apps/web/scripts/e2e-local.ts`
  supplies the missing piece the same way CI does — boot a **Dockerless** `embedded-postgres` (the
  existing `scripts/embedded-pg.ts` helper, already behind `dev-local` and `screenshot:ephemeral`),
  migrate + seed it with the `packages/db` scripts, then run `playwright test` with that DB, a local
  gate code and a free port injected — and deletes the cluster on exit. **This supersedes the
  long-standing "e2e needs real Postgres, can't run locally" assumption** (true before the embedded-pg
  work, #43/#46). Residual, accepted: it is a **throwaway** Postgres 18 cluster, not CI's `postgres:17`
  service container, and the run costs minutes (it builds the prod app), so it stays out of `verify`.
- **Impact:** low — the remaining two gaps are a deliberate speed trade and a check with no local form.
- **Severity:** low.

### 20 pre-existing Squawk findings on `main` are never linted (accepted 2026-09-24)

- **What & why:** Squawk (GAP-3 PR 1b) lints **added migrations only**. All-files is not viable — 20
  findings remain across 6 migrations already on `main`, and Squawk has **no baseline or suppression
  feature**, so an all-files gate would be red on arrival and get disabled rather than fixed.
- **Are they bugs? Mostly no.** `0009`'s own comment names the Squawk objection and justifies it: the
  column is created in the same statement, so every existing row is NULL, `NULL in (...)` is NULL, and a
  CHECK passes on anything but FALSE — the validating scan reads rows that cannot fail, on a few dozen
  rows. `0008`'s is on still-empty V1-10 tables. These were reasoned, not missed.
- **Impact:** low, but the gate **silently implies `main` is clean**, which it is not. Recorded so that
  implication is not mistaken for a fact.
- **Also still unenforced:** `require-concurrent-index-creation` is excluded, because `CONCURRENTLY`
  cannot run inside drizzle's migration transaction (one for all pending files) and the transaction-stripping runner AGENTS.md
  describes **does not exist**. So AGENTS.md's "Indexes CONCURRENTLY" rule remains review-enforced only.
- **Severity:** low.

### The Neon-branch migration apply is the last unwired CI gate (audit 2026-09-23)

- **What & why:** the DB-safety reviewer on GAP-3's panel checked the plan's claim that _"Squawk hard-fails
  a `DROP COLUMN` alongside app code"_ and found **no Squawk in CI at all**. Auditing the rest of
  [AGENTS.md](../AGENTS.md)'s required-checks list against `.github/workflows/` turned up **five** gates the
  rules claimed and the workflows never had. Four have since been wired; **one is left**:

  | Gate AGENTS.md claims                                           | Reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
  | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | format · lint · typecheck · test · build · gitleaks · e2e       | ✅ present (`format:check` and `pnpm build` are the prettier/next-build steps — easy to miss by name)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
  | DB **drift guard** + `db:verify`                                | ✅ present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | **Forward-only guard** (blocks `M` on `packages/db/migrations`) | ✅ wired — `ci.yml` `quality`, PRs only (#134)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
  | **Squawk** migration lint                                       | ✅ wired — `ci.yml` `quality`, added migrations only (#135)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | **`pnpm audit`** (fail high/critical)                           | ✅ **wired — SEC-5** ([plan](./plans/sec-5-verify-in-ci.md)): `pnpm audit:check` runs in `ci.yml`'s `quality` job on **every PR and every push to `main`**, after the install, and its self-test runs before it. The rule is stated once, in [SECURITY.md](../.github/SECURITY.md) → Supply chain. It was local-only for the two weeks after this audit, and in that window **four** advisories reached `main` with CI green — `next` RCE (GHSA-vcvr-r3jv-pc5j, #182), `source-map-js` DoS (GHSA-68fv-2mgg-jv7q, #222), `fast-uri` + a critical `proxy-addr` (#227), `sharp` → librsvg (GHSA-wq5f-xc86-pv6w, #235) — **every one found by accident** during unrelated work, never by a gate. The gap was the gate, not the advisories |
  | **CodeQL**                                                      | ✅ wired — `codeql.yml`, but **not a PR check** (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | **Neon-branch apply** on PRs                                    | ❌ **still absent** — `migrate.yml` runs only on merge to `main`, and (since `OPS-2` PR 1) fails if `PROD_DATABASE_URL_UNPOOLED` is unset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

- **What CodeQL being "wired" does and does not mean.** `codeql.yml` runs `javascript-typescript` over the
  whole workspace on **push to `main`, weekly (Mon 06:17 UTC), and `workflow_dispatch`** — deliberately
  **not** on pull requests, because a minutes-long scan on every <400-line PR is the wrong trade at ~4h/wk.
  So a green PR proves nothing about CodeQL, and findings only ever appear in **Security → Code scanning**.
  Two live caveats:
  - **Unverified precondition: this is a PRIVATE repo on a personal account.** Code scanning needs GitHub
    Code Security (Advanced Security) there; `GET /code-scanning/default-setup` currently returns
    `403 Code scanning is not enabled`, which is the same response for "not licensed" and for "not
    configured yet". If the plan does not include it, the `analyze` step will fail on the **first push to
    `main` after merge** with "Advanced Security must be enabled" — loudly, and blocking nothing. That
    first run is the real test; until it is green, treat CodeQL as claimed-not-proven.
  - **No `pnpm install` before extraction**, so cross-package `@mat-plan/*` imports are not resolved and
    dataflow does not reach across workspace boundaries. Deliberate: it keeps a minute and a lockfile-drift
    failure mode out of a weekly job, for reach a 3-user app does not need. Revisit if a finding is ever
    obviously truncated at a package seam.
- **Impact of the remaining gap:** a migration's first real execution is still **on production**. The
  drift guard, `db:verify` (PGlite), forward-only and Squawk all run pre-merge, so the shapes that were
  genuinely dangerous are now caught; what is missing is the prod-shaped rehearsal — a migration that is
  valid SQL, passes Squawk, and still fails against real data/row counts would not surface until merge.
- **Why it went unnoticed:** the rules were written as the intended end state and never re-verified.
  `db:verify` and the drift guard _are_ real and genuinely good, which makes the DB section read as
  covered at a glance. The lesson generalizes: **do not cite a gate without opening `.github/workflows/`.**
- ⚠️ **Re-scope the proposed fix before building it (OPS-1, 2026-10-07).** It branches from `main`,
  i.e. **production** — which with a second family would clone their data into a database CI can
  reach, the exact shape [OPS-1](./plans/ops-1-preview-isolation.md) rejected for previews. When this
  is built it must branch the **`mat-plan-preview`** project or use an anonymized snapshot. The
  rehearsal value (real row counts) is partly lost that way, which is a trade to make deliberately.
- **Proposed fix:** a PR job that cuts a Neon branch from `main` and applies the migration against it
  (the one gate AGENTS.md → "Local hooks vs CI merge-gates" still lists as NOT wired). Needs a Neon API token in repo secrets and a
  create/delete branch step — the reason it has been deferred is credentials plus per-PR cost, not
  difficulty. Trigger: the first migration whose risk is **data-shaped** (a backfill over real row counts)
  rather than shape-shaped — GAP-3's backfill step is the candidate.
- **Severity:** medium — the highest-value DB gates now exist; this is the remaining one, and it is the one
  that costs money and a token rather than a workflow step.

### The `day_role` schedule is a hardcoded app const, not data (V1-10 slice 2)

> 📐 **Shape decided: [ADR 0007](./decisions/0007-scheduling-model.md).** The weekday set becomes rows
> on a block↔athlete assignment; the rotation anchor and ordered list go on `program_blocks`. Promoting
> the resolver to `packages/shared` **retires this row's "nothing in the DB or engine may depend on it"
> clause**, because `db:verify` will run the identical function the app does.

- **What & why (V1-10 slice 2):** which `day_role` a calendar day programs lives in
  `apps/web/lib/programming/day-role-schedule.ts`. ⚠️ **Corrected 2026-10-07:** this row described it as
  a Mon/Wed/Fri weekday map named `DAY_ROLE_BY_WEEKDAY`; that const was **deleted in #151** and the live
  mechanism is `resolveDayRole`, **epoch-day parity** over every calendar day with no rest day
  (`:41-43`). The debt is unchanged — it is still one hardcoded const for the whole installation — but
  the shape was wrong, and ADR 0005's panel finding R1 corrected the same stale name elsewhere. The
  schedule genuinely belongs on the
  `program_block` (a block _is_ a weekly plan), but a `block_schedule` table would ship a migration plus an
  authoring UI for data exactly one household can author, in a slice whose whole point was "no migration".
  So it is app **policy**, deliberately in `apps/web` and not `packages/shared` — it is not part of the
  cross-boundary contract, and nothing in the DB or engine may depend on it.
- **Impact:** low today (one household, one block, a split that hasn't changed). Two real limits: a second
  household would silently inherit Ray's split, and changing a training day is a **code change + deploy**,
  not an edit. There is no override affordance either (the panel deferred the `?strengthDay=` selector), so
  lifting Strength B on a Tuesday shows no card — the coach just types the movements, today's behavior.
- **Proposed fix:** ~~**Clerk / multi-household (v1.5)** is the promotion trigger.~~ **Amended 2026-09-18
  — the trigger is now whichever of Clerk or MOT-1 lands first.** MOT-1's streak has to know what is
  **due** on a given day or it breaks on a correctly-taken rest day, and that needs the same schedule
  rows — for a **single** household, with no Clerk involved. Folded into **SCHED-1**
  ([plan.md](./plan.md)), which treats scheduling as one primitive serving this const, `routine_config`'s
  missing schedule, and the streak. Original reasoning, still correct as far as it went: Clerk /
  multi-household (v1.5) is the promotion trigger. At that point the map
  becomes per-block schedule rows (or a `program_blocks.schedule` column), `resolveDayRole` takes the
  block, and this const is deleted. If a day-role override lands before then it must validate against the
  **strength subset only** (`DAY_ROLE_TO_SESSION_TYPE[x] === 'strength'`), never all of `DAY_ROLES` — else a
  conditioning role could be forced into a strength session.
- **Severity:** low (accepted for the pre-Clerk single-household deployment; same class as the access gate).
- **Related, same slice — the card can shift layout on first paint (CLS).** `getActiveTimeZone()` falls
  back to `DEFAULT_TIME_ZONE` until `TimeZoneSync` writes the `tz` cookie and triggers `router.refresh()`
  (V1-6c). For a device in a zone whose local weekday differs at that moment, the first paint can resolve a
  different `day_role` — so this ~150px card can appear or disappear above the strength form after
  hydration. Inherited from V1-6c, but the card is a much larger shifting block than anything V1-6c
  introduced, and CLS < 0.1 is a stated budget. Harmless for Ray's household (one zone, cookie set after
  the first visit). **Fix when it bites:** reserve height for the card, or resolve the zone before first
  paint (a `middleware` hint) — the same change that would remove the V1-6c refresh flash generally.

### Coach routine editor: no real authz, and two accepted write semantics (V1-18 PR 2)

- **What & why (V1-18 PR 2):** the routine editor (`/p/[profileId]/routine` + `editRoutineAction`) ships
  behind the access-gate stopgap with **existence-only** ownership (re-resolve by `public_id`), like every
  other writer — profile tiles are "a UX switch, not a security boundary" (AGENTS.md). So ANY gate-holder can
  edit ANY kid's routine. **Updated V1-23 (2026-09-26): it is no longer URL-only** — Today now renders an
  `→ Edit {name}'s routine` link below the logged-entries list, so anyone past the access gate reaches the
  editor in one tap. The obscurity was never a security control, so nothing regressed; but the sentence this
  entry used to carry ("reachable by URL only … limits discoverability") is now false, and the mitigation it
  implied is gone. **The gap was knowingly accepted when the link shipped**: there was no Clerk then (it
  landed at Beta 0; ownership becomes membership-derived at `AUTH-1` 1c-4),
  the household is three people behind one shared access gate, and the alternative — leaving the coach
  affordance undiscoverable to make a BOLA hole feel smaller — is security theatre that costs the feature.
  Two write semantics are also accepted, not bugs:
  - **Default-freeze (panel C4):** a kid whose `routine_config` is `NULL` renders the live default; saving
    from the editor **materializes** that default into the column, so the kid stops auto-tracking future
    catalog additions (a new check-in won't appear in their now-frozen order). Authoring a routine is an
    explicit opt-out of default-tracking.
  - **Last-write-wins clobber (panel C6):** the write is an unconditional `SET routine_config = …` with no
    client-`updated_at` LWW guard, so a stale second tab clobbers the first. No race with the kid logging on
    Today — that writes the `entries` table, a different column.
- **Two sharp edges the V1-23 link now EXPOSES to whoever finds it — deliberately not fixed there:**
  - **A kid can remove `strength` itself and make the session unloggable, with nothing on screen saying
    why.** `strength` is the first entry in `ROUTINE_CATALOG` and gets a `Remove` button like any other
    row; Today's strength block is routine-DRIVEN, so dropping the key removes the program card **and**
    the whole strength form. The kid then sees a Today with no way to log their session and no
    explanation — the failure is silent and looks like a bug, not a setting they changed.
  - **`Remove` fires with no confirm, and re-adding APPENDS — so the authored order is unrecoverable.**
    `toggle()` (`apps/web/lib/routine/editor.ts:19-23`) filters on remove and `[...order, item]` on
    re-add, so a mis-tapped `Remove` + `+ Add` puts the row at the BOTTOM; the only way back is the
    ▲▼ buttons, one step at a time. There is no undo and no "restore default routine".
  - **Fix when it bites:** a confirm (or undo) on `Remove`, a "Restore default routine" button, and
    either pinning `strength` or an empty-state on Today explaining that strength is off this routine.
    Ray deferred all three when the link shipped (V1-23 PR 2); use the app for a week first.
- **Impact:** low today (single trusted household, pre-Clerk, occasional edits). The BOLA gap is the real
  item; the two semantics are edge cases a single coach won't hit. The two sharp edges above are newly
  **reachable** as of V1-23 — still low (one coach, three kids), but no longer hidden behind a URL.
- ✅ **The authz half is closed at `AUTH-1` 1c-4 (2026-11-03) — the row is NOT.**
  `updateProfileRoutine` already wrote through `isLiveProfile(publicId, scope)`, so
  membership-derivation is what turns that scoping into authorization: a caller holding the access
  code but no membership in this household can no longer reach any kid's routine. ⚠️ **Three things
  this did not close.** (a) _"ANY gate-holder can edit ANY kid's routine"_ is still true **within one
  household**, and deliberately — profile tiles are a UX switch, not a security boundary (AGENTS.md).
  (b) The two accepted write semantics above (default-freeze, the LWW clobber) are untouched. (c) The
  two sharp edges V1-23 exposed are untouched and still deferred. So the heading's _"no real authz"_
  is what changed; the rest of this entry stands as written.
- **Proposed fix (as written):** **`AUTH-1` 1c-4** closes the authz gap — not "Clerk v1.5": Clerk landed at Beta 0
  and `1c-3b` already requires a session here; 1c-4 is what derives the scope from the principal. Scope
  the DAL read + write by `household_id` (the
  ownership seam every writer already re-resolves through). The LWW clobber is paid down with the offline/sync
  LWW work (same `incoming >= stored` guard as the set-edit debt above). Default-freeze resolves naturally if
  the editor gains a "reset to default" affordance or the write skips a no-op-vs-default save.
- **Severity:** low (accepted for the pre-Clerk single-household deployment).

### `embedded-postgres` downloads a Postgres binary on every install, incl. CI that never uses it

- **What & why (PR #43; extended by chore/local-dev-db):** the ephemeral-DB screenshot flow
  (`apps/web/scripts/screenshot-ephemeral.ts`) and now the default local-dev launcher
  (`apps/web/scripts/dev-local.ts` — `pnpm dev`) both use `embedded-postgres` (a **dev** dependency) so
  neither a screenshot nor local play touches live Neon. Its platform package
  (`@embedded-postgres/<os>-<arch>`) fetches a real Postgres binary in a `postinstall` (allow-listed in
  `pnpm-workspace.yaml`). Pinned to a **beta** (`18.4.0-beta.17`). (Two consumers now — the tool is no
  longer manual-only, which slightly raises the value of keeping the binary available, but the CI
  install-cost concern below is unchanged: CI still never runs either flow.)
- **Impact:** every `pnpm install` — including the CI `quality` and `e2e` jobs, which provision
  Postgres via a **service container** and never invoke this tool — pays the binary download. Wasted
  install time/bandwidth for a manual-only, developer-facing utility. Low correctness risk.
- **Proposed fix:** make the binary fetch **on-demand / optional** rather than install-time — e.g.
  gate the `postinstall` off a CI env flag, move `embedded-postgres` behind an optional-dependency or
  a `pnpm install --filter` boundary the screenshot script triggers itself, or lazy-install on first
  `screenshot:ephemeral` run. Also **drop the beta pin** once a stable `embedded-postgres` releases.
- **Severity:** low (works today; purely an install-cost optimization).

## EntryDTO is a wide denormalized row-DTO (per-kind split deferred)

- **What:** `EntryDTO` (`apps/web/lib/dal/entries.ts`) has grown ~13 nullable fields across V1-4/5/6a/8-3
  (metric ×4, activity ×2, session ×3, superset ×2). Most are NULL for any given row kind (a bodyweight row
  carries no session/superset fields, etc.). Each V1-8-3 slice added its pair additively — the established,
  scope-disciplined pattern, but the denormalization now visibly compounds.
- **Impact:** low — correctness is fine (nullable + read at the right seam); it's a legibility/shape smell.
  The grouped `SessionItem`/`SessionRow` already re-hoist session/superset identity to the item level while
  members still carry the columns (mirrors 3a).
- **Proposed fix:** a per-kind discriminated DTO (`BodyweightDTO | StrengthDTO | CheckinDTO | …`) once the
  read surfaces stabilize (post-V1-8), so each row carries only its own fields. Deferred — not worth churning
  the last V1-8 slice.
- **Severity:** low.

## Set-edit LWW uses server-`now()`, not the client-supplied timestamp (V1-9)

- **What:** `updateStrengthSetById` (`packages/db/src/writers/strength-session.ts`, V1-9) advances
  `entry_sets.updated_at` to the DB `now()` on each edit. The AGENTS.md schema convention mandates
  last-writer-wins on the **client-supplied** `updated_at`/`version` (`setWhere incoming >= stored`) so
  offline clock-skew resolves correctly. **The day page's Change does the same** (FAM-1 11c-i,
  `amendRow` → `updateEntrySetRows` in `writers/session-rows.ts`: the set, its quantities and the
  entry), and so does 11c-ii's revive (`logRow` in `writers/day/log-row.ts`: the entry it brings
  back and the set it soft-deletes); v1.5 sync must find all of them.
- **Impact:** none today — there is a single ONLINE writer (no offline outbox until v1.5), so `now()` is
  always `> created_at` and no two devices race an edit. Correct for the current deployment.
- **Proposed fix:** at **v1.5** (offline + TanStack Query + the sync outbox), take the client `updated_at`
  in `editStrengthSetSchema`, thread it into the writer, and add `.where(incoming >= stored)` to the UPDATE
  (the same LWW guard the sync path applies to every mutable row). The writer edge already flags the spot.
- **Severity:** low (deferred with the rest of the offline/LWW work).

## `profiles.routine_config` is JSONB — a knowing exception to the typed-columns rule (V1-18)

- **What & why (V1-18 PR 1a):** the per-kid routine (ordered activity keys) is stored as a nullable JSONB
  blob (`routineConfigSchema` in `@mat-plan/shared`) instead of a `routine_items` table. Deliberate: the
  first slice only _renders_ the ordered list (`order.map` over the existing forms, PR 1b) — nothing
  queries/joins/filters INTO it, key validity is enforced on read (`resolveRoutine`, drop-unknowns), and
  `null → the default routine` ships dark with no backfill. AGENTS.md "JSONB only for opaque sync/device
  metadata; values stay in fixed typed columns" — routine config is borderline structured, accepted for the
  first slice per the V1-18 design→eng investigation (docs/plans/v1-18-*).
- **Impact:** low now (single-household, hand-seeded, read-only render). Grows if V1-10 needs to schedule /
  join / query routine rows.
- **Promotion trigger (explicit):** promote to a `routine_items` table (bigint identity PK, UUIDv7
  public_id, `profile_id` FK + covering index, `position` ordinal + partial-unique per profile,
  `activity_key` text, `conditional` → a real typed column, the per-kid check-in allowlist as rows) the
  **first time V1-10 needs to query INTO the routine** — generate rows from a program schedule, JOIN routine
  to sessions/day, or filter by conditional/day. Expand→backfill(from JSONB)→contract; keep the default as
  the seed. Until then JSONB + zod-on-read stays.
- **Severity:** low.

## Three dev-only advisories, two with no fix available (2026-10-06)

- **What & why:** a sweep cleared 11 of 13 `pnpm audit` findings — `fast-uri` (the only one `audit --prod`
  saw, reached through `@sentry/nextjs > @sentry/webpack-plugin > … > ajv`), plus a **critical**
  `proxy-addr` and 8 highs, all dev-only. Nine moved by lockfile bump alone; `ip-address` needed an
  in-range `overrides` pin. **Two resist**, and a **third arrived later the same day:**
  - **`braces@3.0.3` (high, GHSA-vfj7-8cjw-p6xm)** — stack-exhaustion DoS on a crafted brace pattern, via
    `eslint-config-next > @next/eslint-plugin-next > fast-glob > micromatch`. ⚠️ **The advisory names
    `>=3.0.4` as patched and that version does not exist** — `braces`' latest release is 3.0.3, and pinning
    it makes the whole install unresolvable. There is nothing to upgrade to; this one waits on upstream.
  - **`esbuild@0.18.20` (moderate, GHSA-67mh-4wv8-2f99)** — the dev-server CORS issue, pinned by the
    **deprecated** `@esbuild-kit/esm-loader` inside `drizzle-kit@0.31.11`. Forcing esbuild across that
    range inside a deprecated loader is how `drizzle-kit` breaks; the fix is a `drizzle-kit` bump that
    drops `@esbuild-kit/*`, not a grandchild pin.
  - **`@modelcontextprotocol/sdk@1.30.0` (high, GHSA-6qxp-vccf-f47h)** — new on 2026-10-06, so the full
    tree now holds **three** findings, not two. An OAuth client can send credentials to an authorization
    server the MCP server chose; reached only through `shadcn`, a devDependency since 2026-10-03. Unlike
    the other two **this one has a published fix**: the advisory names `>=1.31.0`, 1.32.1 is out, and
    `shadcn`'s own range is `^1.26.0`, so a lockfile bump clears it. **Not done here** — SEC-5 is a
    docs-and-CI change and a lockfile bump is its own PR.
- **Impact:** low. All three are devDependencies — `pnpm audit --prod` is clean, which is also why the
  SEC-5 gate scopes itself to `--prod`: gating the full tree at `high` would wedge `main` on `braces`
  with no edit that unwedges it. `braces` is reached only by ESLint's own globbing over this repo's
  files, the esbuild advisory needs `esbuild serve`, which `drizzle-kit` never starts, and the MCP SDK
  is only ever run by the `shadcn` CLI.
- **Promotion trigger:** re-run `pnpm audit` when `braces` publishes >=3.0.4 or `drizzle-kit` drops
  `@esbuild-kit/*`; both then clear with a lockfile bump and the `ip-address` override can go too. The
  MCP SDK needs only the bump.
- **Severity:** low — but note this was found by a local `pnpm verify` during unrelated work, which is the
  same accident that found all four advisories behind **SEC-5**. The gap was the gate, not the
  advisories — and SEC-5 closed it for the `--prod` tree. The full tree is still audited by nobody
  automatically; **SEC-5b** is the row for that.
