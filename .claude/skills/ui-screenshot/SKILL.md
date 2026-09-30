---
name: ui-screenshot
description: Capture Playwright screenshot(s) of a mat-plan UI screen for a PR — boots the prod build, logs through the access gate, navigates to the route, saves a PNG to .screenshots/, and attaches it for the PR. Use on ANY PR that changes the UI (new/changed page, component, or visible state), before opening the PR.
---

# UI screenshot for a PR

**When:** every PR that changes something visible (a page, component, or state). This is a
required part of the front-end workflow — see AGENTS.md "UI PR rules" and the DoD. Do it before
finalizing the PR; attach the image(s) to the PR's Screenshots section.

**Where it goes (placement):** the **first** screenshots for a PR go **in the PR description** — the
reviewer's baseline. When a later push changes the visuals, add the **latest** screenshot(s) as a
**PR comment** rather than editing the description, so the description stays the original baseline
and the comment thread shows the progression.

Screenshots go in the gitignored `.screenshots/` folder — they are **attached to the PR, never
committed**.

## Procedure — the ephemeral-DB script (primary, since chore/screenshot-ephemeral-db)

Playwright is a real dev dependency and the capture is a committed script built on the **same**
gate-login helper the E2E smoke uses (`apps/web/e2e/gate-login.ts`). No MCP needed.

**Default flow — self-contained, never touches live Neon.** `screenshot:ephemeral` boots a throwaway
**`embedded-postgres`** (a real Postgres binary on an ephemeral TCP port — no Docker, no creds),
migrates + seeds it via the `packages/db` scripts, runs `next start` against it, captures the route,
and tears everything down. It manages the server + DB itself — no manual build/start, no `.env.local`.

```bash
pnpm --filter web screenshot:ephemeral /                          # empty home / picker
pnpm --filter web screenshot:ephemeral /p --state empty           # seeded profile's Today (empty)
pnpm --filter web screenshot:ephemeral /p --state already-logged  # Today with a habit + a
                                                                  #   brush-teeth metric pre-logged
```

- `/p` (no id) is shorthand for the **seeded profile's Today page** (`/p/<seed-profile-uuid>`), where
  the check-ins/bodyweight/strength forms live. Any explicit route also works.

### ⚠️ If the state only exists after a TAP, capture it anyway — do not write it off

**There are two kinds of `--state`, and forgetting the second is how a PR ships with screenshots that
do not show the change.** (Ray, 2026-09-30, on exactly that mistake.)

- **Seeded states** — `STATES` in `screenshot-ephemeral.ts` maps the name to a fixture seeder that
  writes rows before the capture (`already-logged`, `calisthenics`, `strength-session`,
  `status-badges`).
- **Interaction states** — `INTERACTIONS` maps the name to a Playwright function that **drives the
  running app** after load: click, type, toggle. The fixture entry is `null`. This is how transient
  CLIENT state gets captured — a scaffolded form, a collapsed card, a warning that only appears after
  a chip is tapped. None of it is in the database and none of it can be seeded.

**So the rule: if a reviewer cannot see the change in the default capture, add an entry — do not put
"not capturable" in the PR body.** Adding one is ~15 lines beside the existing examples.

Two things that bite:

- **Drive the UI to FIND the target, don't hardcode.** The YDP rotates A/B on date parity, so which
  movements are on today's card depends on the day the capture runs. `form-bw-warning` opens each
  card in turn and stops at the first that warns; a hardcoded "movement 5" would be right one day in
  two. Throw a message naming the fix (usually `--tz`) when the state is unreachable.
- **`sr-only` controls need `{ force: true }`.** The load-mode chips clip their input so the _label_
  can be the 44px tap target. They are genuinely in the a11y tree — `getByRole` finds them — but
  Playwright's actionability check treats a clipped element as not visible and times out.

- `--state already-logged` seeds fixture rows so the **data-dependent** "already logged today" state
  renders — impossible to capture safely before, because it required writing to the real DB.
- The PNG lands in `apps/web/.screenshots/<slug>.png` (e.g. `today.png`, `today-already-logged.png`);
  the first run builds (`next build`) and is slower; later runs reuse `.next` (pass `--build` to force).
- Run `pnpm --filter web exec playwright install chromium` once if the browser isn't present.

**Opt-in — capture against a live/running server (the OLD behavior).** Only when you deliberately want
the running app's own DB (e.g. live Neon). This writes REAL rows for data-dependent states, so it is
gated behind an explicit flag:

