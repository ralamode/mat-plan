- **2026-11-12** — **PICK-1 PR 3: the movement picker exists, unmounted — choosing a movement is
  about to stop meaning typing one** ([plan](../plans/pick-1-movement-picker.md),
  [guide](../features/movement-picker.md)). CRUD-1 step 6b's component half; nothing renders it until
  PR 4, so there is no visible change. `movementNameKey` is now THE "same movement" rule — `pull ups`,
  `pullups` and `Pull-Ups` are one key — built on PROF-1's `foldName` with a source scan asserting the
  import, because a local lowercase passes every vector while disagreeing on accents. The browse
  groups and the six aliases are code keyed by slug, and a seeded row with no group is simply not
  browsable, which is what makes "no `other` group" true by construction. The component imports no
  Server Action and no `app/` module, so `D2`'s editor can mount the same one. A pre-implementation
  UX panel found **eight gaps** in a design its round 1 had already approved — the sharpest being
  that U0's footer fallback put an outline "Use as typed" where Close had been two keystrokes
  earlier, one tap from minting a movement nothing can delete; the footer now always ends with Close.
  Counted copy goes through `Intl.PluralRules` / `Intl.ListFormat` rather than a ternary, which
  `I18N-1` inherits and `RTL-1` is filed above. Two code comments claiming a later PR owes a
  slug→id switch are retired: chunk 2 shipped both sides keyed on `movement_id`, so invariant 7 is
  closed, not pending. A **post-implementation panel** then read the built component across six
  lenses: the picker now derives every branch from one query value, because a render mixing the
  immediate and deferred ones announced "No matches." before the count on the first keystroke of
  every search and, for one frame, offered to create a duplicate of Romanian Deadlift. The matcher
  returns which alias hit, so no component re-derives the fold rule. Today's program gets a real
  heading, which heading navigation had been skipping. And five tests that could not fail were
  replaced with five that can — each probed with `pnpm probe`.
