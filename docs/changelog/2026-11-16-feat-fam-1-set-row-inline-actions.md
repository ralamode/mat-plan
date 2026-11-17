- **2026-11-16** — **FAM-1: changing a logged number on the day page cancels with a ✕ under its ✓**
  ([guide](../features/day-page.md)). While a logged number is typed over, the line under the row
  (a set row or a single-value card: "Not saved. Was 30 lb.") now ends in an icon-only, neutral ✕
  directly under the row's ✓, instead of a text "Cancel" button. It is the shared
  `InlineEditActions` (#501) that the weight and practice changes use, in its ✕-alone form, since
  the row's ✓ already saves. The ✕ is named for its row ("Cancel changing Bench press set 1"),
  stays in place but does nothing while a save is in flight, and moves focus to the ✓ before it
  puts the old number back. The field's own line has no room for a 44px ✕ at 360px, so it sits on
  the line below (maintainer, 2026-11-17, from three options captured at 360px). No schema change,
  no new dependency.
