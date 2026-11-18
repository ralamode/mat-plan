- **2026-11-18** — **FAM-1 14b: the check-ins file is planned, file by file**
  ([plan](../plans/fam-1-14-export.md) § "14b — file by file"). The export's check-ins file will carry
  every logged check-in as `date,activity,metric,value,unit,notes`, old rows included, with bodyweight
  kept out by one shared test. Plan only; the code follows in its own PR. Reviewed by correctness and
  privacy lenses and a re-review; covered by the maintainer's approval of #582 (D17). Three choices
  in it are lane E's: the value column, the row order, and Wake as `HH:MM`.
