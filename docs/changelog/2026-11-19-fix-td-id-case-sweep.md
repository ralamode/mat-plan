- **2026-11-19** — **Every id the app receives is read in lower case, so one id typed two ways is no
  longer treated as two.** The database treats an id in upper and lower case as the same, but the
  checks that look for a repeated id compared the text as sent. That gap caused three defects: a
  strength session that named one movement twice (once in upper case) silently lost the second
  movement's sets, two supersets spelled that way could merge or fail with an error page, and hiding
  or restoring the same entry sent twice answered "not found". The shared id check (`uuidSchema`) now
  hands every id back in lower case, the superset list the strength action builds folds the same
  way, and a test fails if any file defines a second id check. Only a hand-crafted request could send
  such ids: the app writes lower case.
