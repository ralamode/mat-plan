---
name: ui-screenshot
description: Capture Playwright screenshot(s) of a mat-plan UI screen for a PR — boots the prod build, logs through the access gate, navigates to the route, saves PNGs at three widths to .screenshots/, and publishes them to the PR. Use on ANY PR that changes the UI (new/changed page, component, or visible state), before opening the PR.
---

# UI screenshot for a PR

**When:** every PR that changes something visible (a page, component, or state), before finalizing
the PR. Placement, the three widths and the `--note` rule are in AGENTS.md → "UI PR rules". Every
capture is taken at mobile (390), tablet (820) and desktop (1280) automatically (`VIEWPORTS` in
`apps/web/scripts/capture.ts`). PNGs go in the gitignored `.screenshots/` folder and are **never
committed**.

## Procedure — the ephemeral-DB script (primary)

Playwright is a real dev dependency and the capture is a committed script built on the **same**
gate-login helper the E2E smoke uses (`apps/web/e2e/gate-login.ts`). No MCP needed.

**Default flow — self-contained, never touches live Neon.** `screenshot:ephemeral` boots a throwaway
**`embedded-postgres`** (a real Postgres binary on an ephemeral TCP port — no Docker, no creds),
migrates + seeds it via the `packages/db` scripts, runs `next start` against it, captures the route,
and tears everything down. It manages the server + DB itself — no manual build/start, no `.env.local`.

```bash
pnpm --filter web screenshot:ephemeral /                          # the PUBLIC landing (captured un-gated)
pnpm --filter web screenshot:ephemeral /p                         # the profile picker (also the default)
pnpm --filter web screenshot:ephemeral /p/<seed-id> --state empty           # a seeded profile's Today
pnpm --filter web screenshot:ephemeral /p/<seed-id> --state already-logged  # Today with a habit + a
                                                                            #   brush-teeth metric pre-logged
```

- `<seed-id>` is `SEED_PROFILE_PUBLIC_ID` from `@mat-plan/db` (`e2e/steps.ts` builds
  `SEED_PROFILE_ROUTE` from it); that's where the check-ins/bodyweight/strength forms live. A Today
  capture is named `today`. **There is no `/p` shorthand any more** (OSS-2): `/p` is the real picker
  route, and the shorthand would have silently captured the wrong screen.
- A route in `PUBLIC_PATHS` (today just `/`) is captured **without** the gate login — a logged-in
  capture of `/` would show the picker the proxy redirects to.
- **Always pass `--build`** after changing UI: the script reuses an existing `.next`, so without it
  you capture whatever was last built (often `main`'s UI).

### ⚠️ If the state only exists after a TAP, capture it anyway — do not write it off

**There are two kinds of `--state`, and forgetting the second is how a PR ships with screenshots that
do not show the change.**

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
  renders without writing to the real DB.
- The PNGs land in `apps/web/.screenshots/<slug>-<width>.png` (e.g. `today-mobile.png`,
  `today-already-logged-desktop.png`);
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

**Publish:** `pnpm --filter web screenshots:publish --pr <n> --comment` (add
`--note "<what changed>"` from the second round; the script refuses without it, and `--only <substr>`
filters files). It uploads to the orphan `screenshots` branch and posts `github.com/.../raw/...` links,
the form that renders; `raw.githubusercontent.com` and base64 `data:` URIs don't (AGENTS.md → "Why the
tooling exists"). Confirm `git status` is clean (`.screenshots/` is gitignored). If you started a `--use-live-db`
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
