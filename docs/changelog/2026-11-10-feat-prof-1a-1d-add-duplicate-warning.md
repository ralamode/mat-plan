---
id: PROF-1 a-1d-add
pr: pending
---

## Adding an athlete who is already there now warns, instead of silently making a second one

Type a name that folds to one the household already has — live **or archived** — and the add form
says so before creating anything. The choices are explicit buttons: **Open {name}** for someone
already on the picker, **Restore {name}** for someone archived, and **Add another {name}** when two
athletes really do share a name.

🔴 **It is a warning, not a constraint, and the write path says so.** Two cousins can both be Ada.
Two requests with different keys and the same name still both insert — a unique index on a folded
name is impossible precisely because "Add another" is a feature. Nothing describes this as preventing
duplicates.

## Three things that are load-bearing and were nearly wrong

**The `client_id` exclusion is NULL-safe.** The natural `ne(clientId, key)` compiles to
`client_id <> $1`, which is **NULL** for every athlete whose key is NULL — and Postgres drops those
rows. `profiles.client_id` is nullable, migration `0020` backfilled nothing and the seed writes no
key, so the warning would have been **dead in every household that exists today**. Worse, it would
have shipped green: every fixture goes through `createProfile`, which always sets a key, so the whole
suite would have passed while the feature did nothing. Mutation patch `29` reverts it to the broken
form.

**The fold is compared in JS, not in SQL.** `foldName` is NFKD plus combining- and format-mark
stripping; Postgres has no equivalent, so `lower(name) = $1` would be a second, weaker folding rule
living in the query. A household holds at most 25 rows behind an equality on `household_id`, so
reading them and folding in memory costs nothing and keeps one definition.

**The acknowledgement is a folded NAME, not a boolean**, compared server-side against the parsed name.
A boolean would let consent to "Ada" wave "Bea" through: acknowledge the warning, edit the field, and
the stale consent skips the check for a name nobody was warned about.

## The duplicate check runs BEFORE the quota, on purpose

An archived twin occupies a slot. Quota-first would tell a full household "write to us" instead of
offering **Restore**, which needs no slot at all — the one recovery that works for them. The price is
that the warning can reach a household that is already full, so the result carries `atCap` and the
screen hides "Add another" when it is set. The UI never offers a button the endpoint would reject.

## The archived case contradicts advice this app already gives, so it says so

The add screen tells a parent who picked the wrong kind to archive the athlete and add them again.
They do, return, choose the **corrected** kind — and would be met with "Restore", which brings back
the **wrong** kind, permanently. So the match carries its `kind`: when it agrees, Restore is primary;
when it differs, neither is, and the callout says _"Ada was added as a Child. Restoring keeps that,
and it can't be changed."_

The copy also hedges. `foldName` is lossy by design — José/Jose, voiced kana, Devanagari vowel signs
all fold equal — so the warning says **"looks like"**, never "already exists", and shows the stored
spelling beside what was typed, making a false positive visible rather than asserted.

## What is proven, and one thing that is not

`db:verify` covers seven cases including a **legacy athlete with a NULL `client_id`**, an archived
`Zoë` matching `zoe`, a live match beating an archived one, and a replay of a successful add never
being called a duplicate. Four mutation patches (`26`–`29`) each redden a distinct assertion.

⚠️ **The archived → Restore path has no end-to-end test.** Every tier below the browser covers it, but
the click itself does not: after an archive, loading `/p/new` under Playwright leaves the radios
resolvable yet never actionable — only calls that evaluate page JS hang, at a 30s budget and again at
90s. It is not the component (jsdom renders the same state in ~1s). Filed in `docs/tech-debt.md` with
the evidence, and the e2e file carries a docblock naming exactly what is and is not proven, rather
than a `test.skip` that would look like coverage.

⚠️ **Two planned mutation patches were not shipped, because both stayed green.** Ordering and the
`client_id` exclusion independently cover every interleaving a single-connection database can
produce, so breaking either alone changes no answer. The interleaving the exclusion actually guards
cannot be staged in PGlite. The line stays, documented; the patch that reddens nothing does not.
