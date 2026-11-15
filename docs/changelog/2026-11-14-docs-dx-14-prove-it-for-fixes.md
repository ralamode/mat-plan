- **2026-11-14** — **DX-14 item 1: a bug fix now ships a test shown failing on the parent commit**
  ([definition of done](../definition-of-done.md),
  [review-pr](../../.claude/skills/review-pr/SKILL.md) → Tests). Nothing asked for this before: a
  test written after the fix and only seen green can pass without touching the bug. The review skill
  carries the command that runs only the new test against the parent, and treats a red run for the
  wrong reason (a missing import) as no proof.
