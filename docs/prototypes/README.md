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

| Prototype                                                | Spec                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`crud-1/`](./crud-1/index.html)                         | [CRUD-1 and PROG-1](../specs/crud-1-fix-it-yourself.md)                                                             |
| [`beta-0/`](./beta-0/index.html)                         | [FAM-1](../milestones/fam-1-family-program.md), and every Beta 0 plan with a screen                                 |
| [`beta-0/picker.html`](./beta-0/picker.html)             | [CAT-3](../specs/cat-3-movement-library.md): the movement picker with filters, near matches and "How to"            |
| [`beta-0/day-collapse.html`](./beta-0/day-collapse.html) | [FAM-1](../milestones/fam-1-family-program.md), plan D38: the day page with finished workouts collapsed to one line |

## The accepted prototype for each release

A release's prototype, once the maintainer signs it off at the end of the release-planning loop, is
**the reference every plan, spec, ADR, contract PR and UI PR in that release is checked against**
_(maintainer, 2026-11-15)_. A mismatch is fixed, or recorded as the maintainer's decision. A case
the prototype never shows goes on a list for its next round. It stays here until the release
closes, not only until its spec is signed.

| Release | Accepted prototype                                       | Version         | Notes                                                                                                                                                                                                                                                                                                                                                               |
| ------- | -------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beta 0  | [`beta-0/`](./beta-0/index.html)                         | v12, 2026-11-15 | v10 signed after FAM-1 d3 and its UX panel ([round notes](./beta-0/d3-round-1.md)); v11 made days before yesterday read-only and anchored the clear dialog at the top (#412); v12 brings it in line with the FAM-1 plan ([what changed](./beta-0/d3-round-1.md)), signed by merging #413                                                                            |
| Beta 0  | [`beta-0/picker.html`](./beta-0/picker.html)             | v5, 2026-11-17  | The movement library's picker (CAT-3 spec, K19), signed off after three UX lenses and a confirming pass. Its sample data is the library's entries as drafted that day; only the first reviewed batch carries its instructions here, so fewer rows show "How to" than the maintainer saw. The four switches on the page are decided: the first option of each        |
| Beta 0  | [`beta-0/day-collapse.html`](./beta-0/day-collapse.html) | v2, 2026-11-18  | The accepted v12 day page with one change (FAM-1 plan D38): a finished workout, and Bodyweight and Life once logged, collapse to one line when the person comes back to the day. The maintainer chose that moment over "as soon as its last ✓", and the word "Collapse" over an icon. Its review bar keeps both moments to compare; the accepted one is the default |
| Beta 1  | not yet                                                  | —               | named here when Beta 1's prototype is signed off                                                                                                                                                                                                                                                                                                                    |

**Why it exists:** ADR 0007 Amendment 2 went through six review lenses in three rounds, checked
against the code and the rules. None of them checked it against what the maintainer had approved.
That check, run afterwards, found three mismatches: rest between superset rounds, the same workout
twice in a day, and whether a copy's label is frozen.
