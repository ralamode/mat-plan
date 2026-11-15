- **2026-11-14** — **DX-14 item 9: a lane guide relieves the broad guide above it**
  ([plan](../plans/dx-14-9-most-specific-owner.md), [features README](../features/README.md#guides-for-work-run-in-lanes)).
  A changed file now owes every guide with an exact entry for it, plus only the guide(s) with the
  longest matching directory entry, so a lane guide owning `writers/program/` takes those files off
  `write-path.md`. An exact entry still adds (the maintainer's narrowing), so today's two
  doubly-owned writers keep owing both guides, and no tracked file changed owner (907 measured). A
  rename counts its old path, a directory written without its `/` is refused, and the lanes check
  uses the same rule. FAM-1's lane text now names which steps this relieves and which stay seams.
