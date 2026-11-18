- **2026-11-17** — **A copied workout's name never ends in half an emoji**
  ([guide](../features/program-contract.md), invariant 28; FAM-1 contract change C33). When a
  long workout name is shortened to make room for " (copy)", the cut no longer lands inside an
  emoji (which would have been saved as a broken character) and no longer leaves two spaces
  before " (copy)". Found in review before any real copy was made.
