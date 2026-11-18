- **2026-11-17** — **A re-tick with an impossible time is refused cleanly**
  ([guide](../features/program-contract.md), invariant 29; FAM-1 contract change C31). The token
  that ticks a row back names the moment it was un-ticked. A crafted one naming a time that
  does not exist (30 February, hour 24) is now pinned by the contract's own test to be refused
  as a bad value before anything is read, and the preview page's stand-in answers the same word
  as the real action. Nothing changes for a person using the app.
