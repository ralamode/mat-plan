- **2026-11-16** — **V1-24: the bodyweight and practice Change saves and cancels with ✓ and ✕ on the
  field's line** _(maintainer, 2026-11-16)_.
  - **The editor:** the Change button is unchanged. Open, its field, the unit, a ✓ (save) and a ✕
    (cancel) share one line at 360px, replacing the full-width Cancel and Save/Clear beneath. The
    hint and any error stay under the field.
  - **Clearing:** no red Clear and no trash. An empty ✓ clears, as before, and the hint says so; the
    ✓ looks the same, and its accessible name is `Clear weight` / `Clear wrestling practice` while
    it would clear (one subject per row: `Save weight`, `Clear weight`, `Cancel changing weight`).
  - **The ✕** is a neutral outline at the far right, so a missed tap cancels rather than saves.
  - **Accessibility:** both are 44×44 with names (`Save weight`, `Cancel changing weight`); Escape
    cancels from the field or either button, and does nothing while a save is in flight (the ✕ hides
    then); "Enter your bodyweight, then ✓." reads the ✓'s name aloud.
  - **Shared:** `InlineEditActions` (`components/ui/`) is the ✓ / ✕ pair alone; each caller owns its
    field. It can also render the ✕ alone, with pointer handlers passed through, for lane C's set
    rows (no caller yet; lane C adopts it in its own PR). The ✓ with its pending spinner is one
    `TickButton`, shared with the log rows' ✓.
