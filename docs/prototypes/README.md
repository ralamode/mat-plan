# Prototypes

Clickable, throwaway UI prototypes reviewed **before** implementation (AGENTS.md → "UI PR rules").
Each is one self-contained HTML file: no build, no dependencies beyond a Google Fonts link, no data
leaves the page, and every name in it is a fixture.

**Why here and not in `apps/web/app/`.** A page under `app/` is a route: it trips
`apps/web/app/pages-are-gated.test.ts` unless it awaits `requireGatedPage()`, ships in the production
bundle, and collides with whatever AUTH-1 is doing to the gate. A prototype is a design artifact, so it
lives with the docs that cite it.

**Open one:** open the file in a browser, or serve the folder (`python3 -m http.server` from inside it)
to get a phone-sized viewport in devtools. The bar at the top switches screen, viewport width and the
variants the spec's open decisions ask about.

**Lifecycle.** A prototype is frozen once its spec is signed off; the implementation PRs copy decisions
from the spec, not markup from here. Delete the folder when its milestone closes.

| Prototype                        | Spec                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| [`crud-1/`](./crud-1/index.html) | [CRUD-1 — Fix it yourself](../specs/crud-1-fix-it-yourself.md) |
