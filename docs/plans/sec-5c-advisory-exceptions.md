# SEC-5c — a reasoned, expiring exception for one production advisory

**Status:** reconciled after the engineering panel (security + correctness lenses, Opus), 2026-11-17. Approved in
principle by the maintainer the same day: "Expiring exception" over "move the audit last and merge
red" and "pause merges until a fix". Backlog: [`SEC-5c`](../../.github/SECURITY.md#supply-chain),
named there as the deferred suppression mechanism.

_Roadmap alignment (2026-11-17): closes `SEC-5c` (Platform pillar); gates nothing new; unblocks every
open PR's `quality` job. Checked against the private roadmap: nothing to add here._

## Why now

A `high` advisory, picomatch [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
(ReDoS through single-branch repeated extglobs, every version `<= 4.0.7`), reached the production
tree through `@sentry/nextjs`. **No patched version exists**: GitHub's record has
`first_patched_version: null`, and 4.0.7 is the latest version on npm. pnpm prints `patched: >=4.0.8`,
but that range is inferred, and SECURITY.md already says an inferred `patched_versions` is never
evidence of a fix.

So no override or bump can clear it, and `check-audit` fails every PR. Because the audit step runs
before format, lint, typecheck, test, the DB checks and the build in CI's `quality` job, every PR
also loses those checks while it fails. The repo's only escapes today are fix, reclassify as dev
(not honest: `@sentry/nextjs` is a runtime dependency), or merge red.

**Exposure:** picomatch is reached only through build-time tooling that Sentry pulls in
(`@rollup/plugin-commonjs`, `@rollup/pluginutils`, `fdir`, and `vite`/`tinyglobby` via
`@sentry/cloudflare`). The app imports none of them, and they match file globs written in config,
never request input. That reasoning is the exception's `reason`, and it is what a reviewer checks.

## What changes

1. **`.github/audit-exceptions.json`**, a committed array. Each entry has exactly `ghsa`, `module`,
   `severity`, `paths`, `reason`, `added`, `expires`.
2. **`check-audit.mjs`**, in two phases.
   - **Before pnpm runs** (so the result never depends on the registry, and an outage's exit 2 can
     never make a bad list lenient), the list is validated; any failure exits **3**:
     - not valid JSON, not an array, or an entry with a missing or unknown field;
     - `ghsa` not a GHSA id; `module` not a package name; a path not in pnpm's `a>b>c` shape (both
       reach `::error::` lines, so no newline can smuggle a workflow command);
     - `severity` not `high` (**a `critical` is never exceptable**);
     - `reason` under 40 characters;
     - a date that is not a real calendar date (`2026-02-30` is refused);
     - `added` after today, or `expires − added` outside 0–30 days. Together these mean no entry can
       outlive today + 30;
     - two entries with the same `ghsa`.
   - **After every existing coherence rule** (none is weakened, and the counts are still checked
     against the full advisory list), the list is applied:
     - an advisory is excepted only if an unexpired entry matches its `ghsa`, `module` and `severity`,
       and every path in every finding is listed. An advisory with no findings is never excepted;
     - **exit 1**, printed beside any advisory that still blocks, when an entry has expired (today
       UTC is after `expires`; the expiry day itself passes), when an entry excepted nothing (gone,
       downgraded, moved), or when an entry lists a path pnpm no longer reports;
     - every excepted advisory prints a `::warning::` naming it and its expiry, and from seven days out
       it says so in capitals.
   - `--exceptions` and `--today` exist for the self-test and are refused (3) without `--report`,
     before pnpm is spawned, so a real run always reads the committed file and the real UTC date. A
     missing file means no exceptions.
   - **Not matched: versions.** pnpm's paths carry no version, and every picomatch `<= 4.0.7` is in
     the range, so another vulnerable version on a listed path is excepted. That is accepted: the
     exposure argument is about the path, not the version.
3. **`ci.yml`**: `.github/audit-exceptions.json` joins the dependency inputs in the audit step's
   `git diff`, so a PR that edits it gets no outage leniency.
4. **The self-test** gains a case per rule (47 cases in all), each built to fail if its rule goes.
5. **The one entry:** picomatch, the six paths `pnpm audit --prod` reports today, 2026-11-17 to
   2026-12-17.
