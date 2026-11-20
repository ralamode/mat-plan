- **2026-11-20** — **FAM-1 15c PR 1: the Program order dialog lists a program ending today as fixed, and the day's program names can be links.**
  In the dialog, a program whose last day is today sits below the movable ones under a note ("This one
  comes off after today, so it is listed last and can’t be moved."), with no number and no arrows,
  and "moved to N of M" counts only the programs that stay. The Program order button shows only when
  two or more stay, and a re-read never closes an open dialog, whatever it changed. Each name on the
  day's programs line becomes a link, with a "›", when the page passes `programHrefFor`, which 15c
  PR 3 does. Seen on the preview only
  until then (D47, D49). `Sheet` gains `statusKey`, so the dialog's repeated announcement is a new node.
