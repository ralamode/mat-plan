- **2026-11-03** — **Every review agent now pins its own model and reasoning effort in frontmatter**
  ([plan](../plans/dx-11-agent-model-effort.md), reshaped by the four-lens panel: 2 blocking + 8
  SHOULD, all accepted; the plan's own five-tier policy collapsed to two classes on the scope lens's
  argument). All eight reviewers: `model: fable`, `effort: high` — a session switched to a small model
  for mechanical work can no longer silently degrade the lenses that gate migrations, auth and the
  write path. `fact-sheet`: `haiku`/`medium`. The frontmatter **is** the policy; the skills README
  carries the grep that prints it, not a copy of the values.
  The two sanctioned downscales are annotations on `plan-with-panel`'s existing tables (small-visual
  UX pass and the round-2 light pass spawn at `medium`); the drafted xhigh escalation was deleted —
  its trigger was nearly coextensive with the agents' spawn condition, and it would have reviewed a
  migration's plan harder than the migration's diff. Panel logs now record per-lens cost (template in
  `docs/plans/README.md`), with a named consumer: after three logged panels, a follow-up tunes the
  values or deletes the line.
  **Boundaries, stated so nobody cites them wrong:** the policy governs local spawns only — the
  `@claude review` CI job runs single-pass with subagents disallowed and never reads this frontmatter.
  Two settings override every pin silently and are confirmed unset (2026-11-03, firsthand):
  `CLAUDE_CODE_EFFORT_LEVEL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`. `CLAUDE_CODE_SUBAGENT_MODEL`
  sits _below_ frontmatter and would affect only built-in agents.
