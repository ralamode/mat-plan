### Removed

- **The old strength log form and everything only it used** (FAM-1 12f PR 1,
  [plan](../plans/fam-1-12f-retire-old-forms.md)).
  - **28 whole files, about 5,500 lines:** the form and its helpers, the section and its receipt, the
    set lines and inputs, the unmounted check-in form, the token preview's set-row demo, and the
    program-day reads only they called (`lib/dal/programming.ts`, `lib/programming/program-day.ts`,
    `day-role-schedule.ts`).
  - **Nothing mounted any of them** since the day page moved to the FAM-1 row writer, and `tsc` proves
    no importer is left.
  - **The edits the build forced:** the token preview loses its "Strength set row" and "Day card"
    sections, a containment test loses the case that read the deleted scaffold, and the strength
    logging, programming and write-path guides drop what described the deleted files.
  - **No page changes,** and nothing logged is touched.