```bash
pnpm build                                            # env: ACCESS_GATE_PASSWORD + DATABASE_URL
(cd apps/web && node_modules/.bin/next start -p 3996 &)
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3996/gate && break; sleep 0.5; done
ACCESS_GATE_PASSWORD=$(grep '^ACCESS_GATE_PASSWORD=' apps/web/.env.local | sed -E 's/^[^=]+=//; s/^"//; s/"$//') \
  pnpm --filter web screenshot:ephemeral / --use-live-db     # or SCREENSHOT_ALLOW_LIVE_DB=1
```

Override the target with `SCREENSHOT_BASE_URL` if not on `:3996`. (The bare `pnpm --filter web
screenshot <route>` script still exists for this same already-running-server case.)

**Hand it over:** `SendUserFile` the PNG, then attach it to the PR per "Posting to the PR" below.
Confirm `git status` is clean (`.screenshots/` is gitignored). If you started a `--use-live-db`
server, kill it (`pkill -f "next start -p 3996"`) — the default ephemeral flow cleans up after itself.

## Fallback — the Playwright MCP (when the script can't run)

If Playwright/deps aren't installed or the script is unavailable, drive the running prod server with
the Playwright MCP directly (load via ToolSearch: `browser_navigate`, `browser_snapshot`,
`browser_type`, `browser_take_screenshot`, `browser_close`):

- Read the gate code (don't hardcode):
  `grep '^ACCESS_GATE_PASSWORD=' apps/web/.env.local | sed -E 's/^[^=]+=//; s/^"//; s/"$//'`
- `browser_navigate` → `http://localhost:3996/gate`; `browser_snapshot` for the Access-code textbox
  ref; `browser_type` the code with `submit: true` → redirects to `/`.
- `browser_navigate` → the target route; `browser_take_screenshot` (`fullPage: true`, `type: 'png'`).
- Move the PNG into `.screenshots/` (the MCP may drop it in the repo root); `browser_close`.

## Guidance

- Capture **each distinct changed screen/state** (e.g. empty state vs populated; error state). For a
  changed screen, a before/after pair is ideal.
- Prefer the **prod build** over `next dev` so the screenshot reflects real CSP/styling.
- Optional: capture light **and** dark (the app is theme-aware) when the change is visual/design-heavy.
- Keep filenames descriptive and versioned to the PR (e.g. `v0-7-today-empty.png`).

## Posting to the PR — private repo, read this

`gh` is authenticated (via `GH_TOKEN`), so **post the PR body with `gh pr create/edit --body-file`** —
no copy-paste. BUT:

- **This repo is PRIVATE.** GitHub renders inline markdown images through an anonymous proxy (camo)
  that **cannot fetch a private repo's `raw.githubusercontent.com` / blob URLs → the image shows
  broken.** Do NOT embed raw/assets-branch URLs here (an "assets branch" trick only works on _public_
  repos). This was learned the hard way on V0-10.
- The **only** way to get an inline image in a private-repo PR is GitHub's **user-attachments** upload
  (the web drag-drop) — session-authenticated and **not** scriptable via `gh`/PAT. But it **is**
  drivable through the **Chrome browser MCP**, which holds the user's authenticated GitHub session.
- **Preferred flow (no manual drag):** post the body via `gh` (`--body-file`), then use the Chrome MCP
  to attach the inline image where it belongs:
  1. `mcp__claude-in-chrome__navigate` to the PR page (`.../pull/<n>`).
  2. `find` the comment/description **textbox** + the **"Add files"** `type=file` input.
  3. Type any caption into the textbox, then `mcp__claude-in-chrome__file_upload` the PNG onto the file
     input's ref — GitHub uploads to its user-attachments CDN and inserts the `<img …>` markdown
     (**heads-up: the upload replaces the textbox contents**, so re-type the caption above the tag
     after it lands). Submit.
  - First-screenshot case → do this in the **description editor**; later-change case → do it in a **new
    comment** (matches the placement rule above). Verified working on PR #19/#21.
- Fallback (if the browser MCP is unavailable): post the body via `gh` referencing the shot as
  _"attached below"_ and **`SendUserFile` the PNG** so the user drags it in — one manual drop.
- Zero-drag alternative (only if asked): commit the PNG into the PR branch so it renders in the **Files
  changed** tab — costs a small binary in `main` on squash-merge.
- If the repo ever goes **public**, `raw.githubusercontent.com` embeds work and the image can be
  automated too.

## History

Graduated at **V0-11**: Playwright became a real dev dependency and this flow moved from the
MCP-driven procedure to the committed `pnpm --filter web screenshot <route>` script above (reusable by
humans, built on the shared `e2e/gate-login.ts` helper). The MCP path is kept as the fallback.
