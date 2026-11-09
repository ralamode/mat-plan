---
id: PROF-1 a-1
pr: pending
---

## a-1's plan, before a line of it was written

`PROF-1 a-1` (add an athlete) was planned on 2026-10-23. The 2026-11-08 refresh concentrated on its
sibling `b`, so these rows were still describing a repo that has since shipped `a-g`, `a-r`, `b-s`
and `b`. Five lenses — interaction, a11y/360px, trust, security, and a plan-vs-shipped-code fact
check — found **five BLOCKING** items. Five of the thirteen findings were the plan asserting
something about code that had already shipped differently, which is the same failure `b`'s refresh
found four times, in a document that had just been refreshed.

**Two of the five were proofs that cannot fail.**

- **There is no wrong-owner matrix row for `addAthleteAction` at all.** The row specifies "a binding
  with `scopeMiss` and `succeeded`" — fields WP-1's plan accepted and never built. `Binding` is
  `{ fn, writers }`, nothing calls `actionsScoped(household)`, and `mutating-actions.test.ts` pins the
  household set to `[]` as a tripwire for exactly this moment. So the only rows reaching the action
  today are unauth and rate-limit, and AGENTS.md calls wrong-owner mandatory.
- **The isolation proof is blind to the leak it exists to catch.** `uq_profiles_client_id` is global
  and non-partial, so a caller-chosen key collides across households by design and the two scoped
  reads are the entire boundary. Drop **either** and household B's replay of A's key returns **A's
  `public_id`**, which the action then redirects B to — a cross-household identifier in the other
  household's URL bar. The planned assertion, "B gains no row", stays **true** in both cases.

**And one piece of safety copy pointed at a script nobody wrote.** `kind` is set once at add and a-r
removed it from rename, so the plan's remedy for a wrong one was "a `db:correct` correction" — no such
correction is registered. The real recovery shipped with `b` the day before: archive the athlete and
add them again. The form now says so, and says plainly that the choice cannot be changed afterwards —
which the approved prototype still promises it can.

Also corrected: the add form — the one screen this PR exists to build — had **no row at all**, and the
rows pointed at a component a-r's docblock explicitly says a-1 will not import; the dashed add tile
fails SC 1.4.11 in both themes as prototyped, and **neither half of its planned mitigation can measure
it** (the repo's contrast helper composites alpha in linear light, and axe has no non-text-contrast
rule); `/p/new` would 404 on an unresolved scope where `/p` and `/settings` both explain themselves;
and the page shell class is now written eight times, so a ninth copy was the wrong move.

Three findings belong outside a-1 and are filed to [tech-debt](../tech-debt.md): the contrast helper's
compositing model, the day page having no static title (so every navigation onto it announces
"mat-plan" — which already makes a-r's rename confirmation inaudible), and `--ring` at ~2.59:1 in
light mode.

No implementation code. Three decisions are open — a per-household cap on a create endpoint with no
delete path, whether to split a-1 into a dark write path and a UI chunk, and whether to write the
`kind` correction after all.
