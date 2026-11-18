- **2026-11-18** — **The design preview no longer asks for pages that do not exist**
  ([guide](../features/program-contract.md), the preview's file table). The preview page shows
  the program builder with made-up programs. Its links were quietly loading the real page for
  each made-up program in the background, and each answered "not found", once for each link
  on each visit. The preview now turns that background loading off. Real pages are unchanged.
