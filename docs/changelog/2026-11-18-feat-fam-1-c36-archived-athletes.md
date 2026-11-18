- **2026-11-18** — **An archived athlete is not shown on a program's page**
  ([guide](../features/program-contract.md), invariant 31; FAM-1 contract change C36). A program's
  page lists who is on it and who can be put on it, and the Programs list names who is on each.
  An archived athlete is now left out of all three, as they already are from the day page's athlete switcher.
  Nothing is lost: they are still on the program underneath, and are back on its page when
  restored. This PR sets the rule and the preview page's example of it; the real program pages
  follow.
