# The three Server Actions the old forms called are gone

FAM-1 12f PR 3 ([plan](../plans/fam-1-12f-retire-old-forms.md)).

- `logCheckinsAction`, `logStrengthSessionAction` and `editStrengthSetAction` are deleted from
  `app/p/[profileId]/actions.ts`, with their two private helpers, their registry rows and their
  tests. Nothing in the app called them since 12f PR 1 removed the forms.
- The shared "declared-day ±1 bound" test keeps bodyweight and gains the practice form, so it still
  covers two writers.
- The strength write path (schemas, DAL, writer) stays with no caller until `LEGACY-1` retires it.
