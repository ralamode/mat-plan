- **2026-11-19** — **With no search, the movement picker lists "All movements" by kind of training,
  then family** (`CAT-3` B3-i; [plan](../plans/cat-3-b3-browse-by-kind.md),
  [spec](../specs/cat-3-movement-library.md) P12, K24 to K27). Strength opens to families such as
  "Squats" and "Rows"; Conditioning and Skill list their movements by name. Each heading shows its
  count. "Your custom items" now comes first, open while it holds five or fewer. A short list (20 or
  fewer library movements) opens every group by itself. The old built-ins with no library entry yet
  sit in one folded "Not sorted yet" section after the kinds, until the fresh start. A row no longer
  carries a group tag. Every group is a button in its heading, and a ticked or current row always
  has the groups above it open.

  The view model is `apps/web/lib/movements/browse-view.ts`, unit-tested without a DOM; the filtered
  tree, the e2e steps and the screenshot state are B3-ii. No roadmap item moved.
