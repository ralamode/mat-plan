### Fixed

- **A dead rate limiter is reported to Sentry.** Every limit fails open, so a limiter that is down for
  good looked exactly like a healthy one: its only signal was a breadcrumb, which Sentry sends only
  with a later error, and a request the dead limiter let through succeeds. Now a `limiter-error`
  (an Upstash timeout included) raises one `rate limiter unavailable` event per server process per
  limiter family (`mutation` for both mutation policies, `export`), with two fixed tags, a fixed
  fingerprint per family (so Sentry's dedupe keeps the export's event when it follows the mutation's)
  and no id, and keeps the breadcrumb.
