# chore(sec-5c): drop the picomatch audit exception; GitHub withdrew the advisory

GitHub withdrew GHSA-fc5q-39xc-vjpf (picomatch ReDoS) on 2026-11-18 at 15:38 UTC, so `pnpm audit` stopped
reporting it. The SEC-5c guard then failed every PR's `quality` job with "exception … is stale: it
excepted nothing in this report", which is the guard working as designed: an exception that no longer
excepts anything must be removed.

- `.github/audit-exceptions.json` is now an empty list (the mechanism stays).
- The tech-debt entry for the exception is closed. Its residual note about Next's vendored picomatch
  falls away with the withdrawn advisory.
