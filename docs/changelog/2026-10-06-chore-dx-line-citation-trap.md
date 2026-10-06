- **2026-10-06** — **Two traps the chunk-1 panel surfaced, banked before they could be rediscovered.**
  (1) **A line number taken from a filtered stream is not a file line number.** A plan's `schema.ts`
  citations were all wrong by exactly 161 lines, because `grep -n` had been run against an `awk`
  extract, which renumbers from 1. Four of five review lenses flagged it independently, each reaching
  for the same phrase — _a wrong line number reads as verified_ — and the error then **recurred twice
  inside its own fix**, which is why it is now a row in `write-spec`'s derivation-trap table rather
  than a resolution to be careful. The check: `grep -n` the symbol in the **file**, or better, cite
  `path:symbol`, which cannot drift. (2) **`--> statement-breakpoint` is itself a `--` comment**, so on
  its own line between a `-- squawk-ignore` and its statement it **voids the ignore** and the rule fires
  again — appended to the existing lesson, which covered the general adjacency rule but not this way of
  breaking it. Found by _running_ `squawk-cli` against a candidate migration rather than reading it:
  the only way to tell a suppressed rule from one that never fired.
