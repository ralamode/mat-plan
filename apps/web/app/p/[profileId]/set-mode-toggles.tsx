'use client';

/**
 * The two LOAD MODES of a set — bodyweight and band (GAP-3 PR 4a).
 *
 * WAS `load-chips.tsx`, which wrote the STRINGS `BW`/`band` into the weight text field. That existed
 * because the field was the only place a non-numeric load could go (GAP-1 P0-2), and because iOS's
 * numeric keypad has no letters, so without a tap-to-fill chip the most common load in the program
 * would have been the hardest thing to enter. **The ergonomic argument survives unchanged; the
 * storage is what moved** — these are now booleans on `entry_sets` (GAP-3 §7.2b), because neither is
 * a quantity: a band has no number, and bodyweight is a MODE rather than a load.
 *
 * ## Why checkboxes and not `aria-pressed` buttons
 *
 * They used to be `<Button aria-pressed>` because they ACTED on a text field. They now record two
 * independent facts, which is what a checkbox is — and the `Sub-failure` control 8px away in the same
 * row is already a real `<input type="checkbox">`. Shipping three booleans in two widget idioms means
 * a screen-reader user hears "BW, toggle button, pressed" then "Sub-failure, checkbox, not checked"
 * for facts of identical kind. The chip LOOK is kept; the semantics are the native ones.
 *
 * ## They are not mutually exclusive with the weight field
 *
 * `BW` + a weight is legal and meaningful — it is `BW+8 (vest)`, the shape ADR 0004 called "not
 * representable today". PR 4b adds the worn-load row that makes it fully expressible; until then the
 * composition is at least no longer *rejected*.
 */
export function SetModeToggles({
  isBodyweight,
  isBand,
  onChange,
  ariaLabel,
  bodyweightDescribedBy,
}: {
  isBodyweight: boolean;
  isBand: boolean;
  onChange: (patch: { isBodyweight?: boolean; isBand?: boolean }) => void;
  /**
   * V1-30b — the id of V1-26's "usually logged with a weight" note, carried by EVERY checked BW chip
   * on the card while the note shows. The note is about the movement rather than one set, and it used
   * to be a mount-with-text `role="status"`, which is unreliable: a live region that already contains
   * its text when it mounts may never be announced. A description on the control that triggered it is.
   */
  bodyweightDescribedBy?: string;
  /** Context for the accessible name, e.g. "Movement 1 set 2" — unique per set, so a forms list
   *  does not show fifteen controls all called "BW". */
  ariaLabel: string;
}) {
  const modes = [
    {
      key: 'bw',
      label: 'BW',
      title: 'Bodyweight',
      checked: isBodyweight,
      set: (v: boolean) => onChange({ isBodyweight: v }),
      // Only the BW chip describes V1-26's note, and only while it is checked — that is what the
      // note is about. The band chip never does.
      describedBy: isBodyweight ? bodyweightDescribedBy : undefined,
    },
    {
      key: 'band',
      label: 'band',
      title: 'Band',
      checked: isBand,
      set: (v: boolean) => onChange({ isBand: v }),
      describedBy: undefined,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {modes.map((m) => (
        // `min-h-11` on the LABEL, not the input: the a11y gate measures the control bound to a
        // label, and a visually-hidden checkbox has no box of its own. Same reason the Sub-failure
        // control wraps its input in a `min-h-11` label.
        <label
          key={m.key}
          className={`focus-within:ring-ring inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-offset-2 ${
            m.checked
              ? 'bg-secondary text-secondary-foreground border-transparent'
              : 'bg-background hover:bg-accent hover:text-accent-foreground border-input'
          }`}
        >
          {/* `sr-only`, NOT `hidden` — it must stay in the tab order and remain operable by keyboard
              and by assistive tech. The visible chip is the label, and `focus-within` above draws the
              focus ring the input itself cannot show. */}
          <input
            type="checkbox"
            className="sr-only"
            checked={m.checked}
            onChange={(e) => m.set(e.target.checked)}
            aria-describedby={m.describedBy}
            // The visible text ("BW") is a SUBSTRING of the accessible name — WCAG 2.5.3 Label in
            // Name, the same rule the Sub-failure control follows.
            aria-label={`${m.label} — ${m.title} — ${ariaLabel}`}
          />
          {m.label}
        </label>
      ))}
    </div>
  );
}
