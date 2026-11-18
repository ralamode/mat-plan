- **2026-11-18** — **The movement picker's folded section no longer closes when its last ticked
  row is unticked** ([guide](../features/movement-picker.md) invariant 15). "Your custom items (not
  filtered)" and Today's program open themselves while they hold a ticked row; unticking that row
  used to drop the open state, so the section closed under the person's thumb and the row they had
  just tapped, which held focus, disappeared. The section now stays open until it is tapped
  closed. Found by B3's UX panel; it came in with B2-ii (#575). Only the design preview mounts the
  picker today.
