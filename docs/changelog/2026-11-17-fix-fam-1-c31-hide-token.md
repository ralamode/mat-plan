- **2026-11-17** — **Ticking a row back with a made-up time is refused cleanly**
  ([guide](../features/program-contract.md), invariant 29; FAM-1 contract change C31). Ticking a
  row back sends the moment it was un-ticked. A request altered to send a time that does not
  exist (30 February, month 13) is refused as a bad value, and the contract's own test now holds
  that. The preview page's stand-in gives the same answer as the real action. Nothing changes
  for a person using the app.
