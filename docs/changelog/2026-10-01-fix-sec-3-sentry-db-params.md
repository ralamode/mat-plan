- **2026-10-01** — **SEC-3: a failed database call no longer ships the write's values to Sentry.**
  drizzle-orm's `DrizzleQueryError` message is `Failed query: <sql>` followed by `params: <values>`,
  and the Server Action instrumentation captures it on any driver failure, such as a timeout or a
  dropped connection. So a weigh-in that failed to save sent the child's weight to a third party.
  The scrubber now cuts the `params:` tail (also after an escaped `\n`, as in a serialized message)
  off every exception value in the cause chain, the event message and `logentry`, and walks
  `extra`, `contexts`, breadcrumb data and a transaction's spans, stripping every string and
  dropping every key named `params`. The walk matters: Next logs a failed action with
  `console.error`, and Sentry's console breadcrumb holds the normalized error, whose `message` and
  `stack` strings still carry the values after `params` collapses to "[Array]". A new
  `beforeBreadcrumb` hook drops a console breadcrumb's logged arguments outright, and a
  `beforeSendLog` hook covers Sentry logs before `enableLogs` is ever turned on. Server and edge
  configs both wire all four hooks. Tested on a real `DrizzleQueryError`.
