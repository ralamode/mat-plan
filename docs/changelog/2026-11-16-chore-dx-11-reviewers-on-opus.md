# Review agents run on Opus; only plan panels ask for Fable

DX-11 (#328) pinned all eight reviewer agents to `model: fable`, `effort: high`, so every `review-pr` fan-out, `doubt-check` and ad-hoc lens ran on Fable as well as the plan panels. With several FAM-1 lanes fanning out on every PR, that used up the account's monthly Fable budget on 2026-11-16. The maintainer's rule is that Fable is for planning only.

- The eight reviewers' frontmatter now pins `model: opus`, still at `effort: high`. `fact-sheet` stays on Haiku.
- `plan-with-panel` spawns each plan lens with `model: "fable"`; a spawn-time model beats frontmatter.
- `review-pr` says not to pass Fable from a review.
- `skills:check` refuses a reviewer whose frontmatter pins `fable` (a bare alias or a full `claude-fable-*` id), with four new self-tests, so the pin can't come back unnoticed.
