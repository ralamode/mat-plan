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
  A test pins the property rather than the strings, so it fails the moment someone helpfully adds
  _"the database may not be seeded yet"_.
  **The reader's question is "where is my kid's data?", not "what is a household?"** The screen opens
  with three statements of absence in a row, so the explanatory paragraph closes by scoping them to
  the **account** — _"that is about the account, not about anyone's training history"_ — and the
  subhead drops its _"yet"_, which promised a resolution that never comes for the wrong account.
  **`householdState(): 'none' | 'resolved'` is the discriminator, in the DAL.** The obvious patch —
  having the page call `getHouseholdScope()` — would put a `HouseholdScope` in `app/` and break
  `write-path.md` invariant 2. This returns **no scope** and rides the same `cache()`d resolver, so it
  costs no extra query and the capability never leaves the DAL. 🔴 **And that invariant is now a
  gate, not prose:** `packages/db/src/scope.test.ts` fails the build if any file under `app/` or
  `components/` names the resolver — the three older scope guards all stay green on that path,
  because nothing is minted and nothing is unwrapped.
  ⚠️ **The `<h1>` now branches, and the reason the login helper had to be relaxed is the SCREENSHOT
  HARNESS, not the health check.** `scripts/capture.ts` calls `gateLogin` before navigating, so
  `--state no-household` could not be captured at all while the helper demanded the picker's heading.
  The picker assertion did not disappear — it **moved to `e2e/global.setup.ts`**, the one consumer
  that goes on to select a profile. Leaving it only in `gateLogin` would have been strictly worse: a
  deploy where household resolution silently broke would render the no-household `<h1>`, satisfy the
  relaxed assertion, and first fail as a `selectProfile` timeout on a missing tile.
  🔴 **Sign-out is deliberately NOT here, and the screen says so.** The panel is right that sign-out
  is this screen's only real action — it is the entire fix for the wrong-Google-account case — but
  until the session is the boundary at `1c-3`, signing out of Clerk would leave the gate cookie in
  place and the person still logged in. That is what parked the lock-device PR (#303). So the copy
  names the fix **and** carries a `notYet` line (the `PICKER_EMPTY_COPY.notYet` idiom): without it,
  the sign-out sentence prescribes an action with no affordance anywhere on the page and the
  following _"Otherwise"_ reads as though the first branch were live. `1c-3` deletes `notYet` and
  ships the button. The dead-end line also now names the **invitation** as the way to reach "the
  person who set this up", which a reader's mail client can resolve — the screen must never carry the
  maintainer's name or address, and it does not need to.
  Coverage the panel required, because this screen is **further out of Playwright's reach than the
  empty picker** (it needs zero live households, which breaks `selectProfile` in every other spec): a
  `--state no-household` seeder for `screenshot:ephemeral`, and a cell in the design-token inventory,
  which is its only axe run in both themes and its only 360px overflow measurement.
- **2026-10-28** — **A published line about what Google sends was still narrower than the evidence.**
  `PRIV-2`'s scope correction fixed the notice's prose (#311) but missed the processor table, which
  still said Google gives Clerk _"the email address and account identifier"_. The `userinfo.profile`
  scope cannot be removed, so **the name and profile picture arrive too** — as
  `data-inventory.md` already recorded. The table row and the served `/privacy` page now say so.