6. **Docs:** SECURITY.md → Supply chain states the rule, and that any diff to the file is a review
   flag; tech-debt.md gets the entry, its hard date and the residual below; the `docs/plan.md` row and
   the roadmap note; a changelog fragment.

**Known cost:** on 2026-12-18 (UTC) every PR fails at the audit step again unless a reviewed PR has
renewed or removed the entry. That is deliberate; the warning starts seven days earlier.

**Residual, outside the audit:** Next vendors its own older picomatch, invisible to `pnpm audit`, used
at request time only for `images.*Patterns`, which this app does not set. Recorded in tech-debt.

## Not doing

- No `pnpm audit --ignore` or `auditConfig.ignoreCves`: the guard already rejects those by shape
  (exit 3), and they would hide the advisory rather than name it.
- No version pinning in entries (above).
- No base comparison of the file (a renewal could rewrite `added`). The review flag in SECURITY.md is
  the control; SEC-5's panel rejected a same-PR control as moot, and that still holds here because CI
  runs the PR's own guard.
- No moving the audit step later in `quality`. The maintainer chose the exception; the job order
  stays as it is.
- No network check for a published fix: the expiry forces a re-check on a known date instead.
- Nothing in the dev tree changes.

## Review-response log

Panel 2026-11-17, both lenses on `claude-opus-5-5`. **Models:** author claude-opus-5-5; high-stakes no.

| #       | Lens           | Finding                                                                                                    | Response                                                                                                     |
| ------- | -------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| C1      | correctness P1 | A future `added` evades the 30-day window                                                                  | Fixed: `added` after today exits 3; tested                                                                   |
| C2      | correctness P1 | The `--today`-without-`--report` case spawns pnpm, so it fails in an outage                                | Fixed: flags are parsed before the spawn; the case runs under a pnpm shim and asserts no spawn               |
| C3      | correctness P1 | A bad list merges green during an outage (validated after the report; file not in the leniency diff)       | Fixed both ways: validated before the spawn (tested under a fetch-failed shim), and added to `ci.yml`'s diff |
| C4      | correctness P1 | `findings: []` and a second finding's path untested                                                        | Fixed: two cases                                                                                             |
| C5 / S2 | P2             | "A new version's finding is not excepted" is false                                                         | Claim removed; versions explicitly not matched, with the reason                                              |
| C6      | correctness P2 | Stale means "GHSA gone" only; listed paths can linger                                                      | Fixed: stale = excepted nothing; a listed path no longer reported fails; tested                              |
| C7      | correctness P2 | An expired entry hides a fresh high                                                                        | Fixed: both printed, exit 1; tested                                                                          |
| C8 / S6 | P2             | Expiry reds every PR with no warning                                                                       | Seven-day warning; the cost and the date are written down here and in tech-debt                              |
| C-also  | correctness    | Feb 30, `--today foo`, reason length, missing field, negative window, missing file, unknown findings shape | All fixed or stated; each has a case except the findings shape (exits 3 by construction)                     |
| C-also  | correctness    | Duplicate keys in one JSON entry resolve silently                                                          | Accepted: the reviewer reads the file; noted                                                                 |
| S1      | security P1    | The plan described a weaker guard than the one built                                                       | This rewrite                                                                                                 |
| S3      | security P2    | Strings from the file reach `::error::` lines                                                              | Fixed: `module` and paths shape-checked; `reason` never printed; tested                                      |
| S4      | security P2    | Nothing makes an added or renewed entry visible                                                            | SECURITY.md: any diff to the file is a review flag; base comparison declined (Not doing)                     |
| S5      | security P2    | The file was not in the leniency diff                                                                      | Fixed (C3)                                                                                                   |
| S7      | security P2    | The exposure reason named the wrong condition; Next's vendored copy; vite via the dev tree                 | Reason rewritten; the vendored copy recorded in tech-debt; vite path churn is caught by the exact-path rule  |
| S-nit   | security       | Uniqueness keyed on `ghsa` alone                                                                           | Accepted: fails closed                                                                                       |
