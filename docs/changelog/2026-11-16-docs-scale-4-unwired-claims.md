- **2026-11-16** — **`SCALE-4`: rules the docs state but the code does not yet follow are marked as
  not wired** ([plan.md → SCALE-4](../plan.md#scale-4)).
  - **AGENTS.md:** last-write-wins on a client `updated_at` is `/api/sync`'s, at v1.5 (writers use
    the server's `now()` today); Sentry `enableLogs` and structured context are not wired (ADR 0001);
    Backend rule 6 now describes the idempotency the code has (a `clientId` in the body, a UNIQUE and
    `ON CONFLICT`) and its guarantee (a replay has one effect and the same result), not an
    `Idempotency-Key` header; rule 7 says the zip export's limiter and correlation-id logs are not
    wired. The word count is unchanged.
  - **`docs/principles.md`:** §4 notes that no list is cursor-paginated and that the zip export is
    built in memory on the request path; §8 notes that numbers and units are concatenated, not
    formatted with `Intl` (`I18N-1`).
  - **`apps/web/lib/active-timezone.ts`:** the comment no longer promises a `households.timezone`
    column; a stored zone belongs on the athlete, with a household default (`ID-1` keep-open item 4).

  "Request and response change ⇒ shared zod schema" was settled by `SCALE-1`. The
  `ramp_targets.week_start` comment in `packages/db/src/schema.ts` is left for FAM-1's lane A, whose
  file it is while its chain runs. `docs/roadmap.md` marks `SCALE-1` done and `SCALE-4` in review.
  Docs and one comment; no behaviour changes.
