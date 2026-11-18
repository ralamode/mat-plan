# Change: Escape works from any control in the row, and a ✕ press that gets no click no longer strands an edit

On the day page, Escape now cancels a Change from the row's ✓, ✕ or Try again as well as from the
field, with focus moving to the ✓ when the button it was on goes away. A press on ✕ that gets no
click (dragged off, a long press) or turns into a scroll no longer leaves the edit stuck unsent
until a field is focused again; a tap on ✕ still cancels, even when the finger lifts past its edge.
**Pending the maintainer's decision** (the PR is a draft): whether such a press then saves the
typed number when focus leaves the row (at once, if it already has), as this PR does, or keeps it
typed and unsent. Plan: [fam-1-change-escape-and-drag-off.md](../plans/fam-1-change-escape-and-drag-off.md).
