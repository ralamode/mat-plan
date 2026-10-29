- **2026-10-29** — **`AGENTS.md` on a diet: 6,565 → 4,639 words, every rule kept, every cite
  resolving** ([plan](../plans/dx-10-agents-md-diet.md), reshaped by a four-lens panel). The contract
  every session and subagent loads had grown a third of incident narrative — the TEN-2b race, PR
  numbers, three "verified via the API" stamps, three separate Neon-branch caveats, and paragraphs
  restating `lessons.md`, `tech-debt.md`, `plans/README.md`, `features/README.md`, the PR template and
  the skills. Each removed block is a row in the plan's move table with a destination; the rules stay,
  with a trailing link where the reason moved. The two Neon facts now appear once each: preview
  isolation in "Git & branch workflow", the unwired rehearsal in the gate list.
  🔴 **The plan's ≤ 4,000-word ceiling was not met.** Three passes landed at 4,639 (a 29% cut); the
  panel's arithmetic under-counted the sections the plan promised not to touch (~1,700 words of fenced
  conventions and rules). Going further means cutting rules, which this PR refuses by design. The
  advisory word count now prints in `hold-the-bar`'s bar-file notice whenever `AGENTS.md` is in a diff,
  against that 4,000 budget, so the gap is visible on every edit until the maintainer resets it.
  **Two stale claims retired, plainly:** the DB rules said the empty-Postgres migration apply was NOT
  wired — the e2e job has run `db:migrate` + `db:seed` against a `postgres:17` service for months
  (`ci.yml:377, 483-484`); the "seeds run twice → idempotent" check is not in `ci.yml` and is no longer
  claimed. The DoD box that ticked "+ a Neon branch" and the PR template's "Neon branch" hint said the
  same false thing and are corrected.
  **Citations repaired:** `ui-screenshot/SKILL.md` pointed at the paragraph this PR removes (now
  `lessons.md`); `lessons.md` cited an AGENTS.md heading that never existed (now "Start here");
  `tech-debt.md` quoted the deleted DB-fence sentence; `review-pr/SKILL.md` misquoted the "don't" list
  heading. A multiline probe for `AGENTS.md → "…"` cites across the tree prints no `MISSING`.
