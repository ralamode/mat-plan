- **2026-10-07** — **Filed UI-2: restyle the UI with a motion component framework (Aceternity UI /
  Magic UI / similar).** Requested as a backlog item, not a decision, and the row's first job is to
  split the question — because "restyle" has two answers here and only one of them is expensive.
  [design.md](../design.md) is already token-driven and says so outright: _"To reskin, change the
  tokens, not the components."_ A palette/type/spacing change is the OKLCH tokens in `globals.css`,
  reversible in one file, with no new runtime. What these libraries actually sell is the other thing —
  animated beams, spotlight and aurora backgrounds, marquees — which arrives as copy-paste components
  **plus `framer-motion`**, a runtime `apps/web` does not have today (it carries only
  `tw-animate-css`, which is CSS, not JS). The row says where that is plausibly a yes (the **public
  landing page**, whose job is to impress rather than to be used between sets) and why the default is
  no on the logging path, against four standing rules rather than taste: adult-first/not-decorative
  design, RSC-first with minimal `'use client'`, the p75-mobile CWV budget that **nothing currently
  measures**, and the fact that kids log on a phone on a gym floor where motion that delays a tap is a
  direct cost. Acceptance is a prototype on one real screen at three widths with a measured bundle and
  INP delta, behind a UX panel — so the question becomes decidable instead of arguable. Not a P0.
  Also fixed a dead reference while in the file: `AGENTS.md` pointed at a root `DESIGN.md` that does
  not exist; the design language lives at `docs/design.md`.
