- **2026-10-06** — **SEC-5: a `high` or `critical` advisory in the production dependency tree now
  fails CI** ([plan](../plans/sec-5-verify-in-ci.md)). `pnpm audit:check` runs in `ci.yml`'s `quality`
  job and in local `pnpm verify` from one definition, so the threshold cannot drift between them, and
  its 19-case self-test runs **before** the install, so a broken guard fails in seconds instead of
  after install + test. The rule — scope, threshold, trigger — is stated once, in
  [SECURITY.md](../../.github/SECURITY.md) → Supply chain. **Why it was needed:** `audit --prod` lived
  only inside `pnpm verify` and no workflow ran `pnpm verify`, so **four** advisories reached `main`
  with CI fully green (`next` RCE, `source-map-js`, `proxy-addr`/`fast-uri`, `sharp` → librsvg), every
  one of them found by a local run during unrelated work rather than by a gate. **Could-not-check is
  two exit codes, not one**, because only one of them may ever be advisory: an unreachable registry is
  warned on a PR that changes no dependency input — a registry outage must not red unrelated PRs — while
  an unparseable, incoherent or config-disarmed report is never downgraded, and nothing is lenient on
  `main`. Collapsing those two is how the first draft of this guard shipped a permanently-green bypass.
  Scope is the `--prod` tree only: the dev tree holds a `high` whose patched version was never
  published, so gating it would wedge `main` with no edit that unwedges it. The daily full-tree audit
  (**SEC-5b**) and the expiring allowlist (**SEC-5c**) were cut out to their own backlog rows by the
  plan's scope lens — the allowlist alone was 60% of the guard and 17 of its 26 test cases, for a file
  that would have shipped empty.
