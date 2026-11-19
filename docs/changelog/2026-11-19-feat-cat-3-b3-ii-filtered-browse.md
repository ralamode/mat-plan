- **2026-11-19** — **With a filter on, the movement picker lists what fits by kind of training, then
  family** (`CAT-3` B3-ii; [plan](../plans/cat-3-b3-browse-by-kind.md),
  [spec](../specs/cat-3-movement-library.md) P9, P10, P12, K25, K26). "Movements that fit your
  filters" is now the same tree as "All movements", with the filtered counts and no empty heading,
  in place of one flat list by name. It opens every group by itself when 20 or fewer library
  movements fit, counted after the filter. "Your custom items (not filtered)" stays folded above it,
  however few there are, and opens by itself for a ticked item. A search that matches nothing lists
  the same filtered tree beneath it.

  Today's program and the custom items now use the picker's one disclosure (a button in its
  heading), so the last `<details>` sections and their tick latch are gone; a ticked row keeps
  Today's program open. At large text or on a zoomed page, a row puts "How to" under the name
  instead of squeezing the name to a letter per line (about 174px at 200% text on a phone). The e2e
  spec checks the filtered tree's headings and an open family at 200% text and at 195 CSS px. No
  roadmap item moved.
