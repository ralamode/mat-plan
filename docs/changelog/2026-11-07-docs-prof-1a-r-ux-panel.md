- **2026-11-07** — **`kind` comes off the rename form: a-r is rename only** (`PROF-1` a-r, UX panel
  round 2, three lenses, plan only — no implementation).
  🔴 **Two lenses converged on the same BLOCKING without conferring.** One `kind` radio served two
  opposite intents and the form could not tell them apart: _"I added them as the wrong kind"_, where
  emptying past `prescribed` is correct, and _"they turned 18"_, where those cells were legitimately
  theirs. The second is the realistic trigger. The radio sat a thumb-width below the name field,
  pre-checked, sharing one Save — so a parent fixing a typo could brush it, tap Save, and land on a
  day page with the program gone and copy written for the household's adult now shown to a
  17-year-old who was on that program yesterday.
  ⚠️ **And the rationale the plan carried was half-false** — _"a program a non-child should not have
  been reading is not retroactively theirs"_ is true for the household's adult and **false for a kid
  who ages out**. Corrected in the plan **and** in the shipped `programming.md` invariant.
  **Neither acceptance criterion required the edit control:** 8 says _rename_ shall be reachable, 9
  says the form shall **show** `kind`. A wrong kind is a `db:correct` correction until then.
  🔴 **The prerequisite for ever making it editable is recorded, and it is not better copy.** The
  export already keys `prescribed` on the **stored** `sessions.day_role`; only the lookup re-runs
  `programDayRows` with the kind conjunct. Dropping that conjunct for the export path alone would
  leave an aged-out kid's history intact while a never-kid adult still exports empty, because their
  sessions carry no stored role. That reopens Q15 R2, so it is the maintainer's call when `kind`
  editing is next proposed — deliberately not built speculatively.
  🔴 **`break-words` is the wrong utility, and a-g shipped it while citing D11.** It and
  `wrap-anywhere` break lines identically **except** that only `anywhere` lets the break count toward
  `min-content` — so it does nothing where width derives from min-content, which is four of the
  renderers: the tile name (a row-flex item beside a fixed avatar), the `w-fit` Edit link, the
  callout buttons (an anonymous flex item, so `min-w-0` cannot even apply) and PR b's settings row.
  One exported `NAME_WRAP_CLASS` replaces nine copies across three PRs.
  ⚠️ **`page.tsx:389` overflows at 360px today** — 322–384px against 328px usable for an average
  40-char name, pre-existing since V1-23.
  🔴 **The amber warning token the plan prescribed does not exist.** The spec accepted it (CD-2), the
  prototype reversed it, and `globals.css` defines no amber in either theme — so the plan specified a
  token no PR was adding. **Decision: follow the prototype** — `bg-muted text-foreground` with a ⚠
  mark, measured 15:1 light and 11:1 dark. ⚠️ And **no `text-muted-foreground` inside the callout**:
  on `bg-muted` that is the **4.34:1** pair `design.md` already records as under AA, and it is the
  idiom every hint line uses, so it is the natural mistake. The callout joins the token inventory so
  axe scans it before a real route renders one.
  **Also corrected: `plan:449` claimed a-g shipped "Wrapping on the `<h1>`". It shipped no wrap at
  all** — verified against the diff. That `<h1>` is still unwrapped today and becomes a-r's work.
  **And a-r's notice obligation shrank with the scope:** renaming overwrites, retains nothing and
  adds no category, so the only candidate is one sentence saying the old name is **not** kept — which
  is a maintainer decision, now stated as one rather than assumed.
