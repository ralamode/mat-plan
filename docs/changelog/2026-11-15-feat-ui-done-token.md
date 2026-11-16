# A success colour for a logged row: the `done` tokens

The accepted Beta 0 prototype colours a logged row green, and the app had no success colour. This
adds `done`, `done-foreground`, `done-surface` and `done-muted-foreground` to `globals.css` (light and dark) and to
`docs/design.md`'s token table, for FAM-1's day page (lane C) to adopt. No component uses them yet,
so nothing on screen changes.

- Every pair a logged row can draw is AA 4.5:1 in both themes, pinned in
  `apps/web/app/done-tokens.test.ts`. The prototype's light fill was 3.7:1; the app's is darker.
- `muted-foreground` is 4.27:1 on the tint, so secondary text there gets its own token.
- `docs/design.md` → Tokens states the rules a logged row follows: the fill (≥3:1 against the
  un-ticked control) carries the state, not the hue; the tint is decoration and a done card keeps a
  `done` edge; `done` means logged only; focus on a ✓ uses `ring-foreground`.
