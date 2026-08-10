# BUG — a form submit is silently lost (surfaces as the "check-ins e2e flake")

> **Status:** OPEN, root cause NOT found. Mechanism confirmed, hypotheses narrowed.
> **First seen:** 2026-07-24 · **Occurrences:** 12+ CI runs across 18 days · **Owner:** unassigned
> **Severity:** medium-high — the evidence points at a **real user-facing defect**, not just a test issue.

This is a **research dossier**, not a plan. It exists so the next investigation starts from measured
evidence instead of repeating the four theories already killed. A fix plan comes after the open
question below is answered.

## Summary

A form submission is **silently swallowed**: the click produces **no server request**, **no database
row**, **no error**, and the UI never leaves its pre-submit state. The test that observes it then waits
out its full assertion timeout on text that can never appear.

It presents as a flaky Playwright test, which is why it went 18 days without diagnosis. **It is not a
timeout and not a performance problem** — the server, when it is reached at all, responds in 1–26ms.

## Impact

- **Users (suspected):** a tap on a form button is lost with no feedback — no error, no pending state,
  no row. On a phone on a gym floor this is "I tapped Log and nothing happened." **Unconfirmed in
  production** (nobody has reported it), but it is the same code path.
- **CI:** has now falsely reddened **three unrelated Dependabot PRs** (#80, #83, #84), which is exactly
  how a team learns to ignore red checks. The cost of an unfixed flake is the signal it destroys
  elsewhere.
- **Roadmap:** V1-14b (full-day E2E asserting a clean CSV diff) is the longest sequential-write test in
  the suite and will be the most exposed to this.

## Timeline (from CI history, not memory)

| When                 | Run           | Branch                       | Result                        | Locator(s)                                     |
| -------------------- | ------------- | ---------------------------- | ----------------------------- | ---------------------------------------------- |
| **2026-07-24 17:01** | `30111344353` | `main`                       | 1 failed, 3 passed            | `Log check-ins` **and** `Bodyweight — 72.5 lb` |
| 2026-07-25 04:13     | `30143642041` | `db/v1-8-1-supersets-schema` | 1 failed, 1 flaky, 3 passed   | `Log check-ins`                                |
| 2026-07-29 00:59     | `30412785273` | `main`                       | 1 failed, 4 passed            | `Log check-ins`                                |
| 2026-07-30 08:06     | `30525387638` | `db/v1-10-seed-program`      | 1 failed, 1 flaky, 3 passed   | `Log check-ins`                                |
| 2026-07-30 08:23     | `30526533085` | `main`                       | 1 **flaky** (passed on retry) | `Log check-ins`                                |
| 2026-07-30 23:44     | `30591454336` | PR #68                       | **2 failed**                  | `Log check-ins`, `Wake · logged today`         |
| 2026-08-05 04:06     | `30974170311` | PR #71                       | 1 failed, 1 flaky             | `Log check-ins`                                |
| 2026-08-05 17:42     | `31031282808` | PR #74                       | 1 failed, 1 flaky, 8 passed   | `Log check-ins`, `Wrestling practice`          |
| 2026-08-05 17:55     | `31032302685` | PR #80                       | 1 failed                      | `Log check-ins`                                |
| 2026-08-05 21:25     | `31048539364` | PR #83                       | 1 failed                      | `Log check-ins`, `Bodyweight — 0.5 lb`         |
| 2026-08-05 21:25     | `31048549788` | PR #84                       | 1 failed, 9 passed            | `Log check-ins`                                |
| 2026-08-06 02:02     | `31064482279` | PR #81                       | 1 failed                      | `Log check-ins`                                |
| 2026-08-10           | local, ×10+   | `fix/e2e-checkins-flake`     | reproduced consistently       | all of the above                               |

**First occurrence: 2026-07-24 17:01 on `main`**, immediately after `db/v1-6b-1-ramp-target` merged. The
two failures before that date (`2026-07-20`, `29787674175`/`29787308715`) are a **different** bug — a
Playwright strict-mode violation during V0-11's own development — and are not this.

Note the very first occurrence already showed **both** signature locators, so this is one bug with
several observation points, not several bugs.

## Evidence (all measured on 2026-08-10)

Three independent measurements, in the order that mattered:

1. **Server-side timings: 1–26ms.** Instrumented `getActivityTypeByKey`, `logBodyweightAction`,
   `logCheckinsAction` and the Today RSC render. Every value: `getActivityTypeByKey 23ms` (first, cold),
   then `0–2ms`; `logBodyweightAction 9ms`; `logCheckinsAction 5ms`; `TodayPage reads 26ms` then `2–4ms`.
   **→ The server is not slow. Every cold-start / contention theory is dead.**
2. **The database, queried directly after a failing run, held exactly one bodyweight row** — the
   setup's `0.500`. The test's `72.5` was **never written**.
3. **The action logged no invocation at all** for the lost submit. Only one `logBodyweightAction` fired
   (returning `{"ok":true,"error":null}`) where two were expected.

**→ The click never became a server request.** The failure is upstream of the network, on the client.

Supporting observation: the failure **point moves** (bodyweight, check-ins, life activities) but is
always the **first submit after a fresh navigation** in whichever test is affected.

## Hypotheses tested and KILLED

Do not re-test these without new evidence.

| #   | Hypothesis                                              | Killed by                                                                                                                         |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The Sentry action wrapper (V1-14a) adds latency         | Identical results with and without it, 3 runs each                                                                                |
| 2   | Per-action cold start — the setup warms only bodyweight | Warming the check-ins path dropped that spec 15s→1s and **did not fix it**                                                        |
| 3   | Playwright worker contention                            | Reproduces at `--workers=1` (CI's config) as well as `--workers=5`                                                                |
| 4   | `global.setup`'s 30s test timeout                       | Raising it to 180s fixed a **real latent bug** (setup could silently skip warming) but not this                                   |
| 5   | Click-before-hydration                                  | **Failed 4/4.** Also contradicted by reasoning: React 19 forms submit natively pre-hydration, so an early click should still POST |

Hypothesis 5's fix (waiting on the `tz` cookie as a hydration proxy) was **reverted** rather than
shipped unverified.

## Known aggravating factor (self-inflicted)

**V1-12 made this more frequent.** Raising `global.setup`'s timeout to 180s means the warm-up now
_reliably_ completes, so it reliably writes a row and reliably races whatever follows. Before, it often
timed out and silently did nothing, which accidentally avoided the collision. The timeout raise is still
correct on its own merits — but it changed the flake's frequency and that must be accounted for when
comparing pre/post-V1-12 CI history.

## THE open question — the one measurement not yet taken

**Was a network request ever made?** Everything so far is inferred from the server and the DB. The
decisive experiment is browser-side:

```ts
page.on('request', (r) => console.log('→', r.method(), r.url()));
page.on('requestfailed', (r) => console.log('✗', r.url(), r.failure()?.errorText));
page.on('response', (r) => console.log('←', r.status(), r.url()));
```

Run the suite with this attached and capture a failing iteration. It splits the remaining hypotheses
cleanly:

- **No POST at all** → the click never triggered a submit. Look at: the button being re-rendered out
  from under the click (an RSC refresh replacing DOM nodes mid-click), `TimeZoneSync`'s
  `router.refresh()`, or React 19 form-action attachment.
- **A POST that was aborted/failed** → look at navigation cancelling an in-flight Server Action, or the
  RSC refresh racing the action.
- **A POST that returned 200 with no row** → back to the server; look at `resolveDeclaredDay`'s ±1 bound
  and the `ON CONFLICT DO NOTHING` idempotency path returning success for a swallowed write.

Secondary experiments, in order of expected value:

1. Capture a **Playwright trace** (`trace: 'on'`) of a failing run and inspect the DOM snapshot
   immediately before and after the click.
2. Check whether `TimeZoneSync`'s `router.refresh()` fires in CI. It should NOT (Playwright pins
   `timezoneId: 'America/Los_Angeles'`, matching `DEFAULT_TIME_ZONE`) — **verify rather than assume**,
   because a refresh mid-click would explain a lost submit exactly.
3. Test whether the lost submit reproduces with JavaScript disabled (native form POST). If it does
   **not**, the defect is in the client hydration/attachment path.

## What NOT to do

- Do not pad assertion timeouts. The server responds in milliseconds; a longer timeout hides the bug.
- Do not add more warm-up writes. That was hypothesis 2, and more writes made it worse.
- Do not bolt a speculative fix onto a feature PR. Two attempts have already been reverted.

## Related

- `docs/lessons.md` → E2E section (the ruled-out list is mirrored there for grep-ability)
- `ci-skip-e2e` label — the documented escape hatch, applied to #83/#84 so unrelated dependency bumps
  could merge. **Every use should be linked back here.**
