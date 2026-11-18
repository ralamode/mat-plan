- **2026-11-18** — **FAM-1 7b, PR 1: "How to" can load a movement's steps outside the design
  preview** ([guide](../features/movement-picker.md) invariant 14; [plan](../plans/fam-1-7b-builder-pages.md)).
  A session-gated read at `/programs/how-to/<id>` finds the movement among the household's own
  picker options and answers its name, steps and supervision label, or one 404 that is the same
  whether the caller is signed out, the id is unknown or another household's, or the movement has
  no steps. The client loader treats a 404 as "no steps" and any other failure as "couldn't load",
  so the picker offers Try again. Nothing mounts it yet: the workout pages come in 7b-ii. The test
  that every Route Handler is uncached now covers every handler, not one by name.
