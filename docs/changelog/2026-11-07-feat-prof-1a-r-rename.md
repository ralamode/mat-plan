- **2026-11-07** — **Rename an athlete, from their own page** (`PROF-1` a-r,
  [plan](../plans/prof-1-athletes.md), acceptance criteria 4, 8, 9 and 11).
  A new `/p/[profileId]/edit` route: one field, one button, the kind shown and not editable. The day
  page's "→ Edit {name}'s routine" link becomes **"→ Edit {name}"**, which also discharges criterion
  11 — **nothing in `apps/web/app` or `apps/web/components` links to `/routine` any more**. The route
  stays in code and `e2e/a11y.spec.ts` keeps scanning it, so an unlinked page is still audited.
  🔴 **`app/p/profile-actions.ts` is the app's FIRST second Server Action module, and it enters every
  boundary matrix the moment it appears.** That is `WP-1`'s whole payoff cashed: the registry
  cross-check reads every `'use server'` module on disk rather than `actions.ts` alone, so
  `renameAthleteAction` is covered by the unauth, rate-limit, wrong-household and
  byte-identical-refusal suites without any of them being re-typed. Before `WP-1` this key would have
  failed the equality with 8 registry names against 7 exports — and a module added without a key
  would have faced **no** boundary test at all.
  🔴 **Criterion 4 is a ROW COUNT, so its proof is `db:verify`, not an emitted-SQL assertion.** "If a
  rename names a profile outside the session's household, the system shall write nothing" — a
  recording-pool test proves the conjunct was appended and bound to the resolved household, which is
  a different claim. `renameProfile` therefore lives in `packages/db` (while `updateProfileRoutine`
  reasonably does not), and `db:verify` runs it against two real households: the wrong household in
  **both** directions, a soft-deleted row and an unknown id each update 0 rows **and leave the stored
  name intact**, and the seeded sibling is the witness that exactly one row was touched.
  🔴 **An ARCHIVED athlete is still renameable, and that assertion has a mutation patch.** Archive is
  "not currently training", not a lock, so a typo in an archived athlete's name must be fixable
  without restoring them first. `13-rename-locks-archived` adds `archived_at IS NULL` to the writer
  and `db:verify` goes red — **the first patch in that directory pointed at a permissive assertion
  rather than a refusal.** Every other one breaks a predicate that must refuse; this breaks one that
  must allow, which nothing else in the file would have noticed.
  ⚠️ **Two defects the gates caught before this shipped, each found by a different one.** (1) The
  whitespace collapse ran BEFORE the line-break refine, so `'Ada\nMae'` collapsed to `'Ada Mae'` and
  the guard could never fail — found by the schema's own test on its first run; the order is now trim
  → reject break → collapse. (2) A whitespace-only name failed **two** refines with the same copy and
  `.refine` does not abort the chain, so the form rendered **"Enter a name. Enter a name."** — found
  in a SCREENSHOT, while a test asserting "at least one message" stayed green. The schema uses
  `superRefine` now and the test pins **exactly one** message per failure.
  **`NAME_WRAP_CLASS = 'min-w-0 wrap-anywhere'`** lands on every renderer that shows a name — the
  tile, the day-page `<h1>`, the edit `<h1>` and back link, the "→ Edit {name}" link and a-g's
  program note, which had reached for `break-words` **while citing the decision in its own comment**.
  The two break lines identically; only `anywhere` lets a break count toward `min-content`, which is
  what four of those renderers' widths derive from. A contract test pins the utility by name, because
  no rendered assertion anywhere can tell the two apart.
  ⚠️ **"→ Edit {name}'s routine" had overflowed at 360px since V1-23** — 322–384px against 328px
  usable. Fixed here with the rest, not charged to this PR.
  Also: `PROFILE_KIND_LABELS` replaces `capitalize {profile.kind}` on the tile, which had been showing
  a parent the schema's word ("Kid") and had a test agreeing with it (criterion 9); `← All profiles`
  becomes **`← All athletes`** and the picker subhead becomes **"Tap your name to start logging."**
  (PUX-8 — "athlete" is the human noun, and the prototype's wording names the gesture);
  `PICKER_EMPTY_COPY.next` stops sending a first-run reader to the editor criterion 11 unlinks; and
  `components/ui/announcer.tsx` arrives early from PR b so the `role="status"` line is not copied a
  fifth time.
  **Privacy:** `profiles.name` becomes the **third** UI-editable free-text field (the inventory said
  two). No new column, no new processor, no new retention — the `UPDATE` **overwrites** and keeps no
  history, which is a decision _(maintainer, 2026-11-07)_: no `profile_name_history` table, no
  `previous_name` column, so **a mis-correction is unrecoverable from the app**. The name reaches
  neither Sentry (no `formData`, no `headers`) nor the CSV export. **The published notice needs no
  edit** — it already says the app holds "a name for each athlete… whatever you type".
  🔴 **A six-lens review panel on the pushed branch found seven things no gate did**, four of them
  claims the code or the docs asserted and did not deliver — on a PR that was green on 1452 tests,
  `db:verify`, 13 mutation patches, 66 e2e, lint, typecheck and the audit. The headline three:
  **(1)** the criterion-11 e2e assertion **could not fail** — `/Edit routine/` never matched the link
  it proved absent (`→ Edit {name}'s routine`), so it was 0 before the PR and would stay 0 if the
  link came back; it asserts the **destination** now. **(2)** `db:verify`'s new block was the first
  code outside `ownership.ts` to unwrap the household scope, and `scope.test.ts` **stayed green** —
  its regex was case-sensitive on `[Ss]cope`, so `A_SCOPE.householdId` walked past the one guard
  standing behind ADR 0006; the block takes raw ids now and **the regex is `/i`, probed red**.
  **(3)** the `role="status"` "Name saved." line rendered **nothing** in either mode —
  `useOnActionSuccess` seeds `useState(state)`, so the no-JS re-render it was written for never fires
  the transition; `saved` is derived from `state.ok` now.
  **Three lenses converged independently** on a fourth: `window.history.length > 1` is not "arrived
  from inside the app" — it is true in almost every phone tab — so `router.back()` sent a parent who
  typed the URL **off-site** after a successful save. `?from=` is built as D6 specified, with an e2e
  that drives the outside-app branch. Two more: a zero-width space stored an invisible name, and a
  NUL byte passed zod and made Postgres **throw past the typed envelope**.
  ⚠️ **The notice did need an edit after all.** The "no edit owed" conclusion held on what is stored
  but skipped `notice.md`'s **"Two text boxes have no filter"** — the plain-language derivation of
  the inventory count this PR changed to three. It now reads three, says which of them reach the
  export, and adds one sentence that a rename keeps no record of the old name.
  Also from the panel: **"→ Rename {name}"** replaces "Edit" (one field, and under the day's logged
  entries "Edit" read as _edit today_); the Kind block becomes one muted line instead of a `<dl>`
  whose label out-weighted the real one; a refusal returns focus to the field; `NAV_LINK_CLASS`
  replaces five hand-typed copies; `athletePath` is swept through `actions.ts` and its tests so
  **zero `/p/${…}` literals remain** outside the helper; `AthleteForm` becomes `RenameForm` (a-1
  cannot reuse it); the announcer moves to `components/ui/`; and `docs/architecture.md` §2b gains
  the route and the second action module. One finding is **deferred with its reason**: a stale edit
  tab silently overwrites a concurrent rename, which the no-history decision makes unrecoverable —
  `tech-debt.md` carries it rather than a behaviour change made under review pressure.
