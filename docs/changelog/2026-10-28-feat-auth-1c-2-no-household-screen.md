- **2026-10-28** — **"No household for this account" gets its own screen, before the state can be
  reached with the wrong copy.** Today `listProfiles` returns `[]` for a null scope **and** for a
  household with no athletes, so both land on `PICKER_EMPTY_COPY` — which tells the reader that adding
  an athlete _"takes a change to this deployment's seed data"_ and offers a link into a public GitHub
  repo. After `1c-4` one of those readers is an **invited parent on a gym floor**. This lands first so
  that never happens.
  🔴 **The UX panel found the state has FIVE causes, not two**, and the plan's proposed copy —
  _"contact the person who invited you"_ — is true for exactly one of them: an unseeded deploy · the
  table not existing · a parent with no membership · **the maintainer before the claim correction has
  run** (which the plan's own risk R2 names) · and **the wrong Google account**, which the panel calls
  the likeliest cause on a phone, where a parent with a personal and a work account signs in with
  whichever one the browser was already in. So the copy is **cause-free** — every line true in all
  five — and the cause lives in `scope_outcome` telemetry and the runbook, not on a family's screen.
  **`householdState(): 'none' | 'resolved'` is the discriminator, in the DAL.** The obvious patch —
  having the page call `getHouseholdScope()` — would put a `HouseholdScope` in `app/` and break
  `write-path.md` invariant 2. This returns **no scope** and rides the same `cache()`d resolver, so it
  costs no extra query and the capability never leaves the DAL.
  ⚠️ **The `<h1>` now branches, and the reason it could not has been fixed rather than worked around.**
  It was pinned because `e2e/login.ts`'s `gateLogin` asserted the picker's specific heading — but
  _"Who's logging today?"_ above _"No household for this account"_ is simply false. The helper now
  asserts that **some** `<h1>` is visible; the specs that genuinely need the picker still assert
  `pickerHeading`. That also makes the helper a better health check: a `1c` deploy where membership
  resolution silently broke would previously have sailed past login and failed confusingly in every
  spec on missing tiles.
  🔴 **Sign-out is deliberately NOT here, and the copy names the fix without offering a button that
  would lie about performing it.** The panel is right that sign-out is this screen's only real action
  — it is the entire fix for the wrong-Google-account case — but until the session is the boundary at
  `1c-3`, signing out of Clerk would leave the gate cookie in place and the person still logged in.
  That is exactly what parked the lock-device PR (#303), and the same argument applies to its mirror
  image. `1c-3` adds the control.
  Coverage the panel required, because this screen is **further out of Playwright's reach than the
  empty picker** (it needs zero live households, which breaks `selectProfile` in every other spec): a
  `--state no-household` seeder for `screenshot:ephemeral`, and a cell in the design-token inventory,
  which is its only axe run in both themes and its only 360px overflow measurement.
