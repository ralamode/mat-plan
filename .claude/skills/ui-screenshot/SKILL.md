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

## Procedure

1. **Build + start the prod server** (production build = representative CSP/render):

   ```bash
   pnpm build
   (cd apps/web && node_modules/.bin/next start -p 3996 > "$CLAUDE_JOB_DIR/tmp/screenshot-server.log" 2>&1 &)
   # wait until it answers
   for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3996/gate && break; sleep 0.5; done
   ```

   The app needs its env — `apps/web/.env.local` must have `ACCESS_GATE_PASSWORD` + `DATABASE_URL`
   (Next auto-loads it). Data-backed pages read live Neon; seed first if the screen needs rows.

2. **Get the gate code** (do not hardcode it):

   ```bash
   grep '^ACCESS_GATE_PASSWORD=' apps/web/.env.local | sed -E 's/^[^=]+=//; s/^"//; s/"$//'
   ```

3. **Drive the gate with the Playwright MCP** (load the tools via ToolSearch: `browser_navigate`,
   `browser_snapshot`, `browser_type`, `browser_take_screenshot`, `browser_close`):
   - `browser_navigate` → `http://localhost:3996/gate`
   - `browser_snapshot` to get the Access-code textbox ref
   - `browser_type` the code into it with `submit: true` → it redirects to `/` once the cookie is set
     (Chromium honors the `Secure` cookie on `localhost`).

4. **Navigate to the target route(s)** and capture each changed screen/state:
   - `browser_navigate` → `http://localhost:3996/<route>`
   - `browser_take_screenshot` with `fullPage: true`, `type: 'png'`, `filename: '<screen>.png'`.

5. **Move the file into `.screenshots/`** (the MCP may drop it in the repo root) and hand it over:

   ```bash
   mkdir -p .screenshots && mv <screen>.png .screenshots/ 2>/dev/null || true
   ```

   Then send it with `SendUserFile` (`.screenshots/<screen>.png`) and tell the user to attach it to
   the PR's Screenshots section.

6. **Cleanup:** `browser_close`; kill the server (`pkill -f "next start -p 3996"`); confirm
   `git status` is clean (no stray PNG in the repo root — `.screenshots/` is gitignored).

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

## Future

At **V0-11** Playwright lands as a real dev dependency; this flow graduates to a committed
`pnpm --filter web screenshot <route>` script (reusable by humans + CI artifacts) built on the same
gate-login helper. Until then, use the MCP procedure above.
