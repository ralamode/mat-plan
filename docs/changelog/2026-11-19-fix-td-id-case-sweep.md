- **2026-11-19** — **Every id the app receives is read in lower case, so one id typed two ways is no
  longer treated as two.** The database treats an id in upper and lower case as the same, but the
  checks that look for a repeated id compared the text as sent. A strength session that named one
  movement twice, once in upper case, passed those checks and silently lost the second movement's
  sets; two supersets spelled that way merged, or failed with an error page. The shared id check
  (`uuidSchema`) now hands every id back in lower case, and the superset list the strength action
  builds folds the same way, so those sessions are refused (or, for one superset spelled two ways,
  saved as the one superset it names). The hide and restore schemas get the same fold before
  anything uses them. A test fails if any source builds a second uuid check (zod's builders, a
  uuid regex, or the `uuid` package's `validate`). Only a hand-crafted request could send such ids:
  the app writes lower case.
