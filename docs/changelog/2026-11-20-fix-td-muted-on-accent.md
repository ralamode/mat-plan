# Muted text clears AA on hovered and selected rows in the light theme

Tech debt, lane P, picked by the maintainer (2026-11-20). Light `--muted-foreground` moves from
oklch L 0.556 to 0.54, one 8-bit step darker than the debt row's 0.545, for margin. Muted text on a
hovered or selected row (`--accent`), on `--muted` and on `--secondary` was 4.34:1, under WCAG AA. It
is now 4.64:1, and 5.06:1 on the page. axe never saw it, because a hover ground is a state it does
not render. The dark theme is unchanged, at 5.83:1 or more.

- Live on the programs list, a program's workouts list and the athletes page's settings row, each
  on hover, which a pointer paints and a phone does not.
- `token-sets.test.ts` now pins the live palette's muted text at AA on every ground in both themes,
  and checks the candidate sets on accent and secondary too. Its 4.34:1 characterisation row is gone,
  as is `done-tokens.test.ts`' 4.27:1 row (the pair now clears AA; logged rows still use
  `done-muted-foreground`, for its hue and margin).
- The nav rail keeps its outlined current row and its hover un-muting, now as choices; the comments
  that cited 4.34:1 as the reason say so. The paid tech-debt row is deleted, and `UI-3`'s list of
  inputs records the fix.
