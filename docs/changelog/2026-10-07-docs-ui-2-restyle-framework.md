- **2026-10-07** — **Decided the restyle question and filed its two halves: UI-3 (reskin in the
  tokens) and UI-4 (a light/dark switch).** The question was raised as UI-2 — restyle with a motion
  component framework ([Aceternity UI](https://ui.aceternity.com/), [Magic UI](https://magicui.design/))
  — and the row's job was to split "restyle" in two, because [design.md](../design.md) already answers
  one half: _"To reskin, change the tokens, not the components."_ **Decision: the token path.** No
  `framer-motion` and no copy-paste component library on the logging path — it would push the logging
  flow client-side against the RSC-first rule, spend the p75-mobile INP budget that **nothing
  currently measures**, and trade a decoration-forward aesthetic against the explicit "adult-first,
  NOT a kid aesthetic" rule, for kids logging on a phone on a gym floor. The landing page is the one
  surface where that question stays open. ⚠️ **The "feels cookie cutter" complaint turned out to be
  literally measurable: every colour token is `oklch(L 0 0)` — chroma exactly zero — in both themes,
  even `--primary`.** That is shadcn's stock neutral theme, unmodified; "restrained" and
  "uncustomised" have been the same thing so far. So UI-3 asks for **three** token sets on two real
  screens at three widths in both themes, reviewed side by side by a UX panel — options, not a single
  proposal. ⚠️ **And dark mode is defined but unreachable**: a 33-line `.dark` OKLCH palette exists,
  nothing ever sets `.dark`, and there is no `prefers-color-scheme` fallback, so it has never rendered
  for anyone. UI-4 is that switch, it lands first (reskin options must be reviewable in both themes),
  and its fiddly part is the pre-paint script that stops a flash of the wrong theme. Also corrected
  `design.md`'s opening claim that components "adapt to light/dark automatically", which is not true
  while nothing sets the class, and a dead `AGENTS.md` reference to a root `DESIGN.md` that does not
  exist — the design language is `docs/design.md`.
