---
name: hold-the-bar
description: Catch a mat-plan change that reached green by quietly lowering the quality bar — new @ts-ignore / eslint-disable / squawk-ignore / gitleaks:allow, skipped or .only'd tests, deleted test files, assertions pulled out of tests that stayed, stub throws, swallowed errors, or edits to the bar's own definition (AGENTS.md, the DoD, .squawk.toml, CI workflows, lint/ts/test configs). Run it whenever a red check just turned green, before every PR (ship-pr calls it), or when the user asks "did we cut any corners?".
---

# Hold the bar

The bar is already written down, in [AGENTS.md](../../../AGENTS.md) and
[docs/definition-of-done.md](../../../docs/definition-of-done.md). This skill doesn't add a
CONSTRAINTS.md file. It watches the diff for the cheapest road to green: agents rarely craft clever
loopholes, they just silence the thing that is red.

Adapted from `constraint-driven-development` in
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills).

## Run it

```bash
bash .claude/skills/hold-the-bar/check.sh             # diff vs origin/main, uncommitted edits included
bash .claude/skills/hold-the-bar/check.sh <base-ref>  # e.g. HEAD~3
```

Changed the script? Run its self-test, `bash .claude/skills/hold-the-bar/check.test.sh`, which
plants each violation in a throwaway repo.

Exit `0` means clean. Exit `1` means one or more finding groups:

| Finding                              | What to do                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New suppression                      | Fix the cause. If it is truly justified, write the reason on the line directly above. For `squawk-ignore` it must be _directly_ above the statement (lessons.md).                                                                                                                                                                             |
| `.skip` / `.only` / `.todo` / `xit`  | `.only` never ships. `.skip`/`.todo` needs a reason and a backlog row, or it gets removed.                                                                                                                                                                                                                                                    |
| Deleted test file                    | Say in the PR where that coverage went (moved? replaced? the code was deleted?).                                                                                                                                                                                                                                                              |
| Fewer `expect()` in a surviving test | Usually a refactor. Confirm the behaviour is still asserted, not just the happy path.                                                                                                                                                                                                                                                         |
| Stub or swallowed error              | Implement it, or throw to `error.tsx`. Expected failures use the typed `{ ok:false }` envelope. Never swallow errors in app code. Only tooling (`.claude/`, `.github/scripts/`), e.g. a hook that must fail open, may swallow deliberately, and it states why _inside_ the block, `catch { /* why */ }`. A bare `catch {}` is always flagged. |
| The bar itself changed (notice)      | Tightening is fine and needs no comment. Loosening needs a line in the PR saying why.                                                                                                                                                                                                                                                         |

**Every finding either gets fixed or gets a one-line justification in the PR description.** The script
can't tell a good reason from a bad one, but the PR reviewer can.

## Rules that aren't in the script

- **Never relax a threshold to make a change pass**: the CWV budget, the 44px tap target, a test
  timeout, Playwright `retries`. A flaky test is a bug to fix, per the DoD's E2E rules.
- **Don't cite a gate that isn't wired.** AGENTS.md carries an explicit warning. Before claiming a
  check protects something, confirm it exists in `.github/workflows/`.
- **At least one external opinion.** axe (`apps/web/e2e/a11y.spec.ts`), gitleaks, Squawk and
  `audit:check` are the checks an agent can't talk its way past. Keep them in the loop; don't route
  around them.

## Red flags

- A red check went green in the same commit that touched its config.
- "Pre-existing failure, so I skipped it." Name it in the PR and file it; don't hide it.
- `--no-verify` anywhere in the session.
