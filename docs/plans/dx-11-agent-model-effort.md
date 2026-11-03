# DX-11 — model & effort policy per agent role, committed in frontmatter

> Backlog: [plan.md](../plan.md) row DX-11. Branch: `chore/dx-11-agent-model-effort`.

## Goal

Every agent in `.claude/agents/` runs today on whatever model and effort the spawning session happens
to use: no definition sets either field. That makes panel quality a per-session accident — a session
switched to a small model for mechanical work silently spawns its correctness reviewer on that model
too. Claude Code reads a subagent's `model`/`effort` from its frontmatter before falling back to the
session (Mechanics below), so the policy can be committed once and apply automatically on every
spawn, by any session, with no one remembering anything. This PR commits it.

## The policy

Two classes. **The frontmatter is the policy**; this table is the shipped rationale, frozen with the
plan — when a value is later tuned, only the frontmatter changes.

| Agents              | `model` | `effort` | Why                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| all eight reviewers | `fable` | `high`   | Findings are acted on after only the author's reconciliation, so depth is the product. Pinning **all** reviewers keeps the boundary trivial (no re-argument when an agent is added) and the pin is one line against a silent, safety-shaped failure: a safety lens degraded by a session's model choice. |
| `fact-sheet`        | `haiku` | `medium` | Grep-read-report; its consumer re-opens what it cites. `medium`, not `low`, protecting the `path:line` cites that are its whole product (`medium` is also Haiku 5.5's default, so this pin states intent rather than fighting anything).                                                                 |

The one sanctioned downscale stays where it already lives: `plan-with-panel` §2's small-visual-change
row spawns `ux-reviewer` with `effort: medium`, and §4's re-review ("one light pass") spawns the lens
at `medium`. No xhigh escalation: a trigger that fires on essentially every spawn of an agent belongs
in that agent's frontmatter, and it would have put a migration's _plan_ above the migration's _diff_
(`review-pr` fans out to the same agents). If migrations later earn more depth, that is a one-line
frontmatter bump with evidence.

**Not governed by this policy:** the main session (always the `/model` choice); the built-in
Plan/Explore/general-purpose agents (not ours to pin); and the `@claude review` CI job — it runs
`review-pr` single-pass with `Task,Agent,Skill` disallowed (`.github/workflows/claude-review.yml`),
so no subagent frontmatter is ever read there. The pins govern local spawns only; do not cite them as
covering CI review.

## File-by-file changes

| Path                                                          | Change | What                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/*.md` (9 files)                               | EDIT   | Add `model:` + `effort:` per the table. Nothing else changes.                                                                                                                                                                                                                                                                                                                               |
| `.claude/skills/plan-with-panel/SKILL.md`                     | EDIT   | No new trigger prose (the §0/§2 tables stay the single statement of when a lens runs). §2's small-visual-change row gains `(spawn effort: medium)`; §4's light pass gains the same annotation; §3's example log shows the Panel-cost line filled in. A spawn-time `effort` is honoured by the tool unconditionally — these annotations are what _sanctions_ passing it.                     |
| `docs/plans/README.md`                                        | EDIT   | The log template (owner of the template; the skill only mirrors it) gains one header line: `> Panel cost: <lens>: <tokens> · <duration>, …` — filled from the task notifications. Consumer: after three logged panels, a follow-up tunes or confirms the frontmatter values, or deletes this line.                                                                                          |
| `.claude/skills/review-pr/SKILL.md`                           | EDIT   | One sentence in "Size the effort": fan-out spawns are governed by the agents' frontmatter (DX-11); "effort" in that paragraph means fan-out breadth, not the spawn parameter.                                                                                                                                                                                                               |
| `.claude/skills/README.md`                                    | EDIT   | One paragraph under the guards table, pointers only: the policy **is** the frontmatter (`grep -H '^model:\|^effort:' .claude/agents/*.md` prints it, mirroring the description-grep idiom above it); rationale in this plan; and the two overrides that beat frontmatter silently — `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` — must stay unset. No values restated. |
| `docs/plan.md`                                                | EDIT   | DX-11 row, four lines, linking this plan.                                                                                                                                                                                                                                                                                                                                                   |
| `docs/roadmap.md`                                             | EDIT   | One "Recently landed" row under **Platform** (`.claude/` is a Platform glob).                                                                                                                                                                                                                                                                                                               |
| `docs/changelog/2026-11-03-chore-dx-11-agent-model-effort.md` | NEW    | The fragment: the two-class policy in two sentences; names the two overriding env vars exactly (no "env > frontmatter" shorthand — one of the three subagent-model vars sits _below_ frontmatter); notes the policy is inert in CI review.                                                                                                                                                  |

## Acceptance

- Backlog criterion (new row, this PR): _Every `.claude/agents/*.md` declares explicit `model` and
  `effort`; the sanctioned downscales are annotations on `plan-with-panel`'s existing tables; panel
  logs record per-lens cost._
- Done when:
  - The nine frontmatters carry the table; the PR body quotes the grep output.
  - The four skill/template edits above have landed; `pnpm verify` green (`skills:check` ignores
    frontmatter keys — verified; nothing in-repo parses them).
  - **Overrides confirmed unset** — done, 2026-11-03, firsthand: `env` is null in both user settings
    files and absent from project settings; `modelSettings` carries only the `/model` session picks.
  - **First-spawn spot-check (maintainer, one look):** on the first panel after merge, `/tasks` shows
    a reviewer on Fable and, on the first small-visual-change UX pass, `medium`. This is the live
    check that the `fable`/`haiku` aliases resolve and that a sanctioned spawn effort really beats
    the per-model `effortLevel` in user settings (the high-vs-high frontmatter case is
    indistinguishable by construction; Risks bullet 2 has the honest residual).
  - After three logged panels: a follow-up tunes/confirms the values or deletes the cost line.

## Mechanics (verified against the Claude Code docs 2026-11-03, and the installed CLI, v2.1.314)

Stated once here; the README paragraph and fragment point at this, naming only the override vars.

- **Model resolution:** spawn-time `model` parameter (aliases only) → frontmatter `model` (alias,
  full ID, or `inherit`) → `CLAUDE_CODE_SUBAGENT_MODEL` env → the session's model. The `_FORCE=1`
  variant inverts the middle step and beats frontmatter. Note `CLAUDE_CODE_SUBAGENT_MODEL` itself
  sits **below** frontmatter (since v2.1.251) — with all nine agents pinned, that var would affect
  only the built-in agents.
- **Effort resolution:** `CLAUDE_CODE_EFFORT_LEVEL` env beats everything settings-side, silently. Below it, a
  spawn-time `effort` parameter (v2.1.292) beats frontmatter; frontmatter beats the session level.
  The session level is the `/model`/`/effort` pick, persisted as `modelSettings.<model>.effortLevel`
  in user settings — the settings tier of the session default, which is why frontmatter outranks it.
  The docs do not order the spawn parameter against the env var; moot here, the env var is unset.
  Model defaults when nothing is set: `high`, except Opus/Sonnet/Haiku 5.5 at `medium`.
- Verified on this machine: the CLI binary enumerates `low|medium|high|xhigh|max` and carries the
  `fable`/`haiku`/`inherit` alias literals; `/tasks` shows a running subagent's model.
- Skill frontmatter also takes `model`/`effort`, but it applies to the **main thread for the rest of
  the turn**, not to agents the thread spawns — the wrong scope for this policy, so unused here.

## Risks / rollback

- **An env override lands later.** `CLAUDE_CODE_EFFORT_LEVEL` or `_FORCE` in any settings `env` block
  would void every pin with no error. Confirmed absent today (firsthand, above); the README names
  both; a guard is not worth its weight until this fails once (`check-skills.mjs` already walks the
  directory if it ever does).
- **The per-model `effortLevel` turns out to beat frontmatter.** The documented order says it does
  not (it is the session tier), and the two-class policy is nearly immune anyway: the reviewer pins
  are `high`, equal to the stored picks, and fact-sheet's `medium` equals Haiku's own default. The
  only observable case is the sanctioned UX/re-review `medium` spawn — exactly what the first-spawn
  spot-check watches.
- **`haiku` on fact-sheet degrades citation quality.** Consumer re-opens cites; if a fabricated cite
  slips through once, bump the model and record it in lessons.md.
- Rollback: revert the squash; the fields are additive, nothing in-repo parses them.

## Out-of-scope / deferred

- A statusline showing the session's model/effort (user-side; on request).
- Pinning built-ins via `CLAUDE_CODE_SUBAGENT_MODEL` (hits every spawn; revisit with evidence).
- A frontmatter-presence assertion in `check-skills.mjs` (nine lines, available the first time a new
  agent ships without the fields).
- Any change to which lenses run when.

## Open questions

- None blocking. The first-spawn spot-check and the three-panel revisit are scheduled above.

## Review-response log (adversarial panel)

### Engineering panel (round 1) — correctness, scope, architecture, reuse, in parallel

| #    | Lens         | Critique (short)                                                                                                                                                                                              | Verdict                 | Resolution                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-B1 | Correctness  | User settings carry `modelSettings.effortLevel: high` for fable/opus (the `/model` picks) and the plan never says whether frontmatter beats it; if not, every sub-high pin no-ops on the maintainer's machine | **accepted**            | Mechanics now states the full order with `modelSettings` placed as the session tier (docs-chained, not guessed); Acceptance gains the first-spawn `/tasks` spot-check; and the accepted S-S2 policy makes the question nearly moot (high=stored pick; fact-sheet medium=Haiku default). Risks bullet corrected: both env blocks are readable and null — verified firsthand, not hedged |
| C-S1 | Correctness  | Resolution order stated inconsistently in three places; fragment would commit a false "env > frontmatter" generalisation (`CLAUDE_CODE_SUBAGENT_MODEL` sits _below_ frontmatter)                              | **accepted**            | One order, stated once in Mechanics incl. `_FORCE`; README/fragment name the two overriding vars exactly and point here                                                                                                                                                                                                                                                                |
| C-S2 | Correctness  | Out-of-scope bullet contradicted the stated order                                                                                                                                                             | **accepted**            | Reworded: with all nine pinned, that var affects built-ins only                                                                                                                                                                                                                                                                                                                        |
| C-N1 | Correctness  | "Tool honours spawn effort only when a skill asks" conflated mechanism with sanction                                                                                                                          | **accepted**            | Reworded in File-by-file: honoured unconditionally; the table annotations are the sanction                                                                                                                                                                                                                                                                                             |
| C-N2 | Correctness  | Say the policy is inert in `@claude review` (no subagents in CI mode)                                                                                                                                         | **accepted**            | "Not governed" paragraph, with the workflow cite (also A-S3)                                                                                                                                                                                                                                                                                                                           |
| S-S1 | Scope        | The xhigh escalation duplicates frontmatter for a trigger nearly coextensive with the spawn condition, and puts a migration's plan above its diff                                                             | **accepted**            | Escalation deleted; one effort per agent in frontmatter; the UX downscale (a real pre-existing mode) is the only spawn-time override kept                                                                                                                                                                                                                                              |
| S-S2 | Scope        | Five policy rows on thin, partly miscited evidence (DX-10's scope findings were reasoning, not grep); pin-boundary at 4 of 8 must be re-argued per new agent. Two classes, same safety                        | **accepted**            | Policy collapsed: all reviewers `fable`/`high`, fact-sheet `haiku`/`medium`. The DX-10 miscitation is withdrawn with this table                                                                                                                                                                                                                                                        |
| S-S3 | Scope        | The measurement line has no consumer; cost can never show quality degradation                                                                                                                                 | **accepted**            | Named consumer in Acceptance (three-panel revisit, explicit licence to delete the line); its limit — cost only, never quality — kept in the README template comment                                                                                                                                                                                                                    |
| S-S4 | Scope        | "Could not read user settings" was half-verified; one Done-when bullet beats prose                                                                                                                            | **accepted**            | Verified firsthand and moved into Done-when as a completed check                                                                                                                                                                                                                                                                                                                       |
| A-B1 | Architecture | The plan named its own frozen table as the living source — the DX-2 failure the skills README itself records                                                                                                  | **accepted**            | "The frontmatter is the policy" stated in §Policy and in the README paragraph, which carries the grep instead of values                                                                                                                                                                                                                                                                |
| A-S2 | Architecture | `reporting-contract.md` "misses nothing" contradicts a medium pin on two reviewers                                                                                                                            | **moot via S-S2**       | No reviewer is pinned below high any more; no contract edit. Logged so nobody "fixes" a phantom mismatch later                                                                                                                                                                                                                                                                         |
| A-S3 | Architecture | State that the policy does not govern `@claude review`, or someone will cite the pins as covering CI                                                                                                          | **accepted**            | "Not governed" paragraph + fragment line                                                                                                                                                                                                                                                                                                                                               |
| A-S4 | Architecture | xhigh on plan panels but not on `review-pr` diffs of the same artifacts is backwards                                                                                                                          | **accepted via S-S1**   | Escalation deleted; plan and diff reviews now run identical frontmatter. review-pr gains the one pointer sentence (R-S4)                                                                                                                                                                                                                                                               |
| A-N5 | Architecture | Verify the aliases actually resolve; silent fallback is the exact failure the policy exists to prevent                                                                                                        | **accepted**            | Alias literals confirmed in the installed binary; live resolution folded into the first-spawn spot-check bullet                                                                                                                                                                                                                                                                        |
| A-N6 | Architecture | Acceptance is prose-only; a tenth agent could ship without the fields                                                                                                                                         | **rejected (deferred)** | Earn-by-failure, the repo's own doctrine and the lens's own framing; the nine-line `check-skills.mjs` assertion is named in Out-of-scope for when it fails once                                                                                                                                                                                                                        |
| R-S1 | Reuse        | README paragraph as worded blessed a third copy of the values                                                                                                                                                 | **accepted**            | Pointer-only paragraph (same fix as A-B1)                                                                                                                                                                                                                                                                                                                                              |
| R-S2 | Reuse        | Escalation lines re-encoded trigger conditions already stated in two tables with different wording                                                                                                            | **accepted**            | No new condition prose anywhere; annotations on the existing §2 row and §4 bullet only (and the xhigh lines are gone entirely per S-S1)                                                                                                                                                                                                                                                |
| R-S3 | Reuse        | The cost line was added to the skill's copy of a template that `docs/plans/README.md` owns — the README version would win and erase it                                                                        | **accepted**            | Line lands in the README template; the skill's §3 example merely shows it filled                                                                                                                                                                                                                                                                                                       |
| R-S4 | Reuse        | `review-pr` spawns the same agents but the plan discussed only panels; its "Size the effort" becomes a second uncoordinated statement                                                                         | **accepted**            | One pointer sentence in that paragraph; "Not governed" text scopes CI out explicitly                                                                                                                                                                                                                                                                                                   |
| R-N5 | Reuse        | Resolution order restated five times across plan/README/fragment                                                                                                                                              | **accepted**            | Stated once in Mechanics with source + fetch date; everything else points                                                                                                                                                                                                                                                                                                              |

### Round 2 — light re-review by correctness and architecture (the lenses whose blocking findings reshaped the plan)

| Lens         | Result                                                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness  | **B1 resolved** (order stated once; collapse makes it nearly unobservable; spot-check covers the residual). Two NITs taken: the Acceptance sentence no longer overclaims what the spot-check proves, and the env-var sentence reads "settings-side" |
| Architecture | **B1 resolved** (one living source — the frontmatter; README is pointer-only; grep verified correct). No new findings                                                                                                                               |
