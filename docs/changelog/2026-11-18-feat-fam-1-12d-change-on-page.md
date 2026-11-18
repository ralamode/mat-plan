# A logged number can be changed on the day page (FAM-1 12d)

On today or yesterday, a logged number on a program row can now be typed over and saved in place,
with Undo, on the real day page; until now Change worked only on the preview. `amendRowAction` joins
the day page's row writes (the same session, limiter, schema, household and today checks as the
other three) and passes the shared boundary matrix. A row logged in another unit than the item's
stays read-only, as before. Plan: [fam-1-12d-change-on-page.md](../plans/fam-1-12d-change-on-page.md).
