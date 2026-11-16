- **2026-11-16** — **FAM-1 contract: the preview's day case mounts the three parts the day page
  places itself** ([guide](../features/program-contract.md), invariants;
  [plan](../plans/fam-1-family-program.md) D34). After lane C's step 13d (#433), `/design/program`'s
  day states show the athlete switcher under the `<h1>`, then the programs line (with Program order)
  and "Not on a program yet", then the day screen, with one `plan` and one `actions` object between
  them. The switcher's links come from the fixture list (`dayPreviewHrefFor`), so each opens a state
  the route already lists. The harness test probes the three parts as it does the screens: same
  objects, the page's order, and no prop the page adds for itself. Nothing in production changes;
  step 12c places the parts on the real page.
