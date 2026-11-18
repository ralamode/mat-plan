- **2026-11-18** — **The program builder's guide and two code comments now say the design preview
  stops prefetching fixture pages** (#593), instead of "not provided yet"
  ([guide](../features/program-builder.md)). The capture recipe keeps waiting for `load`: whether
  the preview now reaches `networkidle` is unverified. Docs and comments only.
