- **2026-10-15** — **The whole app was rendering in the browser's serif default, and had been since
  `V0-1b`.** `apps/web/app/globals.css:11` read `--font-sans: var(--font-sans);` — a token defined as
  itself, so it resolved to nothing and `@apply font-sans` on `html` fell through to the UA default.
  `--font-heading` inherits from the same token, so headings went with it. `layout.tsx` loads Geist and
  exposes it as `--font-geist-sans`, and the line directly below (`--font-mono:
var(--font-geist-mono)`) shows the intended shape — this was a one-token typo, not a choice.
  [design.md](../design.md) has said _"`--font-sans` = Geist"_ the whole time, so the documented design
  and the rendered app disagreed for months without anything failing. **Found while reviewing `PRIV-2`'s
  screenshots** — the landing page was serif too, which is what made it pre-existing rather than
  something the new route introduced. Nothing automated catches this class: a self-referential custom
  property is valid CSS that resolves to the guaranteed-invalid value, so there is no error, no build
  warning and no failing test — only a look. A checked screenshot is the only control, which is the
  argument for the three-width captures AGENTS.md already requires on UI PRs.
