# Change: Escape works from any control in the row, and a ✕ press dragged off no longer strands an edit

On the day page, Escape now cancels a Change from the row's ✓, ✕ or Try again as well as from the
field, with focus moving to the ✓ when the button it was on goes away. A press on ✕ that is released
somewhere else, or turns into a scroll, no longer leaves the edit stuck unsent until a field is
focused again. **Pending the maintainer's decision** (the PR is a draft): whether such a press then
saves the typed number, as this PR does, or keeps it typed and unsent. Plan:
[fam-1-change-escape-and-drag-off.md](../plans/fam-1-change-escape-and-drag-off.md).
