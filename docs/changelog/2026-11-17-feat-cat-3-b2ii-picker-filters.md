- **2026-11-17** — **CAT-3 B2-ii: the movement picker filters by equipment and main muscle**
  ([spec](../specs/cat-3-movement-library.md) P7 to P10, P15; [guide](../features/movement-picker.md)
  invariant 15). A "Filters" button beside the search opens a panel in place of the list: any
  equipment, no equipment, or "uses at least one of" chosen items, and main muscles, each with its
  count; a choice that would leave nothing is greyed. Filters stay on while the person keeps adding
  to the same workout. Under a filter, an exact match is still listed first and marked "not in
  your filters"; the household's own items are listed apart as "not filtered"; and the list says
  how many matches the filters hide, with "Clear filters". The create button and its hint ignore
  the filters, so a hidden match still quiets it. Escape closes the panel and leaves the list open,
  through a new `onEscapeKeyDown` on the shared sheet. No schema change, no new dependency.
