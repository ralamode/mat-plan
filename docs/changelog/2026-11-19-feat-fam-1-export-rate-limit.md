### Security

- **The zip export is rate-limited** (FAM-1 export follow-up, [plan](../plans/fam-1-export-owner-only.md)
  PR A). Thirty downloads per signed-in person per ten minutes, on its own key (`mat-plan:export`), so
  an export never spends a parent's ✓ budget. The count comes after the route's session and profile
  checks: an unknown id still answers the same `404` with no Redis call, and a cross-site page can't
  spend a parent's budget with a made-up id. Past the limit, a `429` with a fixed message. Fails open,
  like every limit here. A dead or timing-out limiter leaves an id-free breadcrumb, which reaches
  Sentry only with a later error; an Upstash timeout, which resolves rather than throws, now counts as
  a dead limiter for the mutation limits too.
