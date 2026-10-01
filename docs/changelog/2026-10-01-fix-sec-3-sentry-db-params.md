- **2026-10-01** — **SEC-3: a failed database call no longer ships the write's values to Sentry.**
  drizzle-orm's `DrizzleQueryError` message is `Failed query: <sql>` followed by `params: <values>`,
  and the Server Action instrumentation captures it on any driver failure, such as a timeout or a
  dropped connection. So a weigh-in that failed to save sent the child's weight to a third party.
  `scrubSentryEvent` now cuts the `params:` tail off every exception value (the whole cause chain),
  the event message, `logentry` and breadcrumbs, keeping the SQL (placeholders, not values), and
  drops any key named `params` at any depth in `extra`, `contexts` and breadcrumb data, which is
  where an error-data integration would copy the error's own property. Server and edge configs both
  use it. Tested on a real `DrizzleQueryError`.
