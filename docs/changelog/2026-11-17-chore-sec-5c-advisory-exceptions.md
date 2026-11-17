- **2026-11-17** — **A production advisory with no published fix can be excepted for up to 30 days,
  with its reasoning on record** (SEC-5c, [plan](../plans/sec-5c-advisory-exceptions.md)). A new `high`
  in picomatch, reached only through Sentry's build-time tooling, had no fixed version, and the audit
  failed every PR before lint, tests and the build could run. `.github/audit-exceptions.json` now
  excepts that one advisory by id, package and exact paths, until 2026-12-17. The audit still fails
  on any other advisory, on a `critical`, on an expired or unused entry, and on a malformed list, and
  every run that uses an exception says so.
