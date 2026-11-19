- **2026-11-19** — **FAM-1 step 14b: the export's check-ins file carries every logged check-in**
  ([plan](../plans/fam-1-14-export.md) § "14b — file by file"). It used to be written header-only.
  Now it has one row per check-in, `date,activity,metric,value,unit,notes` (the maintainer's choice
  of format): each practice's minutes, each habit done, each calisthenics or conditioning count, the
  older check-in metrics, and Wake as a time of day (`06:52`).
  - **Bodyweight stays out:** a weigh-in never lands in this file. One test, `bodyweightEntry()`,
    is shared with the bodyweight read and matches the activity OR the metric.
  - **Each entry in one file:** `db:verify` proves that every live entry of a month lands in exactly
    one of the three files, and the new read joins the household-scope matrix.
  - **Lane E's choices, not the maintainer's:** the value column (the number, else the text), the
    row order (date, then entry), and Wake as `HH:MM`.

  The privacy notice and inventory say what now goes out. Mutations 368 to 371.
