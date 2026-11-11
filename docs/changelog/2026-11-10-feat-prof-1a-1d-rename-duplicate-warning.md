---
id: PROF-1 a-1d-ren
pr: pending
---

## Renaming an athlete onto a name someone else holds now warns — and fixing your own capitalisation does not

Type a name another athlete already has, live **or archived**, and the rename form says so before
saving. The one choice is **Save anyway**, because two athletes are allowed to share a name — two
cousins can both be Ada. This closes CRUD-1 step 2b.

🔴 **The name is a DISPLAY STRING, and a rename never touches an athlete's data.** Entries and
sessions key on `profile_id`; the name is not a lookup key in any query or writer; `renameProfile`
writes `{ name, updatedAt }` by `public_id`. Fixing `ada` → `Ada` moves nothing. This warning is
about two picker tiles reading the same, and nothing else.

## The guard is the FOLD, not the id — and it made the chunk smaller

```
foldName(newName) === foldName(storedName)  →  no check at all
```

`foldName` lowercases, strips combining marks and collapses whitespace, so this covers exactly the
"fix my own name" edits: `ada → Ada`, `Jose → José`, a stray double space, and Save with nothing
changed. None of them creates a new collision.

⚠️ **The planned fix — excluding the athlete being renamed — was necessary but NOT sufficient**, and
a UX panel found the hole before any code existed. Two live athletes sharing a name is the
_designed_ case: the add form's "Add another Ada" creates it with explicit consent. Open "Rename Ada"
to fix the capitalisation and excluding _self_ does not help, because **Ada #2 matches** — so the
parent is warned about a collision that already existed, that they already agreed to, while changing
nothing.

**And the guard retires `excludeProfileId` entirely, with no third case _sequentially_:** when the
fold is unchanged the check never runs, and when it changes, the row's stored name folds to the _old_
value and cannot match the new one. ⚠️ Under **concurrency** it can — two renames of the same row to
the same new name, where the second's lookup finds the row after the first commits and reports it as
somebody else. The stored name is right either way, so that is advisory copy being wrong rather than
corruption, and excluding self would not have helped: the write had already landed.

A mutation patch proves it: dropping the guard makes a casing fix on one of two same-named athletes
warn about the other.

## One choice, and what the other two routes preserve

**Save anyway**, `outline` — it is the action that _creates_ the ambiguity, the same class as the add
form's "Add another", so a filled primary as the only button is what would make the screen read as a
dead end. There is no second button: one would have to change state, and every version is worse — a
dismiss remounts Save and the server answers `duplicate` again, a dismiss that acknowledges saves
silently, and a focus-move duplicates the 44px field directly above. The message names the routes
instead, including what going back **preserves**: _"go back and {name} keeps their name"_, which is
reassuring here in a way it was not on the add form.

Archived matches get their own sentence and **no Restore** — you are renaming somebody else, so
restoring the match would neither finish nor abandon the edit.

## Two focus rules, and the second does not transfer from the add form

- The focus effect keys on **`[state]` alone** and reads `state.duplicate`, never the derived value.
  That one depends on _typing_, so a dependency on it means backspacing "Bea B" to "Bea" re-matches,
  the callout remounts and focus is yanked out of the field mid-edit — on a phone, dropping the
  keyboard under the parent's thumb.
- A **page-level refusal gets its own target.** The add form returns focus to the callout; here the
  callout has already unmounted by the time that answer arrives, so there would be nothing to return
  to and focus would sit on `<body>`.

The hidden submit sentinel is unconditional, first in the form. ⚠️ Its reason is unprovable in
jsdom — implicit submission does not exist there — so the unit test pins the _structure_ and an e2e
drives the real key. Probed: removing the sentinel makes that e2e fail.

## `rename-form.test.tsx` is new, and that is itself a finding

a-r's refusal-focus effect shipped in #350 pinned by **nothing** — the e2e checks `aria-invalid` and
the kept value, not focus. A UX lens found that while reviewing this chunk's plan, so the
pre-existing behaviour gets its first test here, alongside the new ones. Every new assertion was
probed by reverting the behaviour it covers.

⚠️ **`atCap` is now optional and add-only** in the shared envelope. A rename creates nothing, so the
quota is never consulted; a required field would force this path to send a value that is always
`false`. Absent means "the cap does not apply here", which is not the same as `false`, and the
action's test pins the absence with `toEqual`.
