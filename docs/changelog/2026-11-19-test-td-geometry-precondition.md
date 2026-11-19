- **2026-11-19** — **The layout check that a short page's footer sits on the bottom edge no longer
  fails when other tests have added athletes.** The household settings page lists every athlete on
  the test database the whole suite shares, so it grew run by run, and once it was taller than the
  fixed 2400px test viewport the check failed and blamed the layout. The test now measures the page
  first and makes the viewport taller than it; a [lessons entry](../lessons.md) records the cause.
