### Removed

- **What the old log forms left behind in surviving files** (FAM-1 12f PR 2,
  [plan](../plans/fam-1-12f-retire-old-forms.md)).
  - **`lib/entries/activity-totals.ts`** keeps `loggedLifeActivities` and `loggedBodyweight` and drops
    the calisthenics totals and the strength-session rows (`calisthenicsTotals`, `todayRows`,
    `sessionMovements`, `movementNames`, `loggedMovements` and their types), with their tests. The
    file's header now says what it holds; it keeps its name.
  - **`lib/constants.ts`** drops the copy only the old forms used: `SAVED_STATE_COPY`, four
    `AMEND_COPY` keys (`setChanged`, `locked`, `lockedFor`, `lockedRecovery`), `QUANTITY_FIELD_WORD`,
    `quantityInputLabel`, `usuallyLoggedAs`, `STRENGTH_COPY`, `skippedCount`, the strength receipt
    and set-amend ids, `PARTIAL_SETS_COPY`, `missingQuantityMessage`, `SUMMARY_NAME_MAX`,
    `blockedSummary` and `strengthSummary`, with their three test blocks.
  - **`DayNav`** loses its `dayRoleLabel` prop, which no page passed.
  - **The screenshot script** loses the 14 capture states for surfaces gone since #418, their
    seeders (`seedCalisthenics`, the tree's last writer of a ramp target; `seedStrengthSession`,
    `seedStatusBadges`, `seedLengthSession`) and their interactions.
  - **Comments** that named deleted files or `isEditableSet` now say what is true, in the files this PR
    was cleared to touch; two in `packages/db/scripts` (`verify.ts`, `corrections/registry.ts`) go to a
    Tech Debt follow-up with `fixtureScope`.
  - **No page changes,** and nothing logged is touched.
