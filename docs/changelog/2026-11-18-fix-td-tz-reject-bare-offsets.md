- **2026-11-18** — **A time-zone cookie holding a bare offset falls back to the default zone.** The
  app reads the device's time zone from a cookie and checks it before using it for dates. The check
  asked only whether JavaScript's date library accepts the value, and that library also accepts
  offsets such as `+05:00` and abbreviations such as `EST`. Postgres reads a bare offset with the sign
  reversed, so if a database query ever did date math with that value, it would land on a different
  day from the app's own. Only a zone name (`America/New_York`, `Etc/GMT+5`) or `UTC` is accepted
  now. No query does that math today, so nothing was misdated; a browser only sends such a value if
  someone edits the cookie by hand.
