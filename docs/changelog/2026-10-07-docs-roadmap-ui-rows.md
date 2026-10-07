- **2026-10-07** — **Gave `UI-2`/`UI-3`/`UI-4` a pillar home, which #248 should have done in the same
  PR.** The roadmap's pillar table calls itself _"the membership test"_ and notes it has already failed
  once; #248 filed three new rows and did not add them to it, so all three were in no pillar — the same
  failure, one PR later. Fixed three ways: **Product & Spec** now owns the design system explicitly
  (`docs/design.md` plus the tokens in `apps/web/app/globals.css`) and carries `UI-2..4`; the **Seams**
  table gains the design tokens and the `.dark` class, consumed by **every** pillar with a screen,
  which is why a reskin does not parallelize; and that pillar's **Next** records the ordering —
  `UI-4` (the switch) before `UI-3` (the reskin), because reskin options have to be reviewable in both
  themes, and because dark mode is currently defined but unreachable. Product & Spec previously held
  no backlog rows by design; it does now, which is the honest placement — the pillar that owns
  `AGENTS.md` and the design language also owns the tokens every other pillar consumes.
