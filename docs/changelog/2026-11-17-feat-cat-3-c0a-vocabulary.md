- **2026-11-17** — **CAT-3: the words the movement library is described with, and the shape of one entry**
  ([spec](../specs/cat-3-movement-library.md); [guide](../features/program-contract.md); contract
  chunk C0a). The lists of equipment, muscles and kinds of training, an optional supervision label,
  and the rules one library entry must keep: a name the export can print, a key that never changes,
  and no stored "no equipment" answer (it is worked out from the equipment a movement needs). An
  entry may also carry a few lines on how to do the movement, written here in our own words, and
  has a place for a video later, which stays empty for now. The library itself starts empty. Every entry, and every later edit to one, will need a recorded
  approval, and a check in CI stops a recorded approval or a shipped key being changed. A small
  generic library for tests comes with it. Nothing a person sees changes yet.
