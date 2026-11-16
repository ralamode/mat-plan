- **2026-11-16** — **V1-24 3b-life-a: a logged wrestling practice can be changed, and emptying the
  field clears it** ([plan](../plans/v1-24-3b-logs-in-place.md) § "3b-life: what the slice settles").
  - **The logged row:** `✓ Wrestling practice`, then its minutes on a second line, with **Change** on
    the right (one line does not fit 360px). Read-only days show the row without Change.
  - **Change:** opens with the minutes selected; Cancel, then Save. While the field is empty Save reads
    **Clear**, and a line under the field says how to clear and that two practices in a day are entered
    as their total. Whole minutes from 10 to 300. A clear hides the row through `hideEntries`, the app
    does not offer to restore it (ADR 0008 Amendment 1), and the one-tap ✓ comes back to log again.
    An archived athlete can change but not clear.
  - **One editor, two rows:** bodyweight and practice share `SingleValueAmend`, `LoggedValueRow` and
    one copy factory, so the two rows cannot drift. The one-tap ✓ now reports through 3b-bw's island
    (spoken, focus to Change), and `saved-announcer.tsx` is deleted.
  - **The action:** `editPracticeAction` is the first action in this module in the FAM-1 contract:
    typed input and result (`packages/shared/src/practice-shapes.ts`), refusals as reasons, C7's entry,
    a registry row. The writers pin the practice metric and its unit (`clearPractice`,
    `updatePracticeEntryById`, `findAmendablePractice`).
  - **Proofs:** `verify/single-values.ts` § 3b-life-a; mutation patches 150–154.
  - **Privacy:** the notice and the inventory say a practice can now be cleared, with the same reach
    as a weigh-in. Nothing new is stored.
  - **Accepted:** a day-taken insert that loses a same-instant clear throws (`tech-debt.md`), for
    bodyweight and practice alike.
