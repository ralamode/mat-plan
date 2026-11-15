- **2026-11-14** — **DX-14 item 2: a UI screenshot fails when the page logs a console error or
  warning** ([skill](../../.claude/skills/ui-screenshot/SKILL.md)). `capture.ts` listens at every
  width and fails the run after the PNGs are written. A hydration mismatch or a CSP refusal no longer
  hides behind an image that looks right. `--allow-console` turns the failure into a printed warning,
  for a state that is meant to error. On its first runs the check found the production CSP blocking an
  inline style on the Today page, intermittently, in four of seven captures of its data states. That
  is a separate fix.
