# Review agents run on Opus; Fable only for high-stakes plans and reviews

DX-11 (#328) pinned all eight reviewer agents to `model: fable`, `effort: high`, so every `review-pr` fan-out, `doubt-check` and ad-hoc lens ran on Fable as well as the plan panels. With several FAM-1 lanes fanning out on every PR, that used up the account's monthly Fable budget on 2026-11-16. The maintainer's rule: Fable is for the work where depth matters most.

- The eight reviewers' frontmatter now pins `model: opus`, still at `effort: high`. `fact-sheet` stays on Haiku.
- `.claude/skills/README.md` → "When a lens runs on Fable" names the high-stakes areas as path globs: contract and shared shapes, schema and migrations, the write path, authorization and household scope, privacy, and loads. `plan-with-panel` and `review-pr` pass `model: "fable"` (a spawn-time model beats frontmatter) only when a plan or diff touches one. Everything else, including re-review passes, runs on Opus.
- `skills:check` refuses a reviewer whose frontmatter pins `fable` (a bare alias or a full `claude-fable-*` id), with four new self-tests, so the pin can't come back unnoticed.
