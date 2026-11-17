- **2026-11-17** — **CAT-3: the rules behind the picker's filters and its "All movements" list**
  ([spec](../specs/cat-3-movement-library.md) P5, P7 to P12 and P16; [guide](../features/program-contract.md);
  contract chunk C0b-2, from the accepted picker prototype). The shared code now knows the
  filters: equipment as one choice of three (any, none, or "uses at least one of" the items you
  tick), and main muscle. Under a filter a movement you typed exactly is still listed first and
  marked as outside the filters, your own custom items are set apart instead of hidden, and the
  result says how many more movements the filters left out. It also gives the number beside each
  filter choice (zero means greyed), the kind-then-family tree for browsing, what Enter picks,
  and a way to read one movement's "How to" steps. No screen changes yet: the picker lane builds
  the filter panel and the browse list on these.
