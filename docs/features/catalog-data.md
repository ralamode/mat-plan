---
feature: The movement library's data (CAT-3 lane N)
owns:
  - packages/shared/src/catalog/data/
---

# The movement library's data

**Read this before adding a batch, editing an entry, or touching `shipped.json` or
`approved.json`.** The spec is [cat-3-movement-library.md](../specs/cat-3-movement-library.md)
(`CAT-3`): its rules 1, 3, 4 and 10 and its criteria D1 to D4 bind every file here. The schema, the
vocabularies and the checks are the contract's, documented in
[program-contract.md](./program-contract.md) → "The movement library's contract (CAT-3)" (invariants 5 to 9). This lane
fills the directory and changes none of them.

## What is here

| File            | What it holds                                                                          |
| --------------- | -------------------------------------------------------------------------------------- |
| `batch-NN.ts`   | One reviewed batch: `CATALOG_BATCH_NN`, literal entries only                           |
| `index.ts`      | `CATALOG_MOVEMENTS`, the batches concatenated in batch order, and `CATALOG_SLUGS`      |
| `shipped.json`  | The lockfile: every shipped slug and its tracking type                                 |
| `approved.json` | Batch number to slug to the SHA-256 (`entryHash`) of the entry the maintainer approved |

### The batches on `main`

Batch numbers follow the review sheet, so they need not be consecutive here: a batch merges once
it is approved, one batch PR at a time.

| Batch | Family                                                                               | Entries |
| ----- | ------------------------------------------------------------------------------------ | ------- |
| 1     | Mobility and stretching                                                              | 50      |
| 2     | Core, carries and sleds                                                              | 58      |
| 3     | Vertical pull and push                                                               | 58      |
| 4     | Horizontal push and pull                                                             | 57      |
| 5     | Conditioning machines and running                                                    | 54      |
| 6     | Correction: supervised instructions name the coach (K17), 4 edits of shipped entries | 0 new   |
| 7     | Hinge: deadlifts, hip thrusts and bridges, swings, back extensions, hamstring curls  | 49      |
| 8     | Squat and lunge: squats, split squats, lunges, step-ups and single-leg squats        | 50      |
| 9     | Wrestling drills and mat skills: stance, shots, takedowns, escapes, rides, live      | 53      |
| 10    | Jumps, hops and throws; calves, shins, hips and neck                                 | 46      |
| 11    | Upper-body isolation: curls, triceps, raises and flys, shrugs, forearms and grip     | 35      |
| 12    | Olympic lifts and kettlebell work: cleans, snatches, jerks, thrusters, get-ups       | 31      |
| 13    | Bodyweight skills: handstands, levers, planche, L-sit, muscle-ups, rolls             | 24      |
| 14    | Gap-fill: movements the family batches left out                                      | 22      |

## How a batch arrives

1. The entries are written in-house, in our own words, and reviewed by the maintainer row by row in
   a private sheet (spec K9, K16). Nothing is imported, and no file here names a source or a person
   (D1, D4).
2. Once the maintainer has approved the batch, one PR, "catalog batch N", adds `batch-NN.ts`, its
   line in `index.ts`, and its lines in both record files. A correction batch adds approval lines
   only. **It merges only once every row of its sheet tab reads "lgtm"**, and then the lane merges
   it _(maintainer, 2026-11-17)_. This supersedes D3's "merged only by the maintainer"; the spec
   is being amended to match.
3. Each approval line is the entry's `entryHash` (`../approvals.ts`). `approvals.test.ts` fails any
   entry whose current content has no matching hash.

## Invariants that live between these files

- **An entry is written exactly as it parses.** The hash and the seed read it as written, so a stray
  space is an edit (contract invariant 5).
- **Both record files only grow.** `check-catalog-append-only.mjs` compares them with the PR's base:
  an existing line is never rewritten. A shipped slug and its tracking type never change (rule 4;
  FAM-1 D25). A corrected name keeps its slug, and the old name becomes an alias.
- **An edit is a new approval line, under a new batch number.** The old line stays (V4).
- **A data file imports `../entry` and its own directory, nothing else** (contract invariant 8).
- **The data stays out of the browser.** Import it through `@mat-plan/shared/catalog/data`, on the
  server only (contract invariant 6).

## Traps

- **`.join('\n')` is code, not a literal.** The fixture builds its instructions that way, but a
  data file writes each `instructions` as one string literal with `\n` inside it.
- **A weighted twin is a second entry only when it logs differently** (rule 10: reps against weight
  and reps). A timed hold with a plate added is still one entry.
- **A slug may equal a legacy `MOVEMENT_SEED_ROWS` slug**, on purpose (spec E2). Before the fresh
  start, production's seed leaves the old row alone and counts it. Only `CATALOG_FIXTURE` must stay
  disjoint from the legacy list.
