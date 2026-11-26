### PERF-3 — a ✓ no longer re-fetches every link on the day page

- **Changed:** marking a set done (and un-done, re-done or changed) no longer makes the browser fetch
  every page linked from the day page again in the background: about 16 requests per tap on
  production, each competing with the next tap on a phone's connection. The ✓ still returns the
  updated day page, so counts and "Done ✓" update as before ([plan](../plans/perf-3-tick-latency.md)).
  Two further steps are planned: the ✓ answering with its row only, and the write reading the
  household once.
