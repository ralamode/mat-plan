- **2026-11-19** — **Every id the app receives is read in lower case, so one id typed two ways is no
  longer treated as two.** The database treats an id in upper and lower case as the same, but the
  checks that look for a repeated id compared the text as sent. Through the strength-session schema,
  a session naming one movement twice (once in upper case) passed those checks and lost the second
  movement's sets, and two supersets spelled that way merged or failed with an error page; FAM-1 12f
  has since retired the action that took such sessions, so that path is closed in the app too. The
  shared id check (`uuidSchema`) now hands every id back in lower case for every parse, the hide and
  restore schemas included, and a test fails if any source builds a second uuid check (zod's
  builders, a uuid regex, or the `uuid` package's `validate`). Only a hand-crafted request could
  send such ids: the app writes lower case.
